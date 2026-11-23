import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { SastIacService } from './sast-iac.service';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { Logger } from 'nestjs-pino';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';

/**
 * « Seen by this scan » is a fact of the current scan's history rows, not of a
 * detection's newest row. `vulnerability_detection_history.detectedAt` has no
 * fractional seconds: two scans of one branch recorded in the same second (or
 * two overlapping scans) leave a tie, and MySQL may then hand back either row
 * as the newest. Proven on a real MySQL: a CI/CD finding the
 * second scan re-detected was resolved by that scan's finalize in 2 runs of 8.
 *
 * Every test below gives the detection a history row for the current scan
 * (what `find({ scanId })` returns) while the newest-row lookup returns an
 * older scan's row, as the tie does.
 */
describe('SastIacUtilsService — a tie on detectedAt never hides the current scan', () => {
  const CURRENT = 'scan-current';
  const OLDER = 'scan-older';

  const emptyRepo = () => ({
    ...createMockRepository(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation(async (e: unknown) => e),
  });

  const build = async (opts: {
    histRepo: any;
    sastRepo?: any;
    iacRepo?: any;
    cicdRepo?: any;
    correspondanceRepo?: any;
  }): Promise<SastIacUtilsService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: opts.correspondanceRepo ?? emptyRepo(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: opts.histRepo,
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: opts.sastRepo ?? emptyRepo(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: opts.iacRepo ?? emptyRepo(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: opts.cicdRepo ?? emptyRepo(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: emptyRepo(),
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: { addHistoryItem: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForResolvedVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecretEncryptionService, useValue: {} },
        { provide: CvssCalculatorService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    return module.get(SastIacUtilsService);
  };

  const common = (id: string, path: string) => ({
    id,
    projectId: 'p1',
    currentState: 'to_verify',
    path,
    language: 'yaml',
    vulnerableStartLine: 3,
    vulnerableEndLine: 3,
    branch: 'main',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    codeSnippets: [{ code: JSON.stringify([{ line: 3, content: 'x: 1' }]) }],
    vulnerability: { id: `vuln-${id}` },
    vulnerabilityDetectionHistory: [],
  });
  const mkSast = (id: string, path: string) =>
    Object.assign(new SastVulnerabilityDetections(), {
      ...common(id, path),
      scannerType: 'opengrep',
    });
  const mkIac = (id: string, path: string) =>
    Object.assign(new IacVulnerabilityDetections(), {
      ...common(id, path),
      scannerType: 'kics',
    });
  const mkCicd = (id: string, path: string) =>
    Object.assign(new CicdVulnerabilityDetections(), {
      ...common(id, path),
      scannerType: 'kics',
    });

  /** The current scan's rows, as `find({ where: { scanId } })` returns them. */
  const currentScanRows = (
    seen: (
      | SastVulnerabilityDetections
      | IacVulnerabilityDetections
      | CicdVulnerabilityDetections
    )[],
  ) =>
    seen.map((d) => ({
      scanId: CURRENT,
      sastVulnerabilityDetection:
        d instanceof SastVulnerabilityDetections ? d : null,
      iacVulnerabilityDetection:
        d instanceof IacVulnerabilityDetections ? d : null,
      cicdVulnerabilityDetection:
        d instanceof CicdVulnerabilityDetections ? d : null,
      secretVulnerabilityDetection: null,
    }));

  /**
   * A history repository whose newest-row lookup lands on the older scan. The
   * current scan's rows answer any read of the current scan, whether its
   * `where` is one object or one per family (the sightings read).
   */
  const tiedHistory = (rows: unknown[]) => {
    const histRepo: any = createMockRepository();
    histRepo.find.mockImplementation(async (query: any) =>
      [].concat(query?.where ?? []).some((w: any) => w?.scanId === CURRENT)
        ? rows
        : [],
    );
    histRepo.findOne.mockResolvedValue({ scanId: OLDER });
    return histRepo;
  };

  describe('finalizeOldScanVulnerabilities', () => {
    it.each([
      ['SAST', () => mkSast('sast-seen', 'app.py')],
      ['IaC', () => mkIac('iac-seen', 'main.tf')],
      ['CI/CD', () => mkCicd('cicd-seen', '.github/workflows/ci.yml')],
    ])(
      'keeps a %s finding the current scan reported, whatever the newest row says',
      async (_family, make) => {
        const seen = make();
        const utils = await build({
          histRepo: tiedHistory(currentScanRows([seen])),
        });

        await (utils as any).finalizeOldScanVulnerabilities(
          [seen],
          [],
          'p1',
          CURRENT,
          'main',
        );

        expect(seen.currentState).toBe('to_verify');
      },
    );

    it('still resolves the finding the current scan did not report', async () => {
      const seen = mkCicd('cicd-seen', '.github/workflows/ci.yml');
      const gone = mkCicd('cicd-gone', '.github/workflows/release.yml');
      const utils = await build({
        histRepo: tiedHistory(currentScanRows([seen])),
      });

      await (utils as any).finalizeOldScanVulnerabilities(
        [seen, gone],
        [],
        'p1',
        CURRENT,
        'main',
      );

      expect(seen.currentState).toBe('to_verify');
      expect(gone.currentState).toBe('resolved');
    });

    it('reads the current scan once instead of one newest-row query per finding', async () => {
      const seen = mkSast('sast-seen', 'app.py');
      const gone = mkSast('sast-gone', 'other.py');
      const histRepo = tiedHistory(currentScanRows([seen]));
      const utils = await build({ histRepo });

      await (utils as any).finalizeOldScanVulnerabilities(
        [seen, gone],
        [],
        'p1',
        CURRENT,
        'main',
      );

      expect(histRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('getExistingVulnerabilities', () => {
    it('leaves out of the line-shift map a finding the current scan already recorded, whatever the newest row says', async () => {
      const seen = mkSast('sast-seen', 'app.py');
      const notYet = mkSast('sast-not-yet', 'other.py');
      const sastRepo = emptyRepo();
      sastRepo.find.mockResolvedValue([seen, notYet]);
      const correspondanceRepo = emptyRepo();
      // One rule per catalogue vulnerability asked for, all of them at once
      // (an `In`), as `findEnabledCorrespondancesByVuln` reads them.
      correspondanceRepo.find.mockImplementation(async (query: any) =>
        []
          .concat(query.where.vulnerability.id.value ?? [])
          .map((id: string) => ({
            scanner: 'opengrep',
            ruleId: `rule-${id}`,
            vulnerability: { id },
          })),
      );
      const histRepo = tiedHistory(currentScanRows([seen]));
      const utils = await build({ histRepo, sastRepo, correspondanceRepo });

      const { existingVulnsMap } = await utils.getExistingVulnerabilities(
        'p1',
        CURRENT,
        'opengrep',
        'main',
      );

      const mapped = [...existingVulnsMap.values()].flat().map((v) => v.id);
      expect(mapped).toEqual(['sast-not-yet']);
      expect(histRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
