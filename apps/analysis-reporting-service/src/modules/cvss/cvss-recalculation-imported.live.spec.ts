import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { QueryDeepPartialEntity } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';
import type { ResultsImportJobData } from '../scan-queue/scan-queue.service';
import { CvssCalculatorService } from './cvss-calculator.service';
import { CvssRecalculationProcessor } from './cvss-recalculation.processor';
import { PriorityCalculatorService } from '../result/priority-calculator.service';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import {
  ImportHarness,
  openImportHarness,
} from '../../test-utils/results-import.live-harness';

/**
 * LIVE spec: the CVSS recalculation never re-scores an imported finding from
 * the shared advisory catalogue. On the engine LIVE_DB_TYPE selects:
 *
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/cvss/cvss-recalculation-imported.live.spec.ts
 *
 * An SCA and a container finding are imported with a critical vector; the
 * catalogue row of the same advisory id then receives a low CVSS v3 vector
 * (what an advisory synchronisation writes). The refresh after a catalogue
 * change and the full recalculation keep the vector and severity the import
 * declared; a finding matched to the catalogue is still refreshed.
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
const describeLive = LIVE ? describe : describe.skip;

const ADVISORY = 'GHSA-cvss-0001-0001';
const CATALOGUE_ADVISORY = 'GHSA-cvss-0002-0002';
const VECTOR_CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const VECTOR_LOW = 'CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:N/I:L/A:N';

const CONTEXT = {
  internetExposure: 'public',
  networkSegmentation: 'flat',
  environment: 'production',
  dataClassification: 'confidential',
  businessCriticality: 'high',
  handlesPii: false,
  handlesPaymentData: false,
  safetyCritical: false,
};

const sarif = JSON.stringify({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'acme-sca',
          rules: [
            {
              id: ADVISORY,
              shortDescription: { text: 'Imported advisory' },
              properties: {
                'security-severity': '9.8',
                cvssv3_vector: VECTOR_CRITICAL,
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
              fixedVersion: '4.17.21',
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

describeLive('CVSS recalculation of imported findings', () => {
  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let h: ImportHarness;
  let tmp: string;
  let recalculation: CvssRecalculationProcessor;

  const repo = <T extends object>(entity: new () => T) =>
    h.live.dataSource.getRepository(entity);

  const runImport = async (
    projectId: string,
    category: 'sca' | 'container',
  ) => {
    const file = join(tmp, `${randomUUID()}.sarif`);
    await writeFile(file, sarif);
    const scanId = randomUUID();
    const data: ResultsImportJobData = {
      scanId,
      projectId,
      organizationId: randomUUID(),
      branch: 'main',
      category,
      format: 'sarif',
      fileKey: file,
      ...(category === 'container'
        ? { image: 'ghcr.io/example/app:1.0.0' }
        : {}),
    };
    await h.processor.process({
      id: `results-import-${scanId}`,
      data,
    } as Job<ResultsImportJobData>);
  };

  /** What the gate and the lists read of a finding. */
  const scoreOf = (d: {
    currentSeverity: string;
    currentCVSS?: number | null;
    cvss4Vector: string | null;
    cvss4BaseScore: number | null;
  }) => ({
    severity: d.currentSeverity,
    vector: d.cvss4Vector,
    base: d.cvss4BaseScore === null ? null : Number(d.cvss4BaseScore),
  });

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cvss-imported-live-'));
    h = await openImportHarness(
      dialect,
      `bull-cvss-imported-live-${randomUUID()}`,
    );
    process.env.CYBEDEFEND_EDITION = 'community';
    recalculation = new CvssRecalculationProcessor(
      new CvssCalculatorService(),
      new PriorityCalculatorService(new ConfigService()),
      repo(SastVulnerabilityDetections),
      repo(ScaVulnerabilityDetections),
      repo(IacVulnerabilityDetections),
      repo(VulnerabilityDetectionsContainer),
      repo(SecretVulnerabilityDetections),
      repo(CicdVulnerabilityDetections),
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await h?.close();
  }, HOOK_TIMEOUT);

  it('keeps the severity and vector an import declared when the catalogue row of its id changes', async () => {
    const projectId = randomUUID();
    await runImport(projectId, 'sca');
    await runImport(projectId, 'container');
    const [sca] = await repo(ScaVulnerabilityDetections).find({
      where: { projectId },
    });
    const [container] = await repo(VulnerabilityDetectionsContainer).find({
      where: { projectId },
    });
    expect(sca.currentSeverity).toBe('CRITICAL');
    expect(container.currentSeverity).toBe('CRITICAL');
    const before = { sca: scoreOf(sca), container: scoreOf(container) };

    // The catalogue row of the same id gets a low vector.
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvSeverity)
      .values({
        id: randomUUID(),
        type: 'CVSS_V3',
        score: VECTOR_LOW,
        vulnerability: { id: ADVISORY },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>)
      .updateEntity(false)
      .execute();

    expect(
      await recalculation.refreshCvssFromOsv(projectId, [ADVISORY], CONTEXT),
    ).toBe(0);
    await recalculation.recalculateForProject(projectId, CONTEXT);

    const scaAfter = await repo(ScaVulnerabilityDetections).findOneByOrFail({
      id: sca.id,
    });
    const containerAfter = await repo(
      VulnerabilityDetectionsContainer,
    ).findOneByOrFail({ id: container.id });
    expect({
      sca: scoreOf(scaAfter),
      container: scoreOf(containerAfter),
    }).toEqual(before);
    expect(scaAfter.effectiveSeverity).toBe('critical');
    expect(containerAfter.effectiveSeverity).toBe('critical');
  });

  it('still refreshes a finding matched to the catalogue', async () => {
    const projectId = randomUUID();
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsv)
      .values({
        id: CATALOGUE_ADVISORY,
      } as QueryDeepPartialEntity<VulnerabilityOsv>)
      .updateEntity(false)
      .execute();
    await h.live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvSeverity)
      .values({
        id: randomUUID(),
        type: 'CVSS_V3',
        score: VECTOR_CRITICAL,
        vulnerability: { id: CATALOGUE_ADVISORY },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>)
      .updateEntity(false)
      .execute();
    const affected = Object.assign(new VulnerabilityOsvAffected(), {
      ecosystem: 'npm',
      packageName: 'qs',
      severity: null,
      vulnerability: await repo(VulnerabilityOsv).findOneOrFail({
        where: { id: CATALOGUE_ADVISORY },
        relations: { severities: true },
      }),
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
            name: 'qs',
            version: '6.5.2',
            file: 'package-lock.json',
            ecosystem: 'npm',
            isTransitive: false,
            isDev: false,
            path: [],
            dependencyInfoAvailable: false,
            importLocations: [],
            licenses: [],
          },
          affected: [affected],
        },
      ],
    );
    await repo(VulnerabilityOsvSeverity).update(
      { vulnerability: { id: CATALOGUE_ADVISORY } },
      { score: VECTOR_LOW },
    );
    expect(
      await recalculation.refreshCvssFromOsv(
        projectId,
        [CATALOGUE_ADVISORY],
        CONTEXT,
      ),
    ).toBe(1);
  });
});
