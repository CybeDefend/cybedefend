import { randomBytes } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { ident, sql } from '@cybedefend/db-dialect';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import {
  fingerprintForNewSastDetection,
  SastIacUtilsService,
  SecretHistoryRule,
} from './sast-iac.utils';
import { SastIacService } from './sast-iac.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import { createLoggerMock } from '../../test-utils/typeorm-mock.util';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';

/**
 * LIVE spec against a REAL database: secrets resolved at rescan, re-detected
 * secrets kept open (and reopened). The unit spec mocks the history lookup;
 * only a real database shows the history row actually carrying the secret's
 * foreign key and the `secretVulnerabilityDetection` relation answering it.
 *
 * It runs on both engines, on the one LIVE_DB_TYPE selects. The
 * schema is built by that engine's migration tracks (createLiveDatabase); it
 * used to be `synchronize`, which misses the uniques only migrations create.
 *
 * Skipped unless `SECRETS_FINALIZE_LIVE=1` (the former
 * `SECRETS_FINALIZE_MYSQL_LIVE=1` still works and means MySQL), so
 * `pnpm run test` stays hermetic. It creates a throwaway database and drops
 * it at the end.
 *
 * How to run:
 *   SECRETS_FINALIZE_LIVE=1 LIVE_DB_TYPE=mysql SECRETS_FINALIZE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=secret-finalize.live --runInBand
 *   SECRETS_FINALIZE_LIVE=1 LIVE_DB_TYPE=postgres SECRETS_FINALIZE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=secret-finalize.live --runInBand
 */
const LIVE = liveEnabled('SECRETS_FINALIZE');
const describeLive = LIVE ? describe : describe.skip;

describeLive('Secret finalization on a real MySQL', () => {
  jest.setTimeout(120_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let utils: SastIacUtilsService;
  let secretRepo: Repository<SecretVulnerabilityDetections>;
  const logger = createLoggerMock();
  // The real service, with a throwaway key: a secret's value is matched by its
  // keyed hash, and a row stored without one is read back by decryption.
  const encryption = new SecretEncryptionService({
    getSecret: () => randomBytes(32).toString('base64'),
  } as any);
  encryption.onModuleInit();
  let catalogue: Vulnerability;
  const closeIssues = jest.fn().mockResolvedValue(undefined);
  const addHistoryItem = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    // The core entities, the schema of the engine's migration tracks.
    live = await createLiveDatabase({
      prefix: 'secret_finalize',
      envPrefix: 'SECRETS_FINALIZE',
      migrations: 'track',
    });
    dataSource = live.dataSource;

    catalogue = await dataSource.getRepository(Vulnerability).save({
      name: 'AWS Access Token',
      shortDescription: 'AWS Access Token',
      description: 'A hardcoded AWS access token.',
      howToPrevent: 'Rotate it and read it from a secret manager.',
      severity: 'CRITICAL',
      language: 'generic',
      vulnerabilityType: 'secret',
      code: 'CD-SECRET-9999',
    } as Vulnerability);

    const repo = (entity: any) => ({
      provide: getRepositoryToken(entity),
      useValue: dataSource.getRepository(entity),
    });
    const module = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        repo(CodeSnippet),
        repo(DataFlowItem),
        repo(CorrespondanceTable),
        repo(VulnerabilityDetectionHistory),
        repo(SastVulnerabilityDetections),
        repo(IacVulnerabilityDetections),
        repo(CicdVulnerabilityDetections),
        repo(SecretVulnerabilityDetections),
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem,
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'high', priorityScore: 50 }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: closeIssues },
        },
        { provide: Logger, useValue: logger },
        { provide: SecretEncryptionService, useValue: encryption },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: () => null },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    utils = module.get(SastIacUtilsService);
    secretRepo = module.get(getRepositoryToken(SecretVulnerabilityDetections));
  });

  afterAll(async () => {
    await live?.drop();
  });

  const report = (
    scanId: string,
    filePath: string,
    line: number,
    scanner = 'gitleaks',
    branch = 'main',
  ) =>
    utils.createNewVulnerability(
      {
        ruleId: 'aws-access-token',
        path: filePath,
        language: 'python',
        fileHash: `hash-${filePath}`,
        secretValue: 'AKIAIOSFODNN7EXAMPLE',
        secretSource: 'head',
        codeSnippet: {
          startLine: line,
          endLine: line,
          vulnerableStartLine: line,
          vulnerableEndLine: line,
          code: [{ line, content: `AWS_KEY_${line} = "…"` }],
          language: 'python',
        },
        dataFlow: [],
      } as any,
      { vulnerabilityType: 'secret', vulnerability: catalogue } as any,
      scanId,
      'p-live',
      scanner,
      branch,
    );

  // What finalizeScan does for one scanner once its batches are in.
  const finalize = async (
    scanId: string,
    scanner = 'gitleaks',
    branch = 'main',
    historyRule?: SecretHistoryRule,
  ) => {
    const { existingSecretVulns } = await utils.getExistingVulnerabilities(
      'p-live',
      scanId,
      scanner,
      branch,
    );
    await utils.finalizeOldScanVulnerabilities(
      existingSecretVulns,
      [],
      'p-live',
      scanId,
      branch,
      undefined,
      historyRule,
    );
  };

  const stateOf = async (
    filePath: string,
    scanner = 'gitleaks',
    branch = 'main',
  ) => {
    const rows = await dataSource
      .getRepository(SecretVulnerabilityDetections)
      .find({
        where: {
          projectId: 'p-live',
          path: filePath,
          scannerType: scanner,
          branch,
        },
      });
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  // The CICD finalization path had the same save-after-history order as the first
  // draft of the secret one: a reopened CICD finding lost its current-scan
  // history row and was resolved again by the very scan that reopened it.
  it('keeps a reopened CICD finding open through the finalize of the scan that reopened it', async () => {
    const cicdRule = await dataSource.getRepository(Vulnerability).save({
      name: 'Unpinned action',
      shortDescription: 'Unpinned action',
      description: 'A GitHub Action referenced by a mutable tag.',
      howToPrevent: 'Pin it by commit SHA.',
      severity: 'HIGH',
      language: 'yaml',
      vulnerabilityType: 'cicd',
      code: 'CD-CICD-9999',
    } as Vulnerability);
    const reportCicd = (scanId: string) =>
      utils.createNewVulnerability(
        {
          ruleId: 'unpinned-action',
          path: '.github/workflows/ci.yml',
          language: 'yaml',
          fileHash: 'hash-ci',
          codeSnippet: {
            startLine: 12,
            endLine: 12,
            vulnerableStartLine: 12,
            vulnerableEndLine: 12,
            code: [{ line: 12, content: 'uses: actions/checkout@v4' }],
            language: 'yaml',
          },
          dataFlow: [],
        } as any,
        { vulnerabilityType: 'cicd', vulnerability: cicdRule } as any,
        scanId,
        'p-live',
        'zizmor',
        'main',
      );
    const finalizeCicd = async (scanId: string) => {
      const { existingCicdVulns } = await utils.getExistingVulnerabilities(
        'p-live',
        scanId,
        'zizmor',
        'main',
      );
      await utils.finalizeOldScanVulnerabilities(
        existingCicdVulns,
        [],
        'p-live',
        scanId,
        'main',
      );
    };
    const cicdState = async () =>
      (
        await dataSource
          .getRepository(CicdVulnerabilityDetections)
          .find({ where: { projectId: 'p-live', scannerType: 'zizmor' } })
      ).map((row) => row.currentState);

    await reportCicd('C1');
    await finalizeCicd('C1');
    await finalizeCicd('C2'); // not reported: resolved
    expect(await cicdState()).toEqual(['resolved']);

    // C1 and C3 land in the same second on purpose: `detectedAt` is a
    // datetime(0), so their rows tie. Finalize used to read the finding's
    // newest row with no tiebreak and resolved it whenever MySQL returned
    // C1's (2 runs in 8); it now asks whether one of C3's rows names it.
    await reportCicd('C3'); // reported again: reopened
    await finalizeCicd('C3');
    expect(await cicdState()).toEqual(['to_verify']);
  });

  it('resolves the secret a rescan no longer reports, keeps and reopens the ones it reports', async () => {
    // Scan 1 reports two secrets on main, plus one on another branch and one
    // raised under another scanner.
    await report('S1', 'a.py', 4);
    await report('S1', 'b.py', 7);
    await report('S1', 'a.py', 4, 'gitleaks', 'dev');
    await report('S1', 'c.tf', 3, 'checkov');
    await finalize('S1');
    expect((await stateOf('a.py')).currentState).toBe('to_verify');
    expect((await stateOf('b.py')).currentState).toBe('to_verify');

    // The history rows carry the secret's foreign key.
    const linked = await dataSource
      .getRepository(VulnerabilityDetectionHistory)
      .find({
        where: { scanId: 'S1' },
        relations: ['secretVulnerabilityDetection'],
      });
    expect(linked).toHaveLength(4);
    expect(linked.every((h) => !!h.secretVulnerabilityDetection)).toBe(true);

    // Scan 2: b.py was added to .cybeignore, so only a.py is reported.
    await report('S2', 'a.py', 4);
    await finalize('S2');
    expect((await stateOf('a.py')).currentState).toBe('to_verify');
    const b = await stateOf('b.py');
    expect(b.currentState).toBe('resolved');
    expect(b.resolvedAt).not.toBeNull();
    expect(closeIssues).toHaveBeenLastCalledWith(
      'p-live',
      [b.id],
      'file_deleted_or_fixed',
      'secret',
    );
    // Other branch and other scanner untouched.
    expect((await stateOf('a.py', 'gitleaks', 'dev')).currentState).toBe(
      'to_verify',
    );
    expect((await stateOf('c.tf', 'checkov')).currentState).toBe('to_verify');

    // Scan 3: b.py comes back, a.py is gone.
    await report('S3', 'b.py', 7);
    await finalize('S3');
    const reopened = await stateOf('b.py');
    expect(reopened.id).toBe(b.id);
    expect(reopened.currentState).toBe('to_verify');
    expect(reopened.resolvedAt).toBeNull();
    expect((await stateOf('a.py')).currentState).toBe('resolved');
  });

  // Until this change every secret history row was written with no detection
  // linked: that is what production holds. The first rescan after the deploy
  // must keep the secret it reports again and resolve only the one it no
  // longer reports, without creating a second row for the first.
  it('handles secrets whose history predates the link (first rescan after the deploy)', async () => {
    await report('P0', 'kept.py', 5, 'gitleaks', 'pre-deploy');
    await report('P0', 'dropped.py', 6, 'gitleaks', 'pre-deploy');
    const unlink = sql`UPDATE vulnerability_detection_history SET ${ident('secretVulnerabilityDetectionId')} = NULL WHERE ${ident('scanId')} = ${'P0'}`;
    await dataSource.query(unlink.text, unlink.params);

    await report('P1', 'kept.py', 5, 'gitleaks', 'pre-deploy');
    await finalize('P1', 'gitleaks', 'pre-deploy');

    // stateOf expects exactly one row per secret.
    expect(
      (await stateOf('kept.py', 'gitleaks', 'pre-deploy')).currentState,
    ).toBe('to_verify');
    expect(
      (await stateOf('dropped.py', 'gitleaks', 'pre-deploy')).currentState,
    ).toBe('resolved');
  });

  // The Gitleaks scanner reports a secret from two passes: the HEAD pass at
  // its current line (file hash, snippet, no commit), the history pass at the
  // line of the commit that introduced it (commit, no file hash, no snippet).
  // Both are one finding, matched on the keyed hash of the value.
  // Token-shaped values built at runtime: no literal in this file matches a
  // secret scanner's rule.
  const fakeToken = (body: string) => ['ghp', body].join('_');
  const PASS_VALUE = fakeToken('9fK2xQ7mZt4LwR8vN1bJc6Hd3Ys5Ae0Ug2Pq');
  const PASS_COMMIT = 'c0ffee1234567890abcdef1234567890abcdef12';
  const OLD_VALUE = fakeToken('OLD0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV');
  const OTHER_VALUE = fakeToken('K2nW8xY3zA6bC9dE2fG5hJ8kL1mN4pQ7rS0t');
  const OTHER_COMMIT = 'deadbeef1234567890abcdef1234567890abcdef';
  const passDto = (
    pass: 'head' | 'history',
    line: number,
    value = PASS_VALUE,
    commitSha = PASS_COMMIT,
  ) =>
    ({
      ruleId: 'github-pat',
      path: 'config/settings.py',
      language: 'python',
      fileHash: pass === 'head' ? 'hash-settings' : '',
      secretValue: value,
      secretSource: pass === 'head' ? 'head' : 'history',
      secretPass: pass,
      ...(pass === 'history' ? { commitSha } : {}),
      codeSnippet: {
        startLine: line,
        endLine: line,
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        code:
          pass === 'head' ? [{ line, content: 'GITHUB_TOKEN = "****"' }] : [],
        language: 'python',
      },
      dataFlow: [],
    }) as any;
  const reportPass = (
    scanId: string,
    pass: 'head' | 'history',
    line: number,
    branch: string,
    value = PASS_VALUE,
    commitSha = PASS_COMMIT,
  ) =>
    utils.createNewVulnerability(
      {
        ...passDto(pass, line, value, commitSha),
      } as any,
      { vulnerabilityType: 'secret', vulnerability: catalogue } as any,
      scanId,
      'p-live',
      'gitleaks',
      branch,
    );
  const rowsOn = (branch: string) =>
    secretRepo.find({
      where: { projectId: 'p-live', path: 'config/settings.py', branch },
      relations: ['vulnerabilityDetectionHistory'],
      order: { vulnerableStartLine: 'ASC' },
    });
  const runSql = async (statement: { text: string; params: unknown[] }) => {
    await dataSource.query(statement.text, statement.params);
  };

  it('head and history occurrences of one secret are one row', async () => {
    const branch = 'passes';
    await reportPass('HP1', 'head', 12, branch);
    await reportPass('HP1', 'history', 3, branch);
    await finalize('HP1', 'gitleaks', branch);

    // stateOf expects exactly one row.
    const row = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(row.secretValueHash).toBe(encryption.hashSecretValue(PASS_VALUE));
    expect(row.commitSha).toBe(PASS_COMMIT);
    expect(row.source).toBe('head');
    expect(row.currentState).toBe('to_verify');
    expect(row.vulnerableStartLine).toBe(12);
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // Next scan: the secret moved four lines lower; its commit is no longer
    // in the history range, so only the HEAD pass reports it.
    await reportPass('HP2', 'head', 16, branch);
    await finalize('HP2', 'gitleaks', branch);
    const moved = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(moved.id).toBe(row.id);
    expect(moved.currentState).toBe('to_verify');
    expect(moved.vulnerableStartLine).toBe(16);
    expect(moved.commitSha).toBe(PASS_COMMIT);
    expect(moved.fingerprint).toBe(row.fingerprint);
  });

  it('a row stored before value hashes takes the hash of the secret it matches by position', async () => {
    const branch = 'pre-hash';
    await reportPass('LH1', 'head', 12, branch);
    const legacy = await stateOf('config/settings.py', 'gitleaks', branch);
    const clear = sql`UPDATE vulnerability_detections_secret SET ${ident('secretValueHash')} = NULL WHERE ${ident('id')} = ${legacy.id}`;
    await dataSource.query(clear.text, clear.params);

    await reportPass('LH2', 'head', 12, branch);
    await reportPass('LH2', 'history', 3, branch);
    await finalize('LH2', 'gitleaks', branch);

    const row = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(row.id).toBe(legacy.id);
    expect(row.secretValueHash).toBe(encryption.hashSecretValue(PASS_VALUE));
    expect(row.commitSha).toBe(PASS_COMMIT);
    expect(row.currentState).toBe('to_verify');
  });
  it('a new history-only secret in a file that already holds another history-only secret of the same rule is its own finding', async () => {
    const branch = 'incremental';
    // Scan 1: the history pass reports K1, gone from HEAD.
    await reportPass('IH1', 'history', 5, branch);
    await finalize('IH1', 'gitleaks', branch);
    // Scan 2: the incremental pass reports only the new commit, holding K2.
    await reportPass('IH2', 'history', 9, branch, OTHER_VALUE, OTHER_COMMIT);

    const rows = await rowsOn(branch);
    expect(rows).toHaveLength(2);
    const [k1, k2] = rows;
    expect(k2.secretValueHash).toBe(encryption.hashSecretValue(OTHER_VALUE));
    expect(k2.commitSha).toBe(OTHER_COMMIT);
    expect(k2.vulnerableStartLine).toBe(9);
    expect(k2.fingerprint).not.toBe(k1.fingerprint);
    // K1 untouched: line, commit, state, and no sighting by scan 2.
    expect(k1.secretValueHash).toBe(encryption.hashSecretValue(PASS_VALUE));
    expect(k1.vulnerableStartLine).toBe(5);
    expect(k1.commitSha).toBe(PASS_COMMIT);
    expect(k1.currentState).toBe('to_verify');
    expect(k1.vulnerabilityDetectionHistory.map((h) => h.scanId)).toEqual([
      'IH1',
    ]);
  });

  it('an unhashed row holding another value is never claimed', async () => {
    const branch = 'rotated';
    // The old value, stored before value hashes existed, at line 4.
    await reportPass('RT1', 'head', 4, branch, OLD_VALUE);
    const [old] = await rowsOn(branch);
    await runSql(
      sql`UPDATE vulnerability_detections_secret SET ${ident('secretValueHash')} = NULL WHERE ${ident('id')} = ${old.id}`,
    );

    // Rotated in place: the history pass reports the new value at line 4,
    // with no file hash, so its position alone matches the old row.
    await reportPass('RT2', 'history', 4, branch);

    const rows = await rowsOn(branch);
    expect(rows).toHaveLength(2);
    const kept = rows.find((r) => r.id === old.id);
    const fresh = rows.find((r) => r.id !== old.id);
    expect(kept.secretValueHash).toBe(encryption.hashSecretValue(OLD_VALUE));
    expect(kept.commitSha).toBeNull();
    expect(fresh.secretValueHash).toBe(encryption.hashSecretValue(PASS_VALUE));
    expect(fresh.commitSha).toBe(PASS_COMMIT);
  });

  // A row that holds no value cannot be read back: a report matching it by
  // position claims it with a conditional update. When a report of another
  // value claims it first, this one is a new finding, and its insert must not
  // collide with the claimed row's fingerprint under the unique index.
  it('a report that loses the claim of a row without a value is stored as its own finding', async () => {
    const branch = 'claim-race';
    await reportPass('CR1', 'head', 4, branch, OLD_VALUE);
    const [legacy] = await rowsOn(branch);
    // Make it a row stored before hashes and without its value, carrying the
    // snippet digest the next report computes at that position.
    const legacyDigest = fingerprintForNewSastDetection(
      passDto('head', 4),
      { vulnerability: catalogue },
      'p-live',
      'gitleaks',
      branch,
      0,
    );
    await runSql(
      sql`UPDATE vulnerability_detections_secret SET ${ident('secretValueHash')} = NULL, ${ident('encryptedSecret')} = NULL, ${ident('fingerprint')} = ${legacyDigest} WHERE ${ident('id')} = ${legacy.id}`,
    );

    // Another value's report claims the row between this report's lookup
    // and its conditional update.
    const otherHash = encryption.hashSecretValue(OTHER_VALUE);
    const update = secretRepo.update.bind(secretRepo);
    const spy = jest
      .spyOn(secretRepo, 'update')
      .mockImplementation(async (criteria: any, patch: any) => {
        if (typeof criteria === 'object' && 'secretValueHash' in criteria) {
          await runSql(
            sql`UPDATE vulnerability_detections_secret SET ${ident('secretValueHash')} = ${otherHash} WHERE ${ident('id')} = ${legacy.id}`,
          );
        }
        return update(criteria, patch);
      });
    logger.warn.mockClear();
    try {
      await reportPass('CR2', 'head', 4, branch);
    } finally {
      spy.mockRestore();
    }

    const rows = await rowsOn(branch);
    expect(rows).toHaveLength(2);
    const claimed = rows.find((r) => r.id === legacy.id);
    const fresh = rows.find((r) => r.id !== legacy.id);
    expect(claimed.secretValueHash).toBe(otherHash);
    expect(claimed.fingerprint).toBe(legacyDigest);
    expect(fresh.secretValueHash).toBe(encryption.hashSecretValue(PASS_VALUE));
    expect(fresh.fingerprint).not.toBe(legacyDigest);
    expect(fresh.vulnerabilityDetectionHistory.map((h) => h.scanId)).toEqual([
      'CR2',
    ]);
    expect(
      logger.warn.mock.calls.filter((c: unknown[]) =>
        String(c[0]).startsWith('DETECTION_RACE_LOST'),
      ),
    ).toEqual([]);
  });
  // Incremental history: a scan resolves a secret by absence only from its
  // HEAD pass. A secret that left the code but whose commit a history pass
  // named stays open as a history finding, and no later incremental pass
  // resolves it. The switch is a narrow UPDATE: the row's history rows (the
  // cascaded relation) must survive it.
  it('a secret removed from the code but in scanned history stays open as a history finding', async () => {
    const branch = 'incremental-history';
    const firstFull: SecretHistoryRule = {
      outcome: 'ok',
      mode: 'full',
      firstPass: true,
      ignoredPaths: new Set(),
    };
    const incremental: SecretHistoryRule = {
      outcome: 'ok',
      mode: 'incremental',
      firstPass: false,
      ignoredPaths: new Set(),
    };
    // Scan 1, the branch's first full pass: the secret is in the code (HEAD
    // pass) and in the commit that introduced it (history pass). Another
    // secret is in the code only, its commit never scanned.
    await reportPass('IN1', 'head', 12, branch);
    await reportPass('IN1', 'history', 3, branch);
    await report('IN1', 'only-code.py', 7, 'gitleaks', branch);
    await finalize('IN1', 'gitleaks', branch, firstFull);
    const before = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(before.source).toBe('head');
    expect(before.commitSha).toBe(PASS_COMMIT);

    // Scan 2, incremental: both secrets were removed from the code; the new
    // commits hold neither, so neither pass reports them.
    addHistoryItem.mockClear();
    await finalize('IN2', 'gitleaks', branch, incremental);

    const moved = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(moved.id).toBe(before.id);
    expect(moved.source).toBe('history');
    expect(moved.currentState).toBe('to_verify');
    expect(moved.resolvedAt).toBeNull();
    const sourceChanges = addHistoryItem.mock.calls
      .map((c) => c[0])
      .filter((item) => item.type === 'source_change');
    expect(sourceChanges).toHaveLength(1);
    expect(sourceChanges[0].value).toBe('history');
    expect(sourceChanges[0].secretVulnerabilityDetection.id).toBe(moved.id);
    // The scan 1 history row still names the finding.
    const rows = await dataSource
      .getRepository(VulnerabilityDetectionHistory)
      .find({
        where: { scanId: 'IN1' },
        relations: ['secretVulnerabilityDetection'],
      });
    expect(
      rows.filter((h) => h.secretVulnerabilityDetection?.id === moved.id),
    ).toHaveLength(1);
    // The code-only secret had no history evidence: resolved.
    const codeOnly = await stateOf('only-code.py', 'gitleaks', branch);
    expect(codeOnly.currentState).toBe('resolved');

    // Scan 3, incremental again: the history finding is never resolved by
    // absence, and its source changes once.
    addHistoryItem.mockClear();
    await finalize('IN3', 'gitleaks', branch, incremental);
    const kept = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(kept.currentState).toBe('to_verify');
    expect(kept.source).toBe('history');
    expect(addHistoryItem).not.toHaveBeenCalled();
  });

  // An upload (a ZIP, the CLI) records no history pass. It must never close
  // a finding with git evidence: the branch's next pass is incremental and
  // never reads those commits again, so it would stay closed for good.
  it('a ZIP or CLI upload never resolves a finding with git evidence', async () => {
    const branch = 'upload';
    const setCommit = (id: string) =>
      runSql(
        sql`UPDATE vulnerability_detections_secret SET ${ident('commitSha')} = ${PASS_COMMIT} WHERE ${ident('id')} = ${id}`,
      );
    // Scan 1, with history: a history-only secret, a code secret whose
    // commit a history pass named, a code secret without one.
    await reportPass('UP1', 'history', 3, branch);
    await report('UP1', 'with-commit.py', 7, 'gitleaks', branch);
    await setCommit((await stateOf('with-commit.py', 'gitleaks', branch)).id);
    await report('UP1', 'no-commit.py', 9, 'gitleaks', branch);
    await finalize('UP1', 'gitleaks', branch, {
      outcome: 'ok',
      mode: 'full',
      firstPass: true,
      ignoredPaths: new Set(),
    });

    // Scan 2, an upload of a tree that holds none of them.
    await finalize('UP2', 'gitleaks', branch, {
      outcome: null,
      mode: null,
      firstPass: false,
      ignoredPaths: new Set(),
    });

    const inHistory = await stateOf('config/settings.py', 'gitleaks', branch);
    expect(inHistory.source).toBe('history');
    expect(inHistory.currentState).toBe('to_verify');
    const moved = await stateOf('with-commit.py', 'gitleaks', branch);
    expect(moved.source).toBe('history');
    expect(moved.currentState).toBe('to_verify');
    const gone = await stateOf('no-commit.py', 'gitleaks', branch);
    expect(gone.currentState).toBe('resolved');
  });

  // The branch's first full pass read its whole history: a code finding with
  // a commit it did not report is not in that history (a legacy row its
  // reports did not match), and is resolved rather than kept for good.
  it('a code finding with a commit, not reported by a first full pass, is resolved', async () => {
    const branch = 'first-full-stale';
    await report('FS1', 'legacy.py', 4, 'gitleaks', branch);
    const legacy = await stateOf('legacy.py', 'gitleaks', branch);
    await runSql(
      sql`UPDATE vulnerability_detections_secret SET ${ident('commitSha')} = ${PASS_COMMIT} WHERE ${ident('id')} = ${legacy.id}`,
    );

    await finalize('FS2', 'gitleaks', branch, {
      outcome: 'ok',
      mode: 'full',
      firstPass: true,
      ignoredPaths: new Set(),
    });

    const row = await stateOf('legacy.py', 'gitleaks', branch);
    expect(row.currentState).toBe('resolved');
    expect(row.source).toBe('head');
  });

  // The customer excludes a path in the ignore file: the scanner drops its
  // findings and says so. Finalize closes the secrets held there, history
  // findings and findings with git evidence included, and no other.
  it('an excluded path closes its secrets on both engines', async () => {
    const branch = 'ignored-paths';
    const setCommit = (id: string) =>
      runSql(
        sql`UPDATE vulnerability_detections_secret SET ${ident('commitSha')} = ${PASS_COMMIT} WHERE ${ident('id')} = ${id}`,
      );
    await report('IG1', 'tests/fixtures.py', 3, 'gitleaks', branch);
    await report('IG1', 'src/app.py', 5, 'gitleaks', branch);
    await setCommit(
      (await stateOf('tests/fixtures.py', 'gitleaks', branch)).id,
    );
    await setCommit((await stateOf('src/app.py', 'gitleaks', branch)).id);
    await runSql(
      sql`UPDATE vulnerability_detections_secret SET ${ident('source')} = 'history' WHERE ${ident('path')} = 'tests/fixtures.py'`,
    );

    await finalize('IG2', 'gitleaks', branch, {
      outcome: 'ok',
      mode: 'incremental',
      firstPass: false,
      ignoredPaths: new Set(['tests/fixtures.py']),
    });

    const excluded = await stateOf('tests/fixtures.py', 'gitleaks', branch);
    expect(excluded.currentState).toBe('resolved');
    const kept = await stateOf('src/app.py', 'gitleaks', branch);
    expect(kept.currentState).toBe('to_verify');
    expect(kept.source).toBe('history');
  });
});
