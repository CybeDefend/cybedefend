import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';
import type { ScaService } from './sca.service';
import { SCA_DETAIL_LIMITS } from './sca.service';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
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

/**
 * LIVE spec of the SCA reads of a catalogue advisory that names several
 * packages and has large collections, on the engine LIVE_DB_TYPE selects:
 *
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=mysql \
 *     RESULTS_IMPORT_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/modules/sca/sca-advisory-reads.live.spec.ts
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/sca/sca-advisory-reads.live.spec.ts
 *
 * The finding's list and detail show the fixed version of its own package
 * and ecosystem, one CVE chosen by one rule in both, and the detail reads
 * bounded collections.
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
const describeLive = LIVE ? describe : describe.skip;

const ADVISORY = 'GHSA-reads-0001-0001';

describeLive('SCA reads of a multi-package catalogue advisory', () => {
  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let h: ImportHarness;
  const projectId = randomUUID();
  let detectionId: string;

  const insert = async <T extends object>(
    entity: new () => T,
    values: Array<Record<string, unknown>>,
  ) => {
    for (let i = 0; i < values.length; i += 200) {
      await h.live.dataSource
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values(values.slice(i, i + 200) as QueryDeepPartialEntity<T>[])
        .updateEntity(false)
        .execute();
    }
  };

  /** One affected row of ADVISORY with one fixed version. */
  const affectedRows = (
    rows: Array<{
      ecosystem: string;
      packageName: string;
      fixed: string;
      id?: string;
    }>,
    advisoryId: string = ADVISORY,
  ) => {
    const affected = rows.map((row) => ({
      id: row.id ?? randomUUID(),
      ecosystem: row.ecosystem,
      packageName: row.packageName,
      vulnerability: { id: advisoryId },
    }));
    const ranges = affected.map((aff) => ({
      id: randomUUID(),
      type: 'ECOSYSTEM',
      affected: { id: aff.id },
    }));
    const events = ranges.map((range, i) => ({
      id: randomUUID(),
      fixed: rows[i].fixed,
      range: { id: range.id },
    }));
    return { affected, ranges, events };
  };

  beforeAll(async () => {
    h = await openImportHarness(
      dialect,
      `bull-sca-advisory-reads-live-${randomUUID()}`,
    );
    await insert(VulnerabilityOsv, [
      { id: ADVISORY, summary: 'Catalogue advisory', details: 'details' },
    ]);
    // Inserted out of order: the CVE shown is the smallest one.
    await insert(VulnerabilityOsvAlias, [
      {
        id: randomUUID(),
        alias: 'CVE-2024-0003',
        vulnerability: { id: ADVISORY },
      },
      {
        id: randomUUID(),
        alias: 'CVE-2024-0001',
        vulnerability: { id: ADVISORY },
      },
      {
        id: randomUUID(),
        alias: 'CVE-2024-0002',
        vulnerability: { id: ADVISORY },
      },
    ]);
    await insert(VulnerabilityOsvSeverity, [
      {
        id: randomUUID(),
        type: 'CVSS_V3',
        score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        vulnerability: { id: ADVISORY },
      },
    ]);
    await insert(
      VulnerabilityOsvReference,
      Array.from({ length: 150 }, (_, i) => ({
        id: randomUUID(),
        type: 'WEB',
        url: `https://example.com/ref-${i}`,
        vulnerability: { id: ADVISORY },
      })),
    );
    const chain = affectedRows([
      { ecosystem: 'npm', packageName: 'lodash', fixed: '5.0.0' },
      { ecosystem: 'npm', packageName: 'lodash-es', fixed: '4.17.21' },
      { ecosystem: 'PyPI', packageName: 'lodash', fixed: '4.17.30' },
      ...Array.from({ length: 300 }, (_, i) => ({
        ecosystem: 'npm',
        packageName: `other-${i}`,
        fixed: '4.17.22',
      })),
    ]);
    await insert(VulnerabilityOsvAffected, chain.affected);
    await insert(VulnerabilityOsvAffectedRange, chain.ranges);
    await insert(VulnerabilityOsvAffectedEvent, chain.events);

    // The finding: lodash 4.17.20 (npm), matched to ADVISORY by a scanner.
    const matched = await h.live.dataSource
      .getRepository(VulnerabilityOsvAffected)
      .findOneOrFail({
        where: {
          vulnerability: { id: ADVISORY },
          packageName: 'lodash',
          ecosystem: 'npm',
        },
        relations: { vulnerability: { severities: true } },
      });
    await h.sca.ingestMatched(
      {
        projectId,
        scanId: randomUUID(),
        vulnerabilityType: 'critical,high,medium,low',
      },
      [
        {
          library: {
            name: 'lodash',
            version: '4.17.20',
            file: 'package-lock.json',
            ecosystem: 'npm',
            isTransitive: false,
            isDev: false,
            path: [],
            dependencyInfoAvailable: false,
            importLocations: [],
            licenses: [],
          },
          affected: [matched],
        },
      ],
    );
    const [detection] = await h.live.dataSource
      .getRepository(ScaVulnerabilityDetections)
      .find({ where: { projectId } });
    detectionId = detection.id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await h?.close();
  }, HOOK_TIMEOUT);

  it("shows the fixed version of the finding's own package and ecosystem in the list and the detail", async () => {
    const list = await h.sca.getProjectScaVulnerabilities({
      projectId,
      branch: 'main',
      pageNumber: 1,
      pageSizeNumber: 50,
      excludeAutofixCounts: true,
    } as Parameters<ScaService['getProjectScaVulnerabilities']>[0]);
    expect(list.vulnerabilities).toHaveLength(1);
    expect(list.vulnerabilities[0].metadata.packages[0].fixed).toBe('5.0.0');

    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId,
      vulnerabilityId: detectionId,
    });
    // Every package the advisory names, within the bound, the finding's own
    // first: its fix is the one of its own package.
    const packages = detail.sca.metadata.packages;
    expect(
      [packages[0]].map((p) => [p.ecosystem, p.packageName, p.fixed]),
    ).toEqual([['npm', 'lodash', '5.0.0']]);
    expect(packages).toHaveLength(SCA_DETAIL_LIMITS.affected);
  });

  it('shows one CVE, chosen by the same rule, in the list and the detail', async () => {
    const list = await h.sca.getProjectScaVulnerabilities({
      projectId,
      branch: 'main',
      pageNumber: 1,
      pageSizeNumber: 50,
      excludeAutofixCounts: true,
    } as Parameters<ScaService['getProjectScaVulnerabilities']>[0]);
    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId,
      vulnerabilityId: detectionId,
    });
    expect(list.vulnerabilities[0].metadata.cve).toBe('CVE-2024-0001');
    expect(detail.sca.metadata.cve).toBe('CVE-2024-0001');
  });

  it('reads bounded collections in the detail', async () => {
    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId,
      vulnerabilityId: detectionId,
    });
    const meta = detail.sca.metadata;
    expect(meta.references).toHaveLength(SCA_DETAIL_LIMITS.references);
    expect(meta.aliases.map((a) => a.alias)).toEqual([
      'CVE-2024-0001',
      'CVE-2024-0002',
      'CVE-2024-0003',
    ]);
    expect(meta.severities).toHaveLength(1);
    expect(meta.packages).toHaveLength(SCA_DETAIL_LIMITS.affected);
  });

  it("finds the finding's own rows on an advisory naming thousands of packages, by its PyPI name", async () => {
    const LARGE = 'GHSA-reads-0002-0002';
    const otherProject = randomUUID();
    await insert(VulnerabilityOsv, [{ id: LARGE }]);
    const chain = affectedRows(
      [
        ...Array.from({ length: 2_500 }, (_, i) => ({
          ecosystem: 'PyPI',
          packageName: `other-${i}`,
          fixed: '9.9.9',
          // Every other row sorts before the finding's own one.
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
        {
          ecosystem: 'PyPI',
          packageName: 'apache-airflow',
          fixed: '2.10.3',
          id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        },
      ],
      LARGE,
    );
    await insert(VulnerabilityOsvAffected, chain.affected);
    await insert(VulnerabilityOsvAffectedRange, chain.ranges);
    await insert(VulnerabilityOsvAffectedEvent, chain.events);
    const matched = await h.live.dataSource
      .getRepository(VulnerabilityOsvAffected)
      .findOneOrFail({
        where: { vulnerability: { id: LARGE }, packageName: 'apache-airflow' },
        relations: { vulnerability: { severities: true } },
      });
    await h.sca.ingestMatched(
      {
        projectId: otherProject,
        scanId: randomUUID(),
        vulnerabilityType: 'critical,high,medium,low',
      },
      [
        {
          library: {
            name: 'apache_airflow',
            version: '2.9.0',
            file: 'requirements.txt',
            ecosystem: 'pip',
            isTransitive: false,
            isDev: false,
            path: [],
            dependencyInfoAvailable: false,
            importLocations: [],
            licenses: [],
          },
          affected: [matched],
        },
      ],
    );
    const [detection] = await h.live.dataSource
      .getRepository(ScaVulnerabilityDetections)
      .find({ where: { projectId: otherProject } });
    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId: otherProject,
      vulnerabilityId: detection.id,
    });
    const packages = detail.sca.metadata.packages;
    expect(packages[0]).toMatchObject({
      packageName: 'apache-airflow',
      fixed: '2.10.3',
      fixAvailable: true,
    });
    expect(packages.length).toBeLessThanOrEqual(SCA_DETAIL_LIMITS.affected);

    const list = await h.sca.getProjectScaVulnerabilities({
      projectId: otherProject,
      branch: 'main',
      pageNumber: 1,
      pageSizeNumber: 50,
      excludeAutofixCounts: true,
    } as Parameters<ScaService['getProjectScaVulnerabilities']>[0]);
    expect(list.vulnerabilities[0].metadata.packages[0].fixed).toBe('2.10.3');
  });
});
