/**
 * A finding whose code MOVED must update its existing row, not create a second.
 *
 * WHY. The digest excludes the line number and hashes the normalised snippet, so
 * a finding that drifts from line 38 to line 41 with unchanged code produces the
 * SAME fingerprint — by design, that is the whole point. But matching is still
 * line-based (shadow mode), so ingestion does not recognise it and CREATES a
 * second row. The database then holds two rows for one finding, both correctly
 * claiming one identity.
 *
 * Such pairs on vulnerability_detections_cicd are what blocks UNIQUE (projectId, branch,
 * fingerprint) on that table. For a GRC consumer the duplicate is worse than
 * cosmetic: it opens two work items for one problem, and the triage history
 * follows whichever row the consumer happens to upsert last.
 *
 * The fix reuses the merge branch that already exists in createNewVulnerability
 * (`alreadyExists`) by widening how a candidate is found: not only by exact
 * position, but by the digest the incoming detection would carry.
 */
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
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { computeCodeFingerprint } from '../findings-export/fingerprint.util';

/**
 * The scanner RENUMBERS the snippet with the code: a finding reported at line 41
 * carries a snippet numbered 41. `normalizeSnippet` filters lines to the
 * vulnerable range and keeps only their CONTENT, so identical code at 38 and at
 * 41 normalises to the same string — which is what makes the digest survive the
 * move, and the premise of this whole feature.
 *
 * Holding the snippet at 38 while moving the bounds to 41 is not a drift, it is
 * an impossible input: the filter would yield an EMPTY region. An earlier
 * version of this file did exactly that, and every case still passed — both
 * sides of the comparison computed the digest the same wrong way. The real-MySQL
 * check in scripts/e2e-drift-merge.ts is what exposed it.
 */
const CODE = '  run: curl $URL | sh';
const snippetAt = (line: number) => [{ line, content: CODE }];

describe('a finding whose code moved merges instead of duplicating', () => {
  let service: SastIacUtilsService;
  let repos: Record<string, any>;
  let logger: any;

  const FAMILIES = [
    ['sast', SastVulnerabilityDetections],
    ['iac', IacVulnerabilityDetections],
    ['cicd', CicdVulnerabilityDetections],
    ['secret', SecretVulnerabilityDetections],
  ] as const;

  /** The digest the INCOMING detection produces — line-independent by design. */
  const digestFor = (scannerType = 'semgrep') =>
    computeCodeFingerprint({
      projectId: 'p1',
      branch: 'main',
      scannerType,
      catalogVulnId: 'cat-1',
      path: '.github/workflows/cd.yml',
      snippetLines: snippetAt(41),
      vulnerableStartLine: 41,
      vulnerableEndLine: 41,
      occurrenceIndex: 0,
    } as any);

  /** The row already in the database, stamped when the finding sat at line 38. */
  const drifted = (over: Record<string, unknown> = {}): any => ({
    id: 'old-row',
    projectId: 'p1',
    branch: 'main',
    scannerType: 'semgrep',
    path: '.github/workflows/cd.yml',
    language: 'YAML',
    vulnerableStartLine: 38,
    vulnerableEndLine: 38,
    fingerprint: digestFor(),
    currentState: 'to_verify',
    firstDetectedAt: new Date('2026-02-05T12:59:44Z'),
    vulnerability: { id: 'cat-1' },
    vulnerabilityDetectionHistory: [],
    ...over,
  });

  const dto = () =>
    ({
      ruleId: 'rule-a',
      path: '.github/workflows/cd.yml',
      language: 'YAML',
      fileHash: 'h1',
      codeSnippet: {
        vulnerableStartLine: 41,
        vulnerableEndLine: 41,
        code: snippetAt(41),
      },
      dataFlow: [],
    }) as any;

  const correspondance = (vulnerabilityType: string) =>
    ({
      ruleId: 'rule-a',
      scanner: 'semgrep',
      vulnerabilityType,
      vulnerability: { id: 'cat-1', severity: 'high' },
    }) as any;

  /**
   * The line-based lookup finds NOTHING (the line moved) while the table does
   * hold the drifted row — exactly the production shape.
   */
  const armRepo = (repo: any, existing: any) => {
    repo.find = jest.fn().mockResolvedValue([]);
    repo.findOne = jest.fn(async (opts: any) => {
      const w = opts?.where ?? {};
      return w.fingerprint && w.fingerprint === existing.fingerprint
        ? existing
        : null;
    });
  };

  beforeEach(async () => {
    const base = () => ({
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (e: any) => e),
    });
    repos = {
      sast: base(),
      iac: base(),
      cicd: base(),
      secret: base(),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        { provide: getRepositoryToken(CodeSnippet), useValue: base() },
        { provide: getRepositoryToken(DataFlowItem), useValue: base() },
        { provide: getRepositoryToken(CorrespondanceTable), useValue: base() },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: base(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: repos.sast,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: repos.iac,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: repos.cicd,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: repos.secret,
        },
        { provide: Logger, useValue: logger },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            computeEnvironmentalForProject: jest.fn(),
            recalculatePriority: jest.fn(),
            addHistoryItem: jest.fn(),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        { provide: IssueIntegrationService, useValue: {} },
        {
          // The creation path scores a brand-new row; the merge path does not.
          // Without this the two NEGATIVE cases below would fail for the wrong
          // reason — a missing mock, not a missing insert.
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest.fn(() => ({
              score: 5,
              vector: 'CVSS:4.0/',
            })),
          },
        },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'enc'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
      ],
    }).compile();

    service = module.get<SastIacUtilsService>(SastIacUtilsService);
  });

  const run = (family: string, index: number | null = 0) =>
    service.createNewVulnerability(
      dto(),
      correspondance(family),
      'scan-2',
      'p1',
      'semgrep',
      'main',
      index,
    );

  /** A row the service INSERTED carries no id; the drifted row carries 'old-row'. */
  const insertedRows = (repo: any) =>
    repo.save.mock.calls.map((c: any[]) => c[0]).filter((e: any) => !e?.id);

  it.each(FAMILIES.map(([f]) => f))(
    'does not insert a second row for a moved finding (%s)',
    async (family) => {
      const existing = drifted();
      armRepo(repos[family], existing);

      await run(family);

      expect(insertedRows(repos[family])).toHaveLength(0);
    },
  );

  it('refreshes the position of the surviving row', async () => {
    const existing = drifted();
    armRepo(repos.cicd, existing);

    await run('cicd');

    // The finding did not change; only where it sits did. A stale line would
    // send a GRC consumer, and a human, to the wrong place in the file.
    expect(existing.vulnerableStartLine).toBe(41);
    expect(existing.vulnerableEndLine).toBe(41);
  });

  it('keeps the identity of the surviving row', async () => {
    const existing = drifted();
    armRepo(repos.cicd, existing);

    await run('cicd');

    // Assert the merge HAPPENED first: without this the rest is vacuous —
    // an untouched row trivially keeps its id and its dates, so the test would
    // stay green with the merge removed. Proven by mutation.
    expect(existing.vulnerableStartLine).toBe(41);
    expect(insertedRows(repos.cicd)).toHaveLength(0);

    expect(existing.id).toBe('old-row');
    expect(existing.fingerprint).toBe(digestFor());
    // first_detected_at is a compliance-facing date: the finding has been there
    // since February, and a merge must not restate it as new.
    expect(existing.firstDetectedAt).toEqual(new Date('2026-02-05T12:59:44Z'));
  });

  it.each(['sast', 'iac', 'cicd'])(
    'never hands a dismissed row to another occurrence of its code (%s)',
    async (family) => {
      // The same code at another line may be a NEW occurrence placed above the
      // dismissed one (it takes the dismissed row's rank, hence its digest).
      // The dismissal belongs to the row it was taken on: the incoming
      // occurrence is created as a finding of its own, open, with an
      // identity other than the digest the dismissed row holds. A real move is paired by the
      // finalization, which keeps the dismissed row.
      const existing = drifted({
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedByType: 'user',
        triagedBy: 'u-manager',
        dismissalReason: 'accepted risk, internal runner',
      });
      armRepo(repos[family], existing);

      await run(family);

      expect(existing.vulnerableStartLine).toBe(38);
      expect(existing.currentState).toBe('ignored');
      expect(existing.dismissalReason).toBe('accepted risk, internal runner');
      const inserted = insertedRows(repos[family]);
      expect(inserted).toHaveLength(1);
      expect(inserted[0].currentState).toBe('to_verify');
      expect(inserted[0].vulnerableStartLine).toBe(41);
      // An identity of its own, never the one the dismissed row holds.
      expect(inserted[0].fingerprint).toEqual(expect.any(String));
      expect(inserted[0].fingerprint).not.toBe(existing.fingerprint);
    },
  );

  // The allocator returns null when a batch could not be ranked. No index means
  // no derivable digest, so there is nothing to match on: the safe answer is the
  // behaviour that shipped, not a guess.
  it('falls back to creating a row when the occurrence index is unknown', async () => {
    const existing = drifted();
    armRepo(repos.cicd, existing);

    await run('cicd', null);

    expect(insertedRows(repos.cicd).length).toBeGreaterThan(0);
  });

  /**
   * The dangerous one. Before this change a drifted finding CREATED a row, so
   * `sast`/`iac`/`secret` only ever reached the merge branch on an intra-batch
   * duplicate — which is why that branch routes them to `recordDetectionSighting`,
   * which does NOT revive. Widening the candidate search breaks that assumption:
   * a previously-resolved finding that reappears three lines down now lands here.
   *
   * Left unrevived it stays `resolved` while being actively detected — a live
   * vulnerability reported as fixed, in the dashboard and in the compliance
   * export alike. That is the worst possible failure for this feed.
   */
  it.each(['sast', 'iac', 'cicd', 'secret'])(
    'revives a resolved finding that reappears at a new line (%s)',
    async (family) => {
      const existing = drifted({
        currentState: 'resolved',
        stateManuallyModified: true,
        resolved_at: new Date('2026-07-01T00:00:00Z'),
      });
      armRepo(repos[family], existing);

      await run(family);

      expect(existing.vulnerableStartLine).toBe(41); // the merge happened
      expect(existing.currentState).toBe('to_verify');
      // The stale freeze must go too, or future scans can never manage it again.
      expect(existing.stateManuallyModified).toBe(false);
    },
  );

  it('never merges across files', async () => {
    // Same rule, same snippet, DIFFERENT file: the digest hashes the path, so
    // these are two findings and must stay two rows.
    const elsewhere = drifted({
      id: 'other-file',
      path: 'src/other.yml',
      fingerprint: 'a-different-digest',
    });
    armRepo(repos.cicd, elsewhere);

    await run('cicd');

    expect(insertedRows(repos.cicd).length).toBeGreaterThan(0);
  });
});
