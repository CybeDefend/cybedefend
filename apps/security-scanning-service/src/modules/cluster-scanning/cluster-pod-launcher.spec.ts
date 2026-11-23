import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { V1Pod } from '@kubernetes/client-node';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { ProjectScanSettings } from '@grpc/security-scanning/scan';
import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type { FileManagementService } from '../file/file-management.service';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import type { ScanStateStore } from '../scan/core/scanStateStore';
import type { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import { KubeCallError, type CommunityKubeClient } from './kube-client';
import { COMMUNITY_SCANNER_CATALOGUE } from './scanner-catalogue';
import { ClusterPodLauncher } from './cluster-pod-launcher';

/**
 * Community scans on a connected Kubernetes cluster:
 * the rows, tokens, Secrets and pods of one scan already claimed `running`.
 * A scan's scanners are the Community catalogue's, picked by category. The
 * archive URL and the token reach the pod only through its Secret
 * `<podName>-run`. A refused launch is logged by HTTP status only, and every
 * pod and Secret of the scan is deleted.
 */

const ARCHIVE_URL =
  'https://storage.example.com/scan/s1.zip?X-Amz-Signature=abc';
const SCAN_ID = '11111111-1111-4111-8111-111111111111';

const config = (env: NodeJS.ProcessEnv = {}): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    FRONTEND_URL: 'https://appsec.example.com',
    ...env,
  });

const settings = (
  enabledScanTypes: string[],
  vulnerabilityTypesByScan: Record<string, string> = {},
): ProjectScanSettings =>
  ({
    enabledScanTypes,
    vulnerabilityTypesByScan,
  }) as unknown as ProjectScanSettings;

const scan = (): Scan =>
  ({
    id: SCAN_ID,
    projectId: 'p1',
    organizationId: 'o1',
    state: 'running',
    branch: 'main',
  }) as Scan;

interface Harness {
  failInsert: (error: unknown) => void;
  launcher: ClusterPodLauncher;
  inserted: Container[];
  updates: Array<{ where: unknown; fields: Partial<Container> }>;
  kube: { [K in keyof CommunityKubeClient]: jest.Mock };
  tokens: { mint: jest.Mock };
  files: { getExternalDownloadUrl: jest.Mock; deleteFile: jest.Mock };
  store: { moveScanState: jest.Mock };
  stateManager: { publishStatusChanged: jest.Mock };
  logged: () => string[];
}

function harness(
  opts: {
    config?: ClusterScanningConfig;
    env?: Record<string, string>;
    kube?: Partial<CommunityKubeClient>;
  } = {},
): Harness {
  const inserted: Container[] = [];
  const updates: Harness['updates'] = [];
  let insertError: unknown = null;
  const containers = {
    createQueryBuilder: () => {
      const qb = {
        insert: () => qb,
        into: () => qb,
        values: (rows: Container[]) => {
          inserted.push(...rows);
          return qb;
        },
        updateEntity: () => qb,
        execute: async () => {
          if (insertError) throw insertError;
          return {};
        },
      };
      return qb;
    },
    create: (c: Partial<Container>) => c as Container,
    update: jest.fn(async (where: unknown, fields: Partial<Container>) => {
      updates.push({ where, fields });
      return { affected: 1 };
    }),
  } as unknown as Repository<Container>;
  let uid = 0;
  const kube = {
    reviewAccess: jest.fn(),
    createSecret: jest.fn(async () => undefined),
    deleteSecret: jest.fn(async () => undefined),
    createPod: jest.fn(async () => ({ uid: `uid-${++uid}` })),
    readPod: jest.fn(),
    listManagedPods: jest.fn(),
    deletePod: jest.fn(async () => undefined),
    ...opts.kube,
  } as Harness['kube'];
  let n = 0;
  const tokens = {
    mint: jest.fn(async () => `cdst_${'a'.repeat(42)}${n++}`),
  };
  const files = {
    getExternalDownloadUrl: jest.fn(async () => ARCHIVE_URL),
    deleteFile: jest.fn(async () => ({ success: true })),
  };
  const store = { moveScanState: jest.fn(async () => true) };
  const stateManager = { publishStatusChanged: jest.fn() };
  const env = opts.env ?? {};
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const spies = ['log', 'warn', 'error', 'debug'].map((m) =>
    jest
      .spyOn(Logger.prototype, m as 'log')
      .mockImplementation(() => undefined),
  );
  const launcher = new ClusterPodLauncher(
    containers,
    store as unknown as ScanStateStore,
    stateManager as unknown as ScanStateManager,
    files as unknown as FileManagementService,
    tokens as unknown as ScanUploadTokens,
    kube,
    opts.config ?? config(),
    configService,
  );
  return {
    failInsert: (error: unknown) => {
      insertError = error;
    },
    launcher,
    inserted,
    updates,
    kube,
    tokens,
    files,
    store,
    stateManager,
    logged: () =>
      spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))),
  };
}

const pods = (h: Harness): V1Pod[] =>
  h.kube.createPod.mock.calls.map((c) => c[0] as V1Pod);

describe('ClusterPodLauncher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('one pod per catalogue entry of the enabled types', async () => {
    const h = harness();
    await expect(
      h.launcher.launch(scan(), settings(['sast', 'sca'])),
    ).resolves.toBe(3);
    const adapters = pods(h).map(
      (p) => p.metadata.labels['cybedefend.io/adapter'],
    );
    expect(adapters.sort()).toEqual(['opengrep', 'trivy-fs', 'zizmor']);
    expect(h.inserted).toHaveLength(3);
    expect(h.kube.createSecret).toHaveBeenCalledTimes(3);
  });

  it('picks scanners by catalogue id only: no other scanner row becomes a container', async () => {
    const h = harness();
    // aibom (a cloud scan type) and an unknown type are no Community entry
    await h.launcher.launch(
      scan(),
      settings(['sast', 'iac', 'sca', 'secret', 'aibom', 'container']),
    );
    const ids = new Set(COMMUNITY_SCANNER_CATALOGUE.map((e) => e.id));
    expect(h.inserted).toHaveLength(5);
    for (const row of h.inserted) {
      expect(ids.has(row.scanner.id)).toBe(true);
      expect(row.image).toMatch(/^cybedefend-scanners\/[a-z-]+:1\.0\.0$/);
    }
  });

  it('rows: fixed ids, pod name cd-scan-<adapter>-<id>, starting', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['iac']));
    const [row] = h.inserted;
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.podName).toBe(`cd-scan-trivy-config-${row.id}`);
    expect(row.status).toBe('starting');
    expect(row.scanId).toBe(SCAN_ID);
    const [update] = h.updates;
    expect(update.where).toBe(row.id);
    expect(update.fields).toMatchObject({ podUid: 'uid-1' });
    expect(update.fields.startedAt).toBeInstanceOf(Date);
  });

  it('stores the image without the registry', async () => {
    const h = harness({
      config: config({
        CYBEDEFEND_SCANNER_IMAGE_REGISTRY:
          'registry.container-hub.example/acme',
      }),
    });
    await h.launcher.launch(scan(), settings(['sast']));
    const opengrep = h.inserted.find((r) =>
      r.podName.startsWith('cd-scan-opengrep-'),
    );
    expect(opengrep.image).toBe('cybedefend-scanners/opengrep:1.0.0');
    const pod = pods(h).find(
      (p) => p.metadata.labels['cybedefend.io/adapter'] === 'opengrep',
    );
    expect(pod.spec.containers[0].image).toBe(
      'registry.container-hub.example/acme/cybedefend-scanners/opengrep:1.0.0',
    );
  });

  it('the URL and the token only through the Secret', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['sast']));
    expect(h.files.getExternalDownloadUrl).toHaveBeenCalledTimes(1);
    expect(h.files.getExternalDownloadUrl).toHaveBeenCalledWith(SCAN_ID);
    for (const pod of pods(h)) {
      const text = JSON.stringify(pod);
      expect(text).not.toContain(ARCHIVE_URL);
      expect(text).not.toContain('X-Amz-Signature');
      expect(text).not.toContain('cdst_');
      const container = pod.spec.containers[0];
      const env = Object.fromEntries(
        container.env.map((e) => [e.name, e.valueFrom?.secretKeyRef]),
      );
      const secretName = `${pod.metadata.name}-run`;
      for (const key of [
        'CYBEDEFEND_API_URL',
        'CYBEDEFEND_SCAN_ID',
        'CYBEDEFEND_SCAN_TOKEN',
        'CYBEDEFEND_ARCHIVE_URL',
      ]) {
        expect(env[key]).toEqual({ name: secretName, key });
      }
      expect(container.env.every((e) => e.value === undefined)).toBe(true);
      expect(container.args.slice(0, 3)).toEqual([
        'run',
        pod.metadata.labels['cybedefend.io/adapter'],
        '--scan-run',
      ]);
    }
    // the Secret holds the four values, named <podName>-run
    const [name, labels, data] = h.kube.createSecret.mock.calls[0];
    const pod = pods(h)[0];
    expect(name).toBe(`${pod.metadata.name}-run`);
    expect(labels).toEqual(pod.metadata.labels);
    expect(labels['cybedefend.io/instance']).toBe('38e84067f54dd556');
    expect(data).toEqual({
      CYBEDEFEND_API_URL: 'https://appsec.example.com/api',
      CYBEDEFEND_SCAN_ID: SCAN_ID,
      CYBEDEFEND_SCAN_TOKEN: expect.stringMatching(/^cdst_/),
      CYBEDEFEND_ARCHIVE_URL: ARCHIVE_URL,
    });
    // the Secret exists before its pod
    expect(h.kube.createSecret.mock.invocationCallOrder[0]).toBeLessThan(
      h.kube.createPod.mock.invocationCallOrder[0],
    );
    for (const line of h.logged()) {
      expect(line).not.toContain('cdst_');
      expect(line).not.toContain('https://');
    }
  });

  it('the manifest values', async () => {
    const h = harness({
      config: config({
        CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET: 'registry-creds',
        CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({
          'trivy-fs': { memoryLimit: '3Gi', cpuRequest: '750m' },
        }),
      }),
    });
    await h.launcher.launch(scan(), settings(['sca']));
    const [pod] = pods(h);
    const [row] = h.inserted;
    expect(pod.metadata.name).toBe(`cd-scan-trivy-fs-${row.id}`);
    expect(pod.metadata.labels).toEqual({
      'app.kubernetes.io/managed-by': 'cybedefend',
      'cybedefend.io/scan-id': SCAN_ID,
      'cybedefend.io/container-id': row.id,
      'cybedefend.io/adapter': 'trivy-fs',
      // The instance id: sha256 of FRONTEND_URL, first 16 hex
      'cybedefend.io/instance': '38e84067f54dd556',
    });
    const spec = pod.spec;
    expect(spec.restartPolicy).toBe('Never');
    // scannerPhaseMaxMs / 1000 + 300, derived from the pipeline config
    expect(spec.activeDeadlineSeconds).toBe(7500);
    expect(spec.automountServiceAccountToken).toBe(false);
    expect(spec.imagePullSecrets).toEqual([{ name: 'registry-creds' }]);
    expect(spec.securityContext).toEqual({
      seccompProfile: { type: 'RuntimeDefault' },
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
      fsGroup: 65532,
    });
    expect(spec.volumes).toEqual([
      { name: 'src', emptyDir: {} },
      { name: 'scanner-tmp', emptyDir: {} },
    ]);
    const [c] = spec.containers;
    expect(c.command).toEqual(['/usr/local/bin/cybedefend-scanner']);
    // The tool's --timeout is scannerPhaseMaxMs − 25 min
    expect(c.args).toEqual([
      'run',
      'trivy-fs',
      '--scan-run',
      '--timeout',
      '5700s',
    ]);
    expect(c.imagePullPolicy).toBe('IfNotPresent');
    expect(c.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
    });
    expect(c.volumeMounts).toEqual([
      { name: 'src', mountPath: '/src' },
      { name: 'scanner-tmp', mountPath: '/tmp/cybedefend-scanner' },
    ]);
    expect(c.resources).toEqual({
      requests: { cpu: '750m', memory: '1Gi', 'ephemeral-storage': '1Gi' },
      limits: { cpu: '1', memory: '3Gi', 'ephemeral-storage': '5Gi' },
    });
  });

  it('a Trivy database mirror reaches the trivy-fs pod only, as a plain variable', async () => {
    const h = harness({
      config: config({
        CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY:
          'registry.example:5000/mirror/trivy-db:2',
        CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY:
          'registry.example:5000/mirror/trivy-java-db:1',
      }),
    });
    await h.launcher.launch(scan(), settings(['sast', 'sca']));
    for (const pod of pods(h)) {
      const plain = pod.spec.containers[0].env
        .filter((e) => e.value !== undefined)
        .map((e) => [e.name, e.value]);
      if (pod.metadata.labels['cybedefend.io/adapter'] === 'trivy-fs') {
        expect(plain).toEqual([
          ['TRIVY_DB_REPOSITORY', 'registry.example:5000/mirror/trivy-db:2'],
          [
            'TRIVY_JAVA_DB_REPOSITORY',
            'registry.example:5000/mirror/trivy-java-db:1',
          ],
        ]);
      } else {
        expect(plain).toEqual([]);
      }
    }
  });

  it('no Trivy variable when no mirror is configured', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['sca']));
    const names = pods(h)[0].spec.containers[0].env.map((e) => e.name);
    expect(names.some((n) => n.startsWith('TRIVY_'))).toBe(false);
  });

  it('no pull secret when none is configured', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['secret']));
    expect(pods(h)[0].spec.imagePullSecrets).toBeUndefined();
  });

  it('derives the deadlines from SCAN_SCANNER_PHASE_MAX_MS', async () => {
    const h = harness({ env: { SCAN_SCANNER_PHASE_MAX_MS: '3600000' } });
    const before = Date.now();
    await h.launcher.launch(scan(), settings(['secret']));
    const [pod] = pods(h);
    expect(pod.spec.activeDeadlineSeconds).toBe(3900);
    expect(pod.spec.containers[0].args).toEqual([
      'run',
      'gitleaks',
      '--scan-run',
      '--timeout',
      '2100s',
    ]);
    const expiresAt: Date = h.tokens.mint.mock.calls[0][0].expiresAt;
    const expected = before + 3_600_000 + 15 * 60_000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expected);
    expect(expiresAt.getTime()).toBeLessThan(expected + 5_000);
  });

  it('mints one token per container, with its category and an expiry of launch + scannerPhaseMaxMs + 15 min', async () => {
    const h = harness();
    const before = Date.now();
    await h.launcher.launch(scan(), settings(['sast']));
    expect(h.tokens.mint).toHaveBeenCalledTimes(2);
    const calls = h.tokens.mint.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.category).sort()).toEqual(['cicd', 'sast']);
    for (const call of calls) {
      expect(call.scanId).toBe(SCAN_ID);
      expect(h.inserted.map((r) => r.id)).toContain(call.containerId);
      const expected = before + 7_200_000 + 15 * 60_000;
      expect(call.expiresAt.getTime()).toBeGreaterThanOrEqual(expected);
      expect(call.expiresAt.getTime()).toBeLessThan(expected + 5_000);
    }
  });

  it('the token severities follow the project', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['iac'], { iac: 'HIGH,LOW' }));
    expect(h.tokens.mint.mock.calls[0][0].severities).toBe('high,low');
  });

  it('a project without severities keeps every severity', async () => {
    const h = harness();
    await h.launcher.launch(scan(), settings(['iac']));
    expect(h.tokens.mint.mock.calls[0][0].severities).toBe(
      'critical,high,medium,low',
    );
  });

  it('logs a refused create by status only', async () => {
    const h = harness({
      kube: {
        createPod: jest.fn(async (pod: V1Pod) => {
          if (pod.metadata.labels['cybedefend.io/adapter'] === 'zizmor') {
            throw new KubeCallError(422, 'createPod');
          }
          return { uid: 'uid-ok' };
        }),
      },
    });
    const error = await h.launcher
      .launch(scan(), settings(['sast']))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual({
      code: status.INTERNAL,
      message: 'CLUSTER_LAUNCH_FAILED',
    });

    const logged = h.logged();
    const failures = logged.filter((l) => l.includes('CLUSTER_LAUNCH_FAILED'));
    expect(failures.length).toBeGreaterThan(0);
    for (const line of failures) {
      expect(line).toMatch(
        /CLUSTER_LAUNCH_FAILED scan=\S+ container=\S+ status=422/,
      );
    }
    for (const line of logged) {
      expect(line).not.toContain('cdst_');
      expect(line).not.toContain('https://');
    }

    // every row failed with the code
    const ids = h.inserted.map((r) => r.id).sort();
    const failed = h.updates.filter((u) => u.fields.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].fields).toMatchObject({
      status: 'failed',
      outcomeReason: 'CLUSTER_LAUNCH_FAILED',
    });
    expect(failed[0].fields.finishedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(failed[0].where)).toContain(ids[0]);
    expect(JSON.stringify(failed[0].where)).toContain(ids[1]);
    // every pod and Secret of the scan deleted
    const podNames = h.inserted.map((r) => r.podName).sort();
    expect(h.kube.deletePod.mock.calls.map((c) => c[0]).sort()).toEqual(
      podNames,
    );
    expect(h.kube.deleteSecret.mock.calls.map((c) => c[0]).sort()).toEqual(
      podNames.map((p) => `${p}-run`),
    );
  });

  it('a refused Secret is logged by status only and creates no pod for it', async () => {
    const h = harness({
      kube: {
        createSecret: jest.fn(async () => {
          throw new KubeCallError(403, 'createSecret');
        }),
      },
    });
    await expect(
      h.launcher.launch(scan(), settings(['secret'])),
    ).rejects.toBeInstanceOf(RpcException);
    expect(h.kube.createPod).not.toHaveBeenCalled();
    expect(
      h.logged().filter((l) => l.includes('CLUSTER_LAUNCH_FAILED')),
    ).toEqual([
      expect.stringMatching(
        /^CLUSTER_LAUNCH_FAILED scan=\S+ container=\S+ status=403$/,
      ),
    ]);
  });

  it('an unanswered call is status=network; a clean-up failure never hides the launch error', async () => {
    const h = harness({
      kube: {
        createPod: jest.fn(async () => {
          throw new KubeCallError(null, 'createPod');
        }),
        deletePod: jest.fn(async () => {
          throw new KubeCallError(null, 'deletePod');
        }),
      },
    });
    await expect(
      h.launcher.launch(scan(), settings(['secret'])),
    ).rejects.toBeInstanceOf(RpcException);
    expect(
      h
        .logged()
        .some((l) =>
          /CLUSTER_LAUNCH_FAILED scan=\S+ container=\S+ status=network/.test(l),
        ),
    ).toBe(true);
  });

  it('the archive URL cannot be read: no row, no pod, CLUSTER_LAUNCH_FAILED', async () => {
    const h = harness();
    h.files.getExternalDownloadUrl.mockRejectedValueOnce(
      new Error('https://leak.example.com'),
    );
    await expect(
      h.launcher.launch(scan(), settings(['sast'])),
    ).rejects.toBeInstanceOf(RpcException);
    expect(h.inserted).toEqual([]);
    expect(h.kube.createPod).not.toHaveBeenCalled();
    for (const line of h.logged()) expect(line).not.toContain('https://');
  });

  it('a refused row insert: CLUSTER_LAUNCH_FAILED logged by status only, no pod', async () => {
    const h = harness();
    h.failInsert(
      new Error(`ER_DUP_ENTRY ${ARCHIVE_URL} Duplicate entry for key PRIMARY`),
    );
    const error: unknown = await h.launcher
      .launch(scan(), settings(['sast']))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual({
      code: status.INTERNAL,
      message: 'CLUSTER_LAUNCH_FAILED',
    });
    expect(h.kube.createSecret).not.toHaveBeenCalled();
    expect(h.kube.createPod).not.toHaveBeenCalled();
    expect(h.tokens.mint).not.toHaveBeenCalled();
    const lines = h.logged();
    expect(lines).toContainEqual(
      expect.stringContaining(
        `CLUSTER_LAUNCH_FAILED scan=${SCAN_ID} step=containers status=internal`,
      ),
    );
    for (const line of lines) {
      expect(line).not.toContain('https://');
      expect(line).not.toContain('ER_DUP_ENTRY');
    }
  });

  it('no enabled type: scan completed, archive deleted, no pod', async () => {
    const h = harness();
    const s = scan();
    await expect(h.launcher.launch(s, settings(['aibom']))).resolves.toBe(0);
    expect(h.store.moveScanState).toHaveBeenCalledWith(
      s,
      ['running'],
      'completed',
      expect.objectContaining({ endTime: expect.any(Date) }),
    );
    expect(h.stateManager.publishStatusChanged).toHaveBeenCalledWith(
      s,
      'running',
    );
    expect(h.files.deleteFile).toHaveBeenCalledWith(SCAN_ID);
    expect(h.files.getExternalDownloadUrl).not.toHaveBeenCalled();
    expect(h.kube.createPod).not.toHaveBeenCalled();
    expect(h.inserted).toEqual([]);
  });
});
