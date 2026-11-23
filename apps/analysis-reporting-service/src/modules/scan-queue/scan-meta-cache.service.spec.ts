import { ScanResponse } from '@grpc/security-scanning/scan';
import {
  ScaProjectContext,
  ScanMetaCache,
  readScanRecordMeta,
  scanRecordMetaOf,
} from './scan-meta-cache.service';
import { ScanQueueService } from './scan-queue.service';

/** An in-memory Redis answering the two commands the cache uses. */
const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
};

const scanResponse = (over: Partial<ScanResponse> = {}): ScanResponse =>
  ({
    id: 'scan-1',
    branch: 'main',
    isDiffScan: false,
    scanType: 'sast,iac',
    initializerUserId: 'u1',
    codingAgent: 'claude-code',
    state: 'running',
    progress: 40,
    containers: [{ id: 'c1', state: 'running' }],
    ...over,
  }) as unknown as ScanResponse;

describe('ScanMetaCache', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let cache: ScanMetaCache;

  beforeEach(() => {
    redis = fakeRedis();
    cache = new ScanMetaCache({
      getRedisClient: jest.fn(async () => redis),
    } as unknown as ScanQueueService);
  });

  it('reads the scan record once, then serves it from Redis', async () => {
    const fetchScan = jest.fn(async () => scanResponse());

    const first = await cache.getScan('scan-1', fetchScan);
    const second = await cache.getScan('scan-1', fetchScan);

    expect(fetchScan).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first).toEqual({
      branch: 'main',
      isDiffScan: false,
      scanType: 'sast,iac',
      initializerUserId: 'u1',
      codingAgent: 'claude-code',
      historyMode: null,
      historyFirstPass: false,
    });
  });

  // The pass is recorded on the scan before the scanners start, so it is as
  // fixed as the branch for the whole ingestion.
  it('scanRecordMetaOf reads the history mode and first-pass flag', () => {
    expect(
      scanRecordMetaOf(
        scanResponse({
          historyPass: {
            mode: 'partial',
            firstPass: true,
            excludeShas: [],
            bytes: '2147483648',
            repositoryKey: 'github:acme/api',
          },
        }),
      ),
    ).toMatchObject({ historyMode: 'partial', historyFirstPass: true });
    expect(
      scanRecordMetaOf(
        scanResponse({
          historyPass: {
            mode: 'incremental',
            firstPass: false,
            excludeShas: ['a'.repeat(40)],
            bytes: '1024',
            repositoryKey: 'github:acme/api',
          },
        }),
      ),
    ).toMatchObject({ historyMode: 'incremental', historyFirstPass: false });
    // No pass recorded (an upload, the Community Edition): no mode.
    expect(scanRecordMetaOf(scanResponse())).toMatchObject({
      historyMode: null,
      historyFirstPass: false,
    });
  });

  // An entry written before the history fields existed would read as a scan
  // without history, and finalize would apply the rule of a scan without
  // history to every secret of the branch.
  it('a v1 cache entry is reloaded', async () => {
    redis.store.set(
      'scan-meta:v1:scan:scan-1',
      JSON.stringify({
        branch: 'main',
        isDiffScan: false,
        scanType: 'sast,iac',
        initializerUserId: 'u1',
        codingAgent: 'claude-code',
      }),
    );
    const fetchScan = jest.fn(async () =>
      scanResponse({
        historyPass: {
          mode: 'incremental',
          firstPass: false,
          excludeShas: [],
          bytes: '1024',
          repositoryKey: 'github:acme/api',
        },
      }),
    );

    await expect(cache.getScan('scan-1', fetchScan)).resolves.toMatchObject({
      historyMode: 'incremental',
      historyFirstPass: false,
    });
    expect(fetchScan).toHaveBeenCalledTimes(1);
    expect(redis.store.has('scan-meta:v2:scan:scan-1')).toBe(true);
  });

  it('keys by scan and keeps the value 24 h', async () => {
    await cache.getScan('scan-1', async () => scanResponse());

    expect(redis.set).toHaveBeenCalledWith(
      'scan-meta:v2:scan:scan-1',
      expect.any(String),
      'EX',
      86_400,
    );
  });

  it('never stores the containers, nor anything that changes while the scan runs', async () => {
    await cache.getScan('scan-1', async () => scanResponse());

    const stored = JSON.parse(redis.store.get('scan-meta:v2:scan:scan-1'));
    expect(Object.keys(stored).sort()).toEqual([
      'branch',
      'codingAgent',
      'historyFirstPass',
      'historyMode',
      'initializerUserId',
      'isDiffScan',
      'scanType',
    ]);
  });

  it('writes nothing when GetScan fails, and reads it again next time', async () => {
    const fetchScan = jest
      .fn<Promise<ScanResponse>, []>()
      .mockRejectedValueOnce(new Error('14 UNAVAILABLE'))
      .mockResolvedValueOnce(scanResponse());

    await expect(cache.getScan('scan-1', fetchScan)).rejects.toThrow(
      'UNAVAILABLE',
    );
    expect(redis.set).not.toHaveBeenCalled();

    await expect(cache.getScan('scan-1', fetchScan)).resolves.toMatchObject({
      branch: 'main',
    });
    expect(fetchScan).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when GetScan answers no record', async () => {
    const fetchScan = jest.fn(async () => null);

    await expect(cache.getScan('scan-1', fetchScan)).resolves.toBeNull();
    await expect(cache.getScan('scan-1', fetchScan)).resolves.toBeNull();

    expect(redis.set).not.toHaveBeenCalled();
    expect(fetchScan).toHaveBeenCalledTimes(2);
  });

  it('reads the source when Redis is down, every time', async () => {
    cache = new ScanMetaCache({
      getRedisClient: jest.fn(async () => {
        throw new Error('Redis client not available');
      }),
    } as unknown as ScanQueueService);
    const fetchScan = jest.fn(async () => scanResponse({ branch: 'dev' }));

    await expect(cache.getScan('scan-1', fetchScan)).resolves.toMatchObject({
      branch: 'dev',
    });
    await expect(cache.getScan('scan-1', fetchScan)).resolves.toMatchObject({
      branch: 'dev',
    });
    expect(fetchScan).toHaveBeenCalledTimes(2);
  });

  it('treats a cached value of another shape as a miss', async () => {
    redis.store.set('scan-meta:v2:scan:scan-1', JSON.stringify({ branch: 1 }));
    const fetchScan = jest.fn(async () => scanResponse());

    await expect(cache.getScan('scan-1', fetchScan)).resolves.toMatchObject({
      branch: 'main',
    });
    expect(fetchScan).toHaveBeenCalledTimes(1);
  });

  it('keeps one scan apart from another', async () => {
    await cache.getScan('scan-1', async () => scanResponse());
    const other = await cache.getScan('scan-2', async () =>
      scanResponse({ branch: 'feat/x', isDiffScan: true }),
    );

    expect(other).toMatchObject({ branch: 'feat/x', isDiffScan: true });
  });

  describe('the SCA project context section', () => {
    const context = (): ScaProjectContext => ({
      scoringBranches: ['develop'],
      reachabilityPriorityEnabled: false,
      reachabilityStatusEnabled: true,
      issueSettings: {
        projectId: 'p1',
        organizationId: 'org-1',
        githubIssueEnabled: true,
        gitlabIssueEnabled: false,
        issueCreationMode: 'per_scan',
        issueCreationBranches: ['develop'],
      },
    });

    it('is loaded once per scan, under its own key, apart from the scan record', async () => {
      const load = jest.fn(async () => context());

      await cache.getOrLoad('scan-1', 'scaProject', load);
      const second = await cache.getOrLoad('scan-1', 'scaProject', load);

      expect(load).toHaveBeenCalledTimes(1);
      expect(second).toEqual(context());
      expect([...redis.store.keys()]).toEqual([
        'scan-meta:v2:scaProject:scan-1',
      ]);
    });

    it('reads a cached value the caller refuses as a miss, and overwrites it', async () => {
      redis.store.set(
        'scan-meta:v2:scaProject:scan-1',
        JSON.stringify({
          ...context(),
          issueSettings: { ...context().issueSettings, projectId: 'p-other' },
        }),
      );
      const load = jest.fn(async () => context());

      await expect(
        cache.getOrLoad('scan-1', 'scaProject', load, {
          accept: (cached) => cached.issueSettings.projectId === 'p1',
        }),
      ).resolves.toEqual(context());

      expect(load).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(redis.store.get('scan-meta:v2:scaProject:scan-1'))
          .issueSettings.projectId,
      ).toBe('p1');
    });

    it('deletes a refused cached value when the value loaded instead may not be kept', async () => {
      redis.store.set(
        'scan-meta:v2:scaProject:scan-1',
        JSON.stringify({
          ...context(),
          issueSettings: { ...context().issueSettings, projectId: 'p-other' },
        }),
      );
      const load = jest.fn(async () => context());

      await expect(
        cache.getOrLoad('scan-1', 'scaProject', load, {
          accept: (cached) => cached.issueSettings.projectId === 'p1',
          store: () => false,
        }),
      ).resolves.toEqual(context());

      // Another project's context must not stay there for the next read.
      expect(redis.del).toHaveBeenCalledWith('scan-meta:v2:scaProject:scan-1');
      expect(redis.store.has('scan-meta:v2:scaProject:scan-1')).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns a value the caller refuses to keep, without caching it', async () => {
      const load = jest.fn(async () => context());
      const store = jest.fn(() => false);

      await expect(
        cache.getOrLoad('scan-1', 'scaProject', load, { store }),
      ).resolves.toEqual(context());
      await cache.getOrLoad('scan-1', 'scaProject', load, { store });

      expect(store).toHaveBeenCalledWith(context());
      expect(redis.set).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['no branch scope', { ...context(), scoringBranches: [] }],
      [
        'a flag of another type',
        { ...context(), reachabilityStatusEnabled: 1 },
      ],
      ['no issue settings', { ...context(), issueSettings: undefined }],
      [
        'issue branches of another type',
        {
          ...context(),
          issueSettings: {
            ...context().issueSettings,
            issueCreationBranches: 'x',
          },
        },
      ],
    ])('treats a cached context with %s as a miss', async (_case, value) => {
      redis.store.set('scan-meta:v2:scaProject:scan-1', JSON.stringify(value));
      const load = jest.fn(async () => context());

      await expect(
        cache.getOrLoad('scan-1', 'scaProject', load),
      ).resolves.toEqual(context());
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('readScanRecordMeta', () => {
    it('reads the source directly when no cache is provided', async () => {
      const fetchScan = jest.fn(async () => scanResponse());

      await readScanRecordMeta(undefined, 'scan-1', fetchScan);
      await readScanRecordMeta(undefined, 'scan-1', fetchScan);

      expect(fetchScan).toHaveBeenCalledTimes(2);
    });
  });
});
