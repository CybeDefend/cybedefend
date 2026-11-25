import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import type { QueryDeepPartialEntity } from 'typeorm';
import { Like } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';
import type { ScaService } from '../sca/sca.service';
import type { ContainerService } from '../container/container.service';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import type { ResultsImportJobData } from '../scan-queue/scan-queue.service';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { ImportedAdvisory } from '../../entities/imported-advisory.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvReference } from '../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';
import {
  ImportHarness,
  openImportHarness,
} from '../../test-utils/results-import.live-harness';
import { ClearImportedCatalogueContent1846460000000 } from '../../core/migrations-common/1846460000000-ClearImportedCatalogueContent';

/**
 * LIVE proof that the advisory content of a results import belongs to the
 * project it was imported into, on the engine LIVE_DB_TYPE selects and a
 * real Redis:
 *
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=mysql \
 *     RESULTS_IMPORT_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/imported-advisory-isolation.live.spec.ts
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/imported-advisory-isolation.live.spec.ts
 *
 * Two imports of one advisory id with different content, into projects of
 * two organizations and into two projects of one organization, go through
 * the real processor and ingestion; then each project's findings (their
 * severity and CVSS, what a policy reads), list and detail are read back,
 * and the shared advisory catalogue is checked for any trace of the content.
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
const describeLive = LIVE ? describe : describe.skip;

const ADVISORY = 'GHSA-iso0-0001-0001';
const VECTOR_CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'; // 9.8
const VECTOR_LOW = 'CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:N/I:L/A:N'; // 2.0

interface Declared {
  summary: string;
  details: string;
  score: string;
  vector: string;
  link: string;
  alias: string;
  cwe: string;
  fixed: string;
}

const A: Declared = {
  summary: 'Text chosen by the first importer',
  details: 'Details chosen by the first importer',
  score: '9.8',
  vector: VECTOR_CRITICAL,
  link: 'https://first.example/advisory',
  alias: 'CVE-2024-1111',
  cwe: 'CWE-79',
  fixed: '4.17.99',
};

const B: Declared = {
  summary: 'Text chosen by the second importer',
  details: 'Details chosen by the second importer',
  score: '2.0',
  vector: VECTOR_LOW,
  link: 'https://second.example/advisory',
  alias: 'CVE-2024-2222',
  cwe: 'CWE-400',
  fixed: '4.17.21',
};

/** One SARIF result for lodash 4.17.20 under ADVISORY, with `d`'s content. */
const sarifOf = (d: Declared): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'acme-sca',
            rules: [
              {
                id: ADVISORY,
                deprecatedIds: [d.alias],
                shortDescription: { text: d.summary },
                fullDescription: { text: d.details },
                helpUri: d.link,
                properties: {
                  tags: [d.cwe, 'security'],
                  'security-severity': d.score,
                  cvssv3_vector: d.vector,
                },
              },
            ],
          },
        },
        results: [
          {
            ruleId: ADVISORY,
            ruleIndex: 0,
            level: 'error',
            message: { text: 'lodash is vulnerable' },
            properties: {
              'cybedefend/package': {
                name: 'lodash',
                version: '4.17.20',
                fixedVersion: d.fixed,
                ecosystem: 'npm',
              },
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'package-lock.json' },
                  region: { startLine: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });

describeLive('imported advisory content stays with its project', () => {
  // SARIF import is a Community Edition feature: the worker refuses every
  // job elsewhere. The edition is set once the database is open, so the
  // MySQL pass runs the same reads and writes on the other engine.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  afterAll(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  const bullPrefix = `bull-imported-advisory-live-${randomUUID()}`;

  let h: ImportHarness;
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'imported-advisory-live-'));
    h = await openImportHarness(dialect, bullPrefix);
    process.env.CYBEDEFEND_EDITION = 'community';
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await h?.close();
  }, HOOK_TIMEOUT);

  const repo = <T extends object>(entity: new () => T) =>
    h.live.dataSource.getRepository(entity);

  const runImport = async (
    projectId: string,
    organizationId: string,
    declared: Declared,
    severities?: string,
    category: 'sca' | 'container' = 'sca',
  ): Promise<string> => {
    const file = join(tmp, `${randomUUID()}.sarif`);
    await writeFile(file, sarifOf(declared));
    const scanId = randomUUID();
    const data: ResultsImportJobData = {
      scanId,
      projectId,
      organizationId,
      branch: 'main',
      category,
      format: 'sarif',
      fileKey: file,
      ...(severities ? { severities } : {}),
      ...(category === 'container'
        ? { image: 'ghcr.io/example/app:1.0.0' }
        : {}),
    };
    await h.processor.process({
      id: `results-import-${scanId}`,
      data,
    } as Job<ResultsImportJobData>);
    return scanId;
  };

  const detectionsOf = (projectId: string) =>
    repo(ScaVulnerabilityDetections).find({
      where: { projectId },
      relations: ['vulnerability'],
    });

  const listOf = (projectId: string) =>
    h.sca.getProjectScaVulnerabilities({
      projectId,
      branch: 'main',
      pageNumber: 1,
      pageSizeNumber: 50,
      excludeAutofixCounts: true,
    } as Parameters<ScaService['getProjectScaVulnerabilities']>[0]);

  /** What a project's findings show and what a policy reads, for ADVISORY. */
  const shownTo = async (projectId: string) => {
    const [detection] = await detectionsOf(projectId);
    const list = await listOf(projectId);
    const item = list.vulnerabilities[0];
    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId,
      vulnerabilityId: detection.id,
    });
    const meta = detail.sca.metadata;
    return {
      gate: {
        severity: detection.currentSeverity,
        cvss: Number(detection.currentCVSS),
      },
      list: {
        summary: item.metadata.summary,
        cve: item.metadata.cve,
        fixed: item.metadata.packages.map((p) => p.fixed),
        cwes: item.metadata.cwes.map((c) => c.cweId),
      },
      detail: {
        summary: meta.summary,
        details: meta.details,
        cve: meta.cve,
        aliases: meta.aliases.map((a) => a.alias),
        references: meta.references.map((r) => r.url),
        severities: meta.severities.map((s) => s.score).sort(),
        fixed: meta.packages.map((p) => p.fixed),
        cwes: meta.cwes.map((c) => c.cweId),
      },
    };
  };

  const expected = (d: Declared, severity: string) => ({
    gate: { severity, cvss: Number(d.score) },
    list: {
      summary: d.summary,
      cve: d.alias,
      fixed: [d.fixed],
      cwes: [d.cwe],
    },
    detail: {
      summary: d.summary,
      details: d.details,
      cve: d.alias,
      aliases: [d.alias, ADVISORY].sort(),
      references: [d.link],
      severities: [severity, d.vector].sort(),
      fixed: [d.fixed],
      cwes: [d.cwe],
    },
  });

  /** Every trace of `d`'s content in the shared catalogue: none expected. */
  const catalogueTracesOf = async (d: Declared) => ({
    root: await repo(VulnerabilityOsv).count({
      where: [{ summary: d.summary }, { details: d.details }],
    }),
    aliases: await repo(VulnerabilityOsvAlias).count({
      where: { alias: d.alias },
    }),
    severities: await repo(VulnerabilityOsvSeverity).count({
      where: [{ score: d.vector }, { vulnerability: { id: ADVISORY } }],
    }),
    references: await repo(VulnerabilityOsvReference).count({
      where: { url: Like(`${d.link}%`) },
    }),
    affected: await repo(VulnerabilityOsvAffected).count({
      where: { vulnerability: { id: ADVISORY } },
    }),
    events: await repo(VulnerabilityOsvAffectedEvent).count({
      where: { fixed: d.fixed },
    }),
  });
  const NO_TRACE = {
    root: 0,
    aliases: 0,
    severities: 0,
    references: 0,
    affected: 0,
    events: 0,
  };

  it('two organizations import one advisory id: each project reads only its own content and severity, the catalogue none', async () => {
    const projectA = randomUUID();
    const projectB = randomUUID();
    await runImport(projectA, randomUUID(), A);
    await runImport(projectB, randomUUID(), B);

    expect(await shownTo(projectA)).toEqual(expected(A, 'CRITICAL'));
    expect(await shownTo(projectB)).toEqual(expected(B, 'LOW'));

    expect(await catalogueTracesOf(A)).toEqual(NO_TRACE);
    expect(await catalogueTracesOf(B)).toEqual(NO_TRACE);
    const root = await repo(VulnerabilityOsv).findOneByOrFail({
      id: ADVISORY,
    });
    expect(root.databaseSpecific).toBeNull();

    // The first project's next import still reads its own content.
    await runImport(projectA, randomUUID(), A);
    expect(await shownTo(projectA)).toEqual(expected(A, 'CRITICAL'));
  });

  it("an advisory id another organization imported as low never stops a project's critical finding", async () => {
    const seeder = randomUUID();
    await runImport(seeder, randomUUID(), B);
    const victim = randomUUID();
    // The scan keeps critical and high only (a cluster scan's settings).
    await runImport(victim, randomUUID(), A, 'critical,high');
    const [detection] = await detectionsOf(victim);
    expect(detection?.vulnerability.id).toBe(ADVISORY);
    expect(detection.currentSeverity).toBe('CRITICAL');

    // And the other way round: a critical seed never makes a low finding
    // pass a filter that keeps critical only.
    const other = randomUUID();
    await runImport(other, randomUUID(), B, 'critical');
    expect(await detectionsOf(other)).toEqual([]);
  });

  it('two organizations import one advisory id as container findings: each detail and list shows its own content', async () => {
    const projectA = randomUUID();
    const projectB = randomUUID();
    await runImport(projectA, randomUUID(), A, undefined, 'container');
    await runImport(projectB, randomUUID(), B, undefined, 'container');
    for (const [projectId, d] of [
      [projectA, A],
      [projectB, B],
    ] as const) {
      const [detection] = await repo(VulnerabilityDetectionsContainer).find({
        where: { projectId },
      });
      const detail = await h.container.getContainerVulnerabilityById({
        projectId,
        vulnerabilityId: detection.id,
      });
      const vulnerability = detail.detection.vuln;
      expect({
        cve: vulnerability.vulnerabilityId,
        title: vulnerability.title,
        description: vulnerability.description,
        references: vulnerability.references,
        cweIds: vulnerability.cweIds,
        fixed: detail.detection.fixedVersion,
      }).toEqual({
        cve: d.alias,
        title: d.summary,
        description: d.details,
        references: [d.link],
        cweIds: [d.cwe],
        fixed: d.fixed,
      });
      const list = await h.container.getProjectContainerVulnerabilities({
        projectId,
        branch: 'main',
        page: 1,
        limit: 10,
      } as Parameters<
        ContainerService['getProjectContainerVulnerabilities']
      >[0]);
      expect(list.vulnerabilities[0].vuln.title).toBe(d.summary);
      expect(list.vulnerabilities[0].vuln.vulnerabilityId).toBe(d.alias);
    }
    expect(await catalogueTracesOf(A)).toEqual(NO_TRACE);
    expect(await catalogueTracesOf(B)).toEqual(NO_TRACE);
  });

  it('two projects of one organization import one advisory id: each reads its own content', async () => {
    const organizationId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await runImport(first, organizationId, A);
    await runImport(second, organizationId, B);
    expect(await shownTo(first)).toEqual(expected(A, 'CRITICAL'));
    expect(await shownTo(second)).toEqual(expected(B, 'LOW'));
    expect(
      await repo(ImportedAdvisory).count({ where: { organizationId } }),
    ).toBe(2);
  });

  it('a finding imported before this change keeps its identity and triage; the shared content is cleared, and its next import shows its own', async () => {
    const projectId = randomUUID();
    await runImport(projectId, randomUUID(), A);
    const [before] = await detectionsOf(projectId);
    // The state an instance had before: the content was written into the
    // shared catalogue, the project had no row of its own, and the finding
    // was triaged.
    await repo(ImportedAdvisory).delete({ projectId });
    await h.live.dataSource
      .createQueryBuilder()
      .update(VulnerabilityOsv)
      .set({ summary: 'Shared text from an earlier import' })
      .where('id = :id', { id: ADVISORY })
      .execute();
    const affectedId = randomUUID();
    const rangeId = randomUUID();
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvAffected)
      .values({
        id: affectedId,
        ecosystem: 'npm',
        packageName: 'lodash',
        vulnerability: { id: ADVISORY },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffected>)
      .updateEntity(false)
      .execute();
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvAffectedRange)
      .values({
        id: rangeId,
        type: 'ECOSYSTEM',
        affected: { id: affectedId },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedRange>)
      .updateEntity(false)
      .execute();
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvAffectedEvent)
      .values({
        id: randomUUID(),
        fixed: '4.99.0',
        range: { id: rangeId },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedEvent>)
      .updateEntity(false)
      .execute();
    await repo(ScaVulnerabilityDetections).update(
      { id: before.id },
      { currentState: 'ignored', stateManuallyModified: true },
    );

    // The upgrade of a Community Edition instance empties the shared
    // catalogue (every row there came from an import): without a row of its
    // own the project then reads no advisory text, never the shared one.
    const runner = h.live.dataSource.createQueryRunner();
    try {
      await new ClearImportedCatalogueContent1846460000000().up(runner);
    } finally {
      await runner.release();
    }
    const before_ = (await listOf(projectId)).vulnerabilities[0];
    expect(before_.metadata.summary).toBe('');
    expect(before_.metadata.packages.map((p) => p.fixed)).toEqual(['']);
    expect(
      await repo(VulnerabilityOsvAffected).count({
        where: { vulnerability: { id: ADVISORY } },
      }),
    ).toBe(0);

    await runImport(projectId, randomUUID(), A);
    const after = await detectionsOf(projectId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].currentState).toBe('ignored');
    const shown = await shownTo(projectId);
    expect(shown.list.summary).toBe(A.summary);
    expect(shown.list.fixed).toEqual([A.fixed]);
    expect(shown.detail.summary).toBe(A.summary);
    expect(shown.detail.fixed).toEqual([A.fixed]);
  });

  it('the project purge deletes its imported advisories, the organization purge the rest', async () => {
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const otherProject = randomUUID();
    await runImport(projectId, organizationId, A);
    await runImport(otherProject, organizationId, B);
    await h.purge.purgeProject(projectId, organizationId, Date.now() + 60_000);
    expect(await repo(ImportedAdvisory).count({ where: { projectId } })).toBe(
      0,
    );
    expect(
      await repo(ImportedAdvisory).count({
        where: { projectId: otherProject },
      }),
    ).toBe(1);
    await h.purge.purgeOrganization(organizationId, [], Date.now() + 60_000);
    expect(
      await repo(ImportedAdvisory).count({ where: { organizationId } }),
    ).toBe(0);
    // The shared root stays: other projects' findings reference it.
    expect(
      await repo(VulnerabilityOsv).count({ where: { id: ADVISORY } }),
    ).toBe(1);
  });
});
