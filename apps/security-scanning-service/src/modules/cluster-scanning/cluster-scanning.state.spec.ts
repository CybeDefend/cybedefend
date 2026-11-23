import { Logger } from '@nestjs/common';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import type { CommunityKubeClient, KubeFailure } from './kube-client';
import {
  CLUSTER_RECHECK_MS,
  ClusterScanningState,
} from './cluster-scanning.state';

/**
 * Community scans on a connected Kubernetes cluster:
 * the engine is enabled only once the access review passes. While disabled
 * with a configuration, the review runs again every 5 minutes and the state
 * flips without a restart. A line is logged only when the
 * outcome changes. With no configuration nothing about a cluster is logged.
 */

type Review = { ok: true } | { ok: false; reason: KubeFailure };

const config = (env: NodeJS.ProcessEnv = {}): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    FRONTEND_URL: 'https://appsec.example.com',
    S3_PUBLIC_ENDPOINT: 'https://storage.example.com',
    ...env,
  });

function fakeClient(answers: Review[]): CommunityKubeClient & {
  reviewAccess: jest.Mock;
} {
  const queue = [...answers];
  const last = answers[answers.length - 1];
  return {
    reviewAccess: jest.fn(async () => queue.shift() ?? last),
    createSecret: jest.fn(),
    deleteSecret: jest.fn(),
    createPod: jest.fn(),
    readPod: jest.fn(),
    listManagedPods: jest.fn(),
    deletePod: jest.fn(),
  };
}

/** Bootstrap, then wait for the review it started (bootstrap does not await it). */
async function boot(s: ClusterScanningState): Promise<void> {
  await s.onApplicationBootstrap();
  await s.check();
}

// sha256 of the test FRONTEND_URL, first 16 hex: the instance id (not a
// secret).
const INSTANCE = '38e84067f54dd556';

describe('ClusterScanningState', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let state: ClusterScanningState | undefined;

  /** Every logged line, in the order it was logged. */
  const lines = (): string[] =>
    [log, warn, error]
      .flatMap((spy) =>
        spy.mock.calls.map((c, i) => ({
          order: spy.mock.invocationCallOrder[i],
          line: String(c[0]),
        })),
      )
      .sort((a, b) => a.order - b.order)
      .map((x) => x.line);

  beforeEach(() => {
    jest.useFakeTimers();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    state?.onModuleDestroy();
    state = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('the boot never waits for the access review (an unreachable cluster delays nothing)', async () => {
    const client = fakeClient([{ ok: true }]);
    let answer: (r: Review) => void = () => undefined;
    client.reviewAccess.mockImplementationOnce(
      () =>
        new Promise<Review>((resolve) => {
          answer = resolve;
        }),
    );
    state = new ClusterScanningState(config(), client);
    let booted = false;
    void state.onApplicationBootstrap().then(() => {
      booted = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(booted).toBe(true);
    expect(client.reviewAccess).toHaveBeenCalledTimes(1);
    expect(state.enabled).toBe(false);
    answer({ ok: true });
    await state.check();
    expect(state.enabled).toBe(true);
    expect(client.reviewAccess).toHaveBeenCalledTimes(1);
  });

  it('re-checks every 5 minutes', () => {
    expect(CLUSTER_RECHECK_MS).toBe(300_000);
  });

  it('no config: disabled, no client call, no log line at all', async () => {
    const client = fakeClient([{ ok: true }]);
    state = new ClusterScanningState(null, client);
    await boot(state);
    await jest.advanceTimersByTimeAsync(3 * CLUSTER_RECHECK_MS);
    expect(state.enabled).toBe(false);
    expect(client.reviewAccess).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('no config and no client: disabled, no log line', async () => {
    state = new ClusterScanningState(null, null);
    await boot(state);
    expect(state.enabled).toBe(false);
    expect(lines()).toEqual([]);
  });

  it('access ok: enabled, one INFO CLUSTER_SCANNING_ENABLED namespace=scans instance=<id>', async () => {
    const client = fakeClient([{ ok: true }]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    expect(state.enabled).toBe(true);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
    ]);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
    ]);
    // Enabled, the re-check still runs (an access revoked later)
    expect(jest.getTimerCount()).toBe(1);
  });

  it('access denied: disabled, one WARN CLUSTER_SCANNING_DISABLED reason=access_denied, service keeps running', async () => {
    const client = fakeClient([{ ok: false, reason: 'access_denied' }]);
    state = new ClusterScanningState(config(), client);
    await expect(state.onApplicationBootstrap()).resolves.toBeUndefined();
    // the review the boot started, without starting another
    await jest.advanceTimersByTimeAsync(0);
    expect(state.enabled).toBe(false);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'CLUSTER_SCANNING_DISABLED reason=access_denied',
    ]);
    expect(lines()).toHaveLength(1);
  });

  it.each<KubeFailure>(['kubeconfig_unreadable', 'cluster_unreachable'])(
    'names the reason %s',
    async (reason) => {
      state = new ClusterScanningState(
        config(),
        fakeClient([{ ok: false, reason }]),
      );
      await boot(state);
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        `CLUSTER_SCANNING_DISABLED reason=${reason}`,
      ]);
    },
  );

  it('a review that throws counts as cluster_unreachable, and the boot goes on', async () => {
    const client = fakeClient([{ ok: true }]);
    client.reviewAccess.mockRejectedValueOnce(new Error('boom'));
    state = new ClusterScanningState(config(), client);
    await expect(state.onApplicationBootstrap()).resolves.toBeUndefined();
    // the review the boot started, without starting another
    await jest.advanceTimersByTimeAsync(0);
    expect(state.enabled).toBe(false);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'CLUSTER_SCANNING_DISABLED reason=cluster_unreachable',
    ]);
  });

  it('re-checks every 5 minutes and enables without restart', async () => {
    const client = fakeClient([
      { ok: false, reason: 'access_denied' },
      { ok: true },
    ]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    expect(state.enabled).toBe(false);

    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS - 1);
    expect(client.reviewAccess).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(client.reviewAccess).toHaveBeenCalledTimes(2);
    expect(state.enabled).toBe(true);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_DISABLED reason=access_denied',
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
    ]);

    // Once enabled, the re-check goes on, silent while nothing changes
    await jest.advanceTimersByTimeAsync(3 * CLUSTER_RECHECK_MS);
    expect(client.reviewAccess).toHaveBeenCalledTimes(5);
    expect(state.enabled).toBe(true);
    expect(lines()).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('logs nothing when the state does not change', async () => {
    const client = fakeClient([{ ok: false, reason: 'access_denied' }]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    await jest.advanceTimersByTimeAsync(2 * CLUSTER_RECHECK_MS);
    expect(client.reviewAccess).toHaveBeenCalledTimes(3);
    expect(lines()).toEqual(['CLUSTER_SCANNING_DISABLED reason=access_denied']);
  });

  it('logs again when the reason changes', async () => {
    const client = fakeClient([
      { ok: false, reason: 'cluster_unreachable' },
      { ok: false, reason: 'access_denied' },
    ]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_DISABLED reason=cluster_unreachable',
      'CLUSTER_SCANNING_DISABLED reason=access_denied',
    ]);
  });

  it.each<KubeFailure>(['cluster_unreachable', 'kubeconfig_unreadable'])(
    'while enabled, %s keeps the engine on, without a line (a network blip never hides « Start scan »)',
    async (reason) => {
      const client = fakeClient([{ ok: true }, { ok: false, reason }]);
      state = new ClusterScanningState(config(), client);
      await boot(state);
      await jest.advanceTimersByTimeAsync(2 * CLUSTER_RECHECK_MS);
      expect(client.reviewAccess).toHaveBeenCalledTimes(3);
      expect(state.enabled).toBe(true);
      expect(lines()).toEqual([
        'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
      ]);
    },
  );

  it('while enabled, the 5 min re-check turns the engine off on access_denied, with one line, and on again later', async () => {
    const client = fakeClient([
      { ok: true },
      { ok: true },
      { ok: false, reason: 'access_denied' },
      { ok: true },
    ]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(state.enabled).toBe(true);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(client.reviewAccess).toHaveBeenCalledTimes(3);
    expect(state.enabled).toBe(false);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(state.enabled).toBe(true);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
      'CLUSTER_SCANNING_DISABLED reason=access_denied',
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
    ]);
  });

  it('while enabled, a kubeconfig that turned off TLS verification turns the engine off', async () => {
    const client = fakeClient([
      { ok: true },
      { ok: false, reason: 'insecure_tls' },
    ]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(state.enabled).toBe(false);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
      'CLUSTER_SCANNING_DISABLED reason=insecure_tls',
    ]);
  });

  it('CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS=true: one WARN at every start, before the review', async () => {
    state = new ClusterScanningState(
      config({ CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: 'true' }),
      fakeClient([{ ok: true }]),
    );
    await boot(state);
    await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
    expect(lines()).toEqual([
      'CLUSTER_SCANNING_INSECURE_TLS_ALLOWED variable=CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS',
      'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
    ]);
  });

  it('clears the re-check on destroy', async () => {
    const client = fakeClient([{ ok: false, reason: 'access_denied' }]);
    state = new ClusterScanningState(config(), client);
    await boot(state);
    expect(jest.getTimerCount()).toBe(1);
    state.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(3 * CLUSTER_RECHECK_MS);
    expect(client.reviewAccess).toHaveBeenCalledTimes(1);
  });

  describe('warns when a pod could not reach the instance', () => {
    it.each([
      ['localhost', 'http://localhost:3000'],
      ['127.0.0.1', 'http://127.0.0.1'],
      ['::1', 'http://[::1]:8080'],
      ['0.0.0.0', 'http://0.0.0.0:3000'],
    ])('FRONTEND_URL on %s', async (_host, url) => {
      state = new ClusterScanningState(
        config({ FRONTEND_URL: url }),
        fakeClient([{ ok: true }]),
      );
      await boot(state);
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        'CLUSTER_SCANNING_UNREACHABLE_ADDRESS variable=FRONTEND_URL',
      ]);
      // scanning stays enabled: a cluster on the same machine may route to it
      expect(state.enabled).toBe(true);
      // the line names the variable, never its value
      for (const line of lines()) expect(line).not.toContain(url);
    });

    it('S3_PUBLIC_ENDPOINT on the compose default, and both at once', async () => {
      state = new ClusterScanningState(
        config({
          FRONTEND_URL: 'http://localhost:3000',
          S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
        }),
        fakeClient([{ ok: false, reason: 'access_denied' }]),
      );
      await boot(state);
      await jest.advanceTimersByTimeAsync(2 * CLUSTER_RECHECK_MS);
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        'CLUSTER_SCANNING_UNREACHABLE_ADDRESS variable=FRONTEND_URL',
        'CLUSTER_SCANNING_UNREACHABLE_ADDRESS variable=S3_PUBLIC_ENDPOINT',
        'CLUSTER_SCANNING_DISABLED reason=access_denied',
      ]);
      for (const line of lines()) expect(line).not.toContain('localhost');
    });

    it('warns at bootstrap only', async () => {
      state = new ClusterScanningState(
        config({ S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000' }),
        fakeClient([{ ok: false, reason: 'access_denied' }, { ok: true }]),
      );
      await boot(state);
      await jest.advanceTimersByTimeAsync(CLUSTER_RECHECK_MS);
      await state.check();
      expect(
        lines().filter((l) => l.startsWith('CLUSTER_SCANNING_UNREACHABLE')),
      ).toEqual([
        'CLUSTER_SCANNING_UNREACHABLE_ADDRESS variable=S3_PUBLIC_ENDPOINT',
      ]);
    });

    it('says nothing for reachable hosts, or an unset S3_PUBLIC_ENDPOINT', async () => {
      state = new ClusterScanningState(
        config({ S3_PUBLIC_ENDPOINT: '' }),
        fakeClient([{ ok: true }]),
      );
      await boot(state);
      expect(lines()).toEqual([
        'CLUSTER_SCANNING_ENABLED namespace=scans instance=' + INSTANCE,
      ]);
    });

    it('says nothing without a config', async () => {
      const previous = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'http://localhost:3000';
      try {
        state = new ClusterScanningState(null, null);
        await boot(state);
        expect(lines()).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = previous;
      }
    });
  });
});
