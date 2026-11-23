/**
 * Two TWIN findings of one scan must be stored as ONE detection.
 *
 * WHY. Two scanner rules mapped to the SAME catalogue vulnerability that fire
 * on the SAME line are one finding. `createNewVulnerability` knows it: it looks
 * up an identical detection (position + catalogue vuln + fileHash) and merges
 * into it instead of inserting. But that lookup-then-insert is not serialized,
 * and ingestion is concurrent (3 workers per BullMQ batch, batches of one
 * scanner consumed concurrently across KEDA-scaled pods), while
 * `existingVulnsMap` is a batch-start snapshot that never sees a row created
 * during the batch. When both twins look up before either inserts, both
 * insert.
 *
 * Two rows for one finding then break the next scan: both twins re-detect the
 * first row, the second is never processed, and finalize marks it `resolved`
 * although nothing was fixed. Reproduced on a real MySQL: two rows in 25 runs
 * out of 25 without the lock.
 *
 * The fix serializes "duplicate lookup -> create" PER POSITION with a short
 * Redis lock, so the second twin re-runs the unchanged lookup once the first
 * has written its row, and takes the existing merge path.
 */
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { VulnerabilityDtoRequest } from '@grpc/analysis-reporting/result';
import {
  detectionCreationLockKey,
  SastIacUtilsService,
} from './sast-iac.utils';
import { SastIacService } from './sast-iac.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

describe('detectionCreationLockKey', () => {
  const dto = (over: Record<string, unknown> = {}, lines = [17, 17]) =>
    ({
      ruleId: 'python.lang.security.formatted-sql-query',
      path: 'app.py',
      language: 'python',
      fileHash: 'hash-1',
      codeSnippet: {
        vulnerableStartLine: lines[0],
        vulnerableEndLine: lines[1],
      },
      ...over,
    }) as unknown as VulnerabilityDtoRequest;
  const catalogue = (id = 'cat-1305') => ({ vulnerability: { id } });
  const keyOf = (
    d = dto(),
    c = catalogue(),
    projectId = 'p1',
    scanner = 'opengrep',
    branch: string | undefined = 'main',
  ) => detectionCreationLockKey(d, c, projectId, scanner, branch);

  it('gives two twins — different rule ids, one catalogue vuln, one position — the same key', () => {
    expect(keyOf(dto({ ruleId: 'python.lang.security.rule-a' }))).toBe(
      keyOf(dto({ ruleId: 'python.django.security.rule-b' })),
    );
  });

  it('leaves fileHash out of the key: coarser than the lookup is safe, finer could miss', () => {
    expect(keyOf(dto({ fileHash: 'hash-1' }))).toBe(
      keyOf(dto({ fileHash: 'hash-2' })),
    );
    expect(keyOf(dto({ fileHash: undefined }))).toBe(keyOf());
  });

  it.each<[string, () => string]>([
    ['start line', () => keyOf(dto({}, [18, 17]))],
    ['end line', () => keyOf(dto({}, [17, 18]))],
    ['path', () => keyOf(dto({ path: 'db.py' }))],
    ['language', () => keyOf(dto({ language: 'python3' }))],
    ['catalogue vulnerability', () => keyOf(dto(), catalogue('cat-9999'))],
    ['project', () => keyOf(dto(), catalogue(), 'p2')],
    ['scanner', () => keyOf(dto(), catalogue(), 'p1', 'bandit')],
    ['branch', () => keyOf(dto(), catalogue(), 'p1', 'opengrep', 'dev')],
  ])('gives a different key when the %s differs', (_label, other) => {
    expect(other()).not.toBe(keyOf());
  });

  it('treats a missing branch like an empty one, as the lookup does', () => {
    // `dupWhereBase` filters on the branch only when it is truthy. Called
    // directly: `keyOf`'s default parameter would turn `undefined` into 'main'.
    const withBranch = (branch: string | undefined) =>
      detectionCreationLockKey(dto(), catalogue(), 'p1', 'opengrep', branch);
    expect(withBranch(undefined)).toBe(withBranch(''));
    expect(withBranch(undefined)).not.toBe(withBranch('main'));
  });

  it('frames its components so one cannot bleed into the next', () => {
    expect(keyOf(dto({ path: 'a', language: 'bc' }))).not.toBe(
      keyOf(dto({ path: 'ab', language: 'c' })),
    );
  });

  it('is a namespaced sha256, never the raw (customer) path', () => {
    const key = keyOf(dto({ path: 'secret/customer/path.py' }));
    expect(key).toMatch(/^sast-iac:detection-lock:[0-9a-f]{64}$/);
    expect(key).not.toContain('customer');
  });

  // A secret with a value is looked up first on its value hash, at any line of
  // its file: the lock must span lines too, or the same secret reported at
  // two lines by two batches is stored twice.
  describe('for a secret with a value hash', () => {
    const valueKey = (
      d = dto(),
      hash = 'h:value-1',
      c = catalogue(),
      projectId = 'p1',
      scanner = 'gitleaks',
      branch: string | undefined = 'main',
    ) => detectionCreationLockKey(d, c, projectId, scanner, branch, hash);

    it('gives the same secret at two lines of one file the same key', () => {
      expect(valueKey(dto({}, [17, 17]))).toBe(valueKey(dto({}, [42, 43])));
      // The value lookup does not read the language either.
      expect(valueKey(dto({ language: 'python' }))).toBe(
        valueKey(dto({ language: 'text' })),
      );
    });

    it.each<[string, () => string]>([
      ['value hash', () => valueKey(dto(), 'h:value-2')],
      ['path', () => valueKey(dto({ path: 'db.py' }))],
      [
        'catalogue vulnerability',
        () => valueKey(dto(), 'h:value-1', catalogue('cat-9999')),
      ],
      ['project', () => valueKey(dto(), 'h:value-1', catalogue(), 'p2')],
      [
        'scanner',
        () => valueKey(dto(), 'h:value-1', catalogue(), 'p1', 'trufflehog'),
      ],
      [
        'branch',
        () =>
          valueKey(dto(), 'h:value-1', catalogue(), 'p1', 'gitleaks', 'dev'),
      ],
    ])('gives a different key when the %s differs', (_label, other) => {
      expect(other()).not.toBe(valueKey());
    });

    it('never shares a key with a position', () => {
      expect(valueKey()).not.toBe(keyOf(dto(), catalogue(), 'p1', 'gitleaks'));
      expect(valueKey()).toMatch(/^sast-iac:detection-lock:[0-9a-f]{64}$/);
    });

    it('falls back to the position key without a value hash', () => {
      expect(
        detectionCreationLockKey(
          dto(),
          catalogue(),
          'p1',
          'gitleaks',
          'main',
          null,
        ),
      ).toBe(keyOf(dto(), catalogue(), 'p1', 'gitleaks'));
    });
  });
});

describe('createNewVulnerability — per-position creation lock', () => {
  const PROJECT = 'p1';
  const SCAN = 'scan-1';
  const SCANNER = 'opengrep';
  const BRANCH = 'main';
  const SQLI = `    cur.execute("SELECT * FROM users WHERE name = '%s'" % name)`;
  const FAMILIES = ['sast', 'iac', 'cicd', 'secret'];

  type LockProvider = Pick<
    ScanQueueService,
    'acquireDetectionCreationLock' | 'releaseDetectionCreationLock'
  >;
  type Row = { id?: string } & Record<string, unknown>;

  let events: string[];
  let rows: Record<string, Row[]>;
  let repos: Record<string, ReturnType<typeof table>>;
  let logger: ReturnType<typeof createLoggerMock>;

  /**
   * A detection table: `find` answers from what `save` inserted, one
   * macrotask later, like a database round trip — which is what lets two
   * concurrent calls interleave between the lookup and the insert.
   */
  const table = (family: string) => {
    rows[family] = [];
    const roundTrip = () => new Promise((resolve) => setImmediate(resolve));
    return {
      ...createMockRepository(),
      find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        events.push(`find:${family}`);
        await roundTrip();
        return rows[family].filter((r) =>
          [
            'projectId',
            'scannerType',
            'path',
            'language',
            'vulnerableStartLine',
            'vulnerableEndLine',
            'branch',
          ].every((f) => where[f] === undefined || r[f] === where[f]),
        );
      }),
      // Answers the secret value lookup; the fingerprint (drift) lookup finds
      // nothing, as before.
      findOne: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.secretValueHash === undefined) return null;
          events.push(`findOne:${family}`);
          await roundTrip();
          return (
            rows[family].find((r) =>
              [
                'projectId',
                'scannerType',
                'path',
                'branch',
                'secretValueHash',
              ].every((f) => where[f] === undefined || r[f] === where[f]),
            ) ?? null
          );
        },
      ),
      save: jest.fn(async (entity: Row) => {
        events.push(`save:${family}`);
        await roundTrip();
        if (!entity.id) {
          entity.id = `${family}-row-${rows[family].length + 1}`;
          rows[family].push(entity);
        }
        return entity;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
    };
  };

  const recorder = (name: string) => ({
    ...createMockRepository(),
    save: jest.fn(async (entity: unknown) => {
      events.push(`save:${name}`);
      return entity;
    }),
  });

  const build = async (lock?: LockProvider) => {
    events = [];
    rows = {};
    logger = createLoggerMock();
    repos = Object.fromEntries(FAMILIES.map((f) => [f, table(f)]));
    const moduleRef = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: recorder('snippet'),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: recorder('dataflow'),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: recorder('history'),
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
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'urgent', priorityScore: 70 }),
          },
        },
        { provide: IssueIntegrationService, useValue: {} },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest.fn(() => ({
              vector:
                'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N',
              baseScore: 8.7,
            })),
          },
        },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'v1:iv:ct:tag'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        ...(lock ? [{ provide: ScanQueueService, useValue: lock }] : []),
      ],
    }).compile();
    return moduleRef.get(SastIacUtilsService);
  };

  const dto = (over: Record<string, unknown> = {}) =>
    ({
      ruleId: 'python.lang.security.formatted-sql-query',
      path: 'app.py',
      language: 'python',
      fileHash: 'hash-1',
      description: '',
      // Realistic (high-entropy) so the secret family is not dropped as a fake.
      secretValue: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9aQ1Lm',
      codeSnippet: {
        startLine: 16,
        endLine: 18,
        vulnerableStartLine: 17,
        vulnerableEndLine: 17,
        code: [{ line: 17, content: SQLI }],
        language: 'python',
      },
      dataFlow: [],
      ...over,
    }) as unknown as VulnerabilityDtoRequest;

  const correspondance = (vulnerabilityType = 'sast') =>
    ({
      ruleId: 'formatted-sql-query',
      scanner: SCANNER,
      vulnerabilityType,
      vulnerability: { id: 'cat-1305', severity: 'high' },
    }) as unknown as CorrespondanceTable;

  const create = (
    utils: SastIacUtilsService,
    family = 'sast',
    finding = dto(),
    occurrenceIndex: number | null = 0,
  ) =>
    utils.createNewVulnerability(
      finding,
      correspondance(family),
      SCAN,
      PROJECT,
      SCANNER,
      BRANCH,
      occurrenceIndex,
    );

  /** Records the order of its calls into `events`. */
  const recordingLock = (answer: string | null = 'token-1') => ({
    acquireDetectionCreationLock: jest.fn(async () => {
      events.push('acquire');
      return answer;
    }),
    releaseDetectionCreationLock: jest.fn(async () => {
      events.push('release');
      return true;
    }),
  });

  /** The Redis lock's semantics in memory: one holder per key, others poll. */
  const inMemoryLock = () => {
    const held = new Map<string, string>();
    return {
      acquireDetectionCreationLock: jest.fn(async (key: string) => {
        while (held.has(key)) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        const token = randomUUID();
        held.set(key, token);
        return token;
      }),
      releaseDetectionCreationLock: jest.fn(
        async (key: string, token: string) => {
          if (held.get(key) !== token) return false;
          held.delete(key);
          return true;
        },
      ),
    };
  };

  const twins = (utils: SastIacUtilsService) =>
    Promise.all([
      create(utils, 'sast', dto({ ruleId: 'python.lang.security.rule-a' }), 0),
      create(
        utils,
        'sast',
        dto({ ruleId: 'python.django.security.rule-b' }),
        1,
      ),
    ]);

  const lockWarnings = () =>
    logger.warn.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.startsWith('DETECTION_LOCK'));

  it.each(FAMILIES)(
    'takes the position lock before the duplicate lookup and releases it after the row, its history and its snippet (%s)',
    async (family) => {
      const lock = recordingLock();
      const utils = await build(lock);

      await create(utils, family);

      // A secret with a value is keyed on its value hash (see below).
      const key = detectionCreationLockKey(
        dto(),
        correspondance(family),
        PROJECT,
        SCANNER,
        BRANCH,
        family === 'secret' ? 'h:' + dto().secretValue : undefined,
      );
      expect(lock.acquireDetectionCreationLock).toHaveBeenCalledWith(key);
      expect(lock.releaseDetectionCreationLock).toHaveBeenCalledWith(
        key,
        'token-1',
      );
      expect(rows[family]).toHaveLength(1);
      expect(events[0]).toBe('acquire');
      expect(events.indexOf('acquire')).toBeLessThan(
        events.indexOf(`find:${family}`),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          `save:${family}`,
          'save:history',
          'save:snippet',
        ]),
      );
      expect(events[events.length - 1]).toBe('release');
      expect(lockWarnings()).toEqual([]);
    },
  );

  it.each<[string, (repo: ReturnType<typeof table>) => void]>([
    ['lookup', (repo) => repo.find.mockRejectedValueOnce(new Error('boom'))],
    ['insert', (repo) => repo.save.mockRejectedValueOnce(new Error('boom'))],
  ])(
    'releases the lock when the %s throws, and lets the error through',
    async (_step, breakIt) => {
      const lock = recordingLock();
      const utils = await build(lock);
      breakIt(repos.sast);

      await expect(create(utils)).rejects.toThrow('boom');

      expect(lock.releaseDetectionCreationLock).toHaveBeenCalledWith(
        expect.any(String),
        'token-1',
      );
      expect(events[events.length - 1]).toBe('release');
    },
  );

  it('makes the twin that waited re-run the lookup, find the row its holder created, and merge into it', async () => {
    const utils = await build(inMemoryLock());

    await twins(utils);

    expect(rows.sast).toHaveLength(1);
    const lookups: Row[][] = await Promise.all(
      repos.sast.find.mock.results.map((r) => r.value),
    );
    expect(lookups.map((found) => found.map((r) => r.id))).toEqual([
      [],
      ['sast-row-1'],
    ]);
  });

  it('control — the same interleaving without any lock stores TWO rows (the production race)', async () => {
    // Proves the harness above really interleaves: without this, the
    // single-row assertion could pass for a harness that never raced.
    const utils = await build();

    await twins(utils);

    expect(rows.sast).toHaveLength(2);
  });

  it('keeps two findings at different positions apart', async () => {
    const utils = await build(inMemoryLock());

    await Promise.all([
      create(utils),
      create(
        utils,
        'sast',
        dto({
          codeSnippet: {
            ...dto().codeSnippet,
            vulnerableStartLine: 42,
            vulnerableEndLine: 42,
            code: [{ line: 42, content: '    db.execute(q % user)' }],
          },
        }),
      ),
    ]);

    expect(rows.sast).toHaveLength(2);
  });

  describe('one secret reported at two lines of one file', () => {
    const atLine = (line: number) =>
      dto({
        codeSnippet: {
          ...dto().codeSnippet,
          vulnerableStartLine: line,
          vulnerableEndLine: line,
          code: [{ line, content: 'TOKEN = "****"' }],
        },
      });
    const both = (utils: SastIacUtilsService) =>
      Promise.all([
        create(utils, 'secret', atLine(17)),
        create(utils, 'secret', atLine(42)),
      ]);

    it('is serialized by the value lock and stored as one row', async () => {
      const utils = await build(inMemoryLock());

      await both(utils);

      expect(rows.secret).toHaveLength(1);
    });

    it('control — the same interleaving without any lock stores TWO rows', async () => {
      const utils = await build();

      await both(utils);

      expect(rows.secret).toHaveLength(2);
    });
  });

  it('never takes the lock for a fake secret, dropped before any lookup', async () => {
    const lock = recordingLock();
    const utils = await build(lock);

    await create(utils, 'secret', dto({ secretValue: 'your_api_key' }));

    expect(lock.acquireDetectionCreationLock).not.toHaveBeenCalled();
    expect(rows.secret).toHaveLength(0);
  });

  describe('degrades to the unlocked behaviour, never failing the batch', () => {
    it('without a lock provider (legacy test modules): one WARN, and the finding is stored', async () => {
      const utils = await build();

      await create(utils);

      expect(rows.sast).toHaveLength(1);
      expect(lockWarnings()).toEqual([
        expect.stringContaining('reason=no-lock-provider'),
      ]);
    });

    it('when Redis errors: one WARN carrying the error, no release', async () => {
      const lock = recordingLock();
      lock.acquireDetectionCreationLock.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 10.0.0.7:6379'),
      );
      const utils = await build(lock);

      await create(utils);

      expect(rows.sast).toHaveLength(1);
      expect(lock.releaseDetectionCreationLock).not.toHaveBeenCalled();
      expect(lockWarnings()).toEqual([
        expect.stringMatching(/reason=redis-error.*ECONNREFUSED/),
      ]);
    });

    it('when the wait times out: one WARN, no release', async () => {
      const lock = recordingLock(null);
      const utils = await build(lock);

      await create(utils);

      expect(rows.sast).toHaveLength(1);
      expect(lock.releaseDetectionCreationLock).not.toHaveBeenCalled();
      expect(lockWarnings()).toEqual([
        expect.stringContaining('reason=wait-timeout'),
      ]);
    });

    it('when the release fails: the finding is stored, one WARN, the key expires on its own', async () => {
      const lock = recordingLock();
      lock.releaseDetectionCreationLock.mockRejectedValueOnce(
        new Error('ETIMEDOUT'),
      );
      const utils = await build(lock);

      await expect(create(utils)).resolves.toBeUndefined();

      expect(rows.sast).toHaveLength(1);
      expect(lockWarnings()).toEqual([
        expect.stringMatching(/DETECTION_LOCK_RELEASE_FAILED.*ETIMEDOUT/),
      ]);
    });

    it('reports a lock whose TTL ran out during the section', async () => {
      const lock = recordingLock();
      lock.releaseDetectionCreationLock.mockResolvedValueOnce(false);
      const utils = await build(lock);

      await create(utils);

      expect(lockWarnings()).toEqual([
        expect.stringContaining('DETECTION_LOCK_EXPIRED'),
      ]);
    });
  });
});
