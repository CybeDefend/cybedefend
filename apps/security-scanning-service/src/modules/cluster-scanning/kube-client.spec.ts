import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import { Logger } from '@nestjs/common';
import type { ClusterScanningConfig } from './cluster-scanning.config';
import {
  COMMUNITY_KUBE_CLIENT,
  createCommunityKubeClient,
  KubeCallError,
} from './kube-client';

/**
 * Community scans on a connected Kubernetes cluster:
 * the minimal Kubernetes client of the Community engine. It reads the mounted
 * kubeconfig file, works in the configured namespace only, checks the six
 * verbs the engine needs, and maps every rejection to a KubeCallError that
 * carries an HTTP status and nothing of the answer: an API error body can
 * quote the Secret that was sent.
 *
 * `@kubernetes/client-node` is the Jest mock of test/mocks/k8s-client-node.ts
 * (package.json moduleNameMapper); its prototypes are spied on here.
 */
const config: ClusterScanningConfig = {
  kubeconfigFile: '/run/cybedefend/kubeconfig',
  namespace: 'scans',
  imageRegistry: 'ghcr.io/cybedefend',
  imageTag: '1.0.0',
  imagePullSecret: null,
  maxConcurrent: 2,
  keepPods: false,
  resources: {} as ClusterScanningConfig['resources'],
  apiUrl: 'https://a.example/api',
  storagePublicUrl: null,
  instanceId: '38612c965a9c4c35',
};

/** What @kubernetes/client-node 1.x rejects with on an HTTP error. */
const httpError = (code: number, body: unknown = {}) =>
  Object.assign(
    new Error(`HTTP-Code: ${code}\nBody: ${JSON.stringify(body)}`),
    {
      code,
      body,
      headers: {},
    },
  );

/** What a fetch to an unreachable API server rejects with. */
const networkError = () =>
  Object.assign(new Error('request to https://10.0.0.1/apis failed'), {
    type: 'system',
    code: 'ECONNREFUSED',
    errno: 'ECONNREFUSED',
  });

const allowed = () => ({ status: { allowed: true } });

const reviewSpy = () =>
  jest.spyOn(k8s.AuthorizationV1Api.prototype, 'createSelfSubjectAccessReview');

const failureOf = async (p: Promise<unknown>): Promise<KubeCallError> => {
  try {
    await p;
  } catch (e) {
    return e as KubeCallError;
  }
  throw new Error('the call did not reject');
};

afterEach(() => jest.restoreAllMocks());

describe('COMMUNITY_KUBE_CLIENT', () => {
  it('is the provider token of the client', () => {
    expect(COMMUNITY_KUBE_CLIENT).toBe('COMMUNITY_KUBE_CLIENT');
  });
});

describe('createCommunityKubeClient', () => {
  describe('reviewAccess', () => {
    it('reads the configured kubeconfig file', async () => {
      const load = jest.spyOn(k8s.KubeConfig.prototype, 'loadFromFile');
      reviewSpy().mockResolvedValue(allowed() as never);

      await createCommunityKubeClient(config).reviewAccess();

      expect(load).toHaveBeenCalledWith('/run/cybedefend/kubeconfig');
    });

    it('asks the six verbs in the namespace', async () => {
      const review = reviewSpy().mockResolvedValue(allowed() as never);

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: true });

      const asked = review.mock.calls.map(
        ([param]) => (param as { body: k8s.V1SelfSubjectAccessReview }).body,
      );
      expect(asked).toHaveLength(6);
      for (const body of asked) {
        expect(body.apiVersion).toBe('authorization.k8s.io/v1');
        expect(body.kind).toBe('SelfSubjectAccessReview');
      }
      expect(asked.map((b) => b.spec.resourceAttributes)).toEqual(
        expect.arrayContaining([
          { namespace: 'scans', verb: 'create', resource: 'pods' },
          { namespace: 'scans', verb: 'get', resource: 'pods' },
          { namespace: 'scans', verb: 'list', resource: 'pods' },
          { namespace: 'scans', verb: 'delete', resource: 'pods' },
          { namespace: 'scans', verb: 'create', resource: 'secrets' },
          { namespace: 'scans', verb: 'delete', resource: 'secrets' },
        ]),
      );
      expect(
        new Set(asked.map((b) => JSON.stringify(b.spec.resourceAttributes)))
          .size,
      ).toBe(6);
    });

    it('never asks to list Secrets: a list returns their values', async () => {
      const review = reviewSpy().mockResolvedValue(allowed() as never);

      await createCommunityKubeClient(config).reviewAccess();

      const attributes = review.mock.calls.map(
        ([param]) =>
          (param as { body: k8s.V1SelfSubjectAccessReview }).body.spec
            .resourceAttributes,
      );
      expect(attributes).not.toContainEqual(
        expect.objectContaining({ verb: 'list', resource: 'secrets' }),
      );
    });

    it('one denial is access_denied', async () => {
      reviewSpy().mockImplementation((async (param: {
        body: k8s.V1SelfSubjectAccessReview;
      }) => ({
        status: {
          allowed: !(
            param.body.spec.resourceAttributes.verb === 'delete' &&
            param.body.spec.resourceAttributes.resource === 'secrets'
          ),
        },
      })) as never);

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'access_denied' });
    });

    it('a review the API server refuses (401, 403) is access_denied', async () => {
      reviewSpy().mockRejectedValue(httpError(403));

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'access_denied' });
    });

    it('an unreadable file is kubeconfig_unreadable', async () => {
      jest
        .spyOn(k8s.KubeConfig.prototype, 'loadFromFile')
        .mockImplementation(() => {
          throw new Error(
            "ENOENT: no such file or directory, open '/run/cybedefend/kubeconfig'",
          );
        });
      const review = reviewSpy();

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'kubeconfig_unreadable' });
      expect(review).not.toHaveBeenCalled();
    });

    it('a kubeconfig without a usable cluster is kubeconfig_unreadable', async () => {
      jest
        .spyOn(k8s.KubeConfig.prototype, 'makeApiClient')
        .mockImplementation(() => {
          throw new Error('No active cluster!');
        });

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'kubeconfig_unreadable' });
    });

    it('a network error is cluster_unreachable', async () => {
      reviewSpy().mockRejectedValue(networkError());

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'cluster_unreachable' });
    });

    it('a server error is cluster_unreachable', async () => {
      reviewSpy().mockRejectedValue(httpError(503));

      await expect(
        createCommunityKubeClient(config).reviewAccess(),
      ).resolves.toEqual({ ok: false, reason: 'cluster_unreachable' });
    });

    it('reads the file again on each review: a fixed kubeconfig is picked up', async () => {
      const load = jest
        .spyOn(k8s.KubeConfig.prototype, 'loadFromFile')
        .mockImplementationOnce(() => {
          throw new Error('ENOENT');
        });
      reviewSpy().mockResolvedValue(allowed() as never);
      const client = createCommunityKubeClient(config);

      await expect(client.reviewAccess()).resolves.toEqual({
        ok: false,
        reason: 'kubeconfig_unreadable',
      });
      await expect(client.reviewAccess()).resolves.toEqual({ ok: true });
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('errors', () => {
    it('HttpError never reaches the message', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'createNamespacedSecret')
        .mockRejectedValue(
          httpError(422, {
            kind: 'Status',
            message:
              'Secret "cd-scan-opengrep-c1-run" is invalid: stringData.CYBEDEFEND_SCAN_TOKEN: cdst_secretvalue',
          }),
        );

      const error = await failureOf(
        createCommunityKubeClient(config).createSecret(
          'cd-scan-opengrep-c1-run',
          { 'app.kubernetes.io/managed-by': 'cybedefend' },
          { CYBEDEFEND_SCAN_TOKEN: 'cdst_secretvalue' },
        ),
      );

      expect(error).toBeInstanceOf(KubeCallError);
      expect(error.message).toBe('createSecret failed status=422');
      expect(error.status).toBe(422);
      expect(error.operation).toBe('createSecret');
      expect(error).not.toHaveProperty('body');
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('cdst_secretvalue');
      expect(String(error.stack)).not.toContain('cdst_secretvalue');
    });

    it('a network failure has no status', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'createNamespacedPod')
        .mockRejectedValue(networkError());

      const error = await failureOf(
        createCommunityKubeClient(config).createPod({
          metadata: { name: 'cd-scan-opengrep-c1' },
        }),
      );

      expect(error).toBeInstanceOf(KubeCallError);
      expect(error.status).toBeNull();
      expect(error.message).toBe('createPod failed status=network');
    });

    it('an unreadable kubeconfig fails a call without its text', async () => {
      jest
        .spyOn(k8s.KubeConfig.prototype, 'loadFromFile')
        .mockImplementation(() => {
          throw new Error('bad YAML near token: kubeconfig-secret-token');
        });

      const error = await failureOf(
        createCommunityKubeClient(config).readPod('cd-scan-opengrep-c1'),
      );

      expect(error).toBeInstanceOf(KubeCallError);
      expect(error.message).toBe('readPod failed status=network');
      expect(String(error.stack)).not.toContain('kubeconfig-secret-token');
    });
  });

  describe('calls', () => {
    it('creates an Opaque Secret with its labels and string data', async () => {
      const create = jest.spyOn(
        k8s.CoreV1Api.prototype,
        'createNamespacedSecret',
      );

      await createCommunityKubeClient(config).createSecret(
        'cd-scan-opengrep-c1-run',
        { 'app.kubernetes.io/managed-by': 'cybedefend' },
        { CYBEDEFEND_SCAN_TOKEN: 'cdst_x' },
      );

      expect(create).toHaveBeenCalledWith({
        namespace: 'scans',
        body: {
          apiVersion: 'v1',
          kind: 'Secret',
          type: 'Opaque',
          metadata: {
            name: 'cd-scan-opengrep-c1-run',
            namespace: 'scans',
            labels: { 'app.kubernetes.io/managed-by': 'cybedefend' },
          },
          stringData: { CYBEDEFEND_SCAN_TOKEN: 'cdst_x' },
        },
      });
    });

    it('creates a pod in the namespace and answers its uid', async () => {
      const create = jest
        .spyOn(k8s.CoreV1Api.prototype, 'createNamespacedPod')
        .mockResolvedValue({ metadata: { uid: 'uid-1' } } as never);

      await expect(
        createCommunityKubeClient(config).createPod({
          metadata: { name: 'cd-scan-opengrep-c1', namespace: 'default' },
          spec: { containers: [] },
        }),
      ).resolves.toEqual({ uid: 'uid-1' });

      expect(create).toHaveBeenCalledWith({
        namespace: 'scans',
        body: {
          metadata: { name: 'cd-scan-opengrep-c1', namespace: 'scans' },
          spec: { containers: [] },
        },
      });
    });

    it('reads a pod, and a missing one is null', async () => {
      const read = jest
        .spyOn(k8s.CoreV1Api.prototype, 'readNamespacedPod')
        .mockResolvedValueOnce({ metadata: { name: 'p' } } as never)
        .mockRejectedValueOnce(httpError(404));
      const client = createCommunityKubeClient(config);

      await expect(client.readPod('p')).resolves.toEqual({
        metadata: { name: 'p' },
      });
      await expect(client.readPod('gone')).resolves.toBeNull();
      expect(read).toHaveBeenCalledWith({ name: 'p', namespace: 'scans' });
    });

    it("lists this instance's managed pods only, by both labels", async () => {
      const list = jest
        .spyOn(k8s.CoreV1Api.prototype, 'listNamespacedPod')
        .mockResolvedValue({ items: [{ metadata: { name: 'p' } }] } as never);

      await expect(
        createCommunityKubeClient(config).listManagedPods(),
      ).resolves.toEqual([{ metadata: { name: 'p' } }]);
      expect(list).toHaveBeenCalledWith({
        namespace: 'scans',
        labelSelector:
          'app.kubernetes.io/managed-by=cybedefend,cybedefend.io/instance=38612c965a9c4c35',
      });
    });

    it('deletes are idempotent on 404', async () => {
      const deletePod = jest
        .spyOn(k8s.CoreV1Api.prototype, 'deleteNamespacedPod')
        .mockRejectedValue(httpError(404));
      const deleteSecret = jest
        .spyOn(k8s.CoreV1Api.prototype, 'deleteNamespacedSecret')
        .mockRejectedValue(httpError(404));
      const client = createCommunityKubeClient(config);

      await expect(client.deletePod('p')).resolves.toBeUndefined();
      await expect(client.deleteSecret('p-run')).resolves.toBeUndefined();
      expect(deletePod).toHaveBeenCalledWith({ name: 'p', namespace: 'scans' });
      expect(deleteSecret).toHaveBeenCalledWith({
        name: 'p-run',
        namespace: 'scans',
      });
    });

    it('a delete refused otherwise rejects with its status', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'deleteNamespacedPod')
        .mockRejectedValue(httpError(403));

      const error = await failureOf(
        createCommunityKubeClient(config).deletePod('p'),
      );
      expect(error.message).toBe('deletePod failed status=403');
    });

    it('refuses a pod answer without a uid', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'createNamespacedPod')
        .mockResolvedValue({ metadata: { name: 'p' } } as never);

      const error = await failureOf(
        createCommunityKubeClient(config).createPod({
          metadata: { name: 'p' },
        }),
      );

      expect(error).toBeInstanceOf(KubeCallError);
      expect(error.message).toBe('createPod failed status=network');
    });

    it('a 401 drops the clients: the next call reads the kubeconfig again (rotated token)', async () => {
      const load = jest.spyOn(k8s.KubeConfig.prototype, 'loadFromFile');
      const read = jest
        .spyOn(k8s.CoreV1Api.prototype, 'readNamespacedPod')
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValue({ metadata: { name: 'p' } } as never);
      const client = createCommunityKubeClient(config);

      expect((await failureOf(client.readPod('p'))).status).toBe(401);
      expect(load).toHaveBeenCalledTimes(1);
      await expect(client.readPod('p')).resolves.toEqual({
        metadata: { name: 'p' },
      });
      expect(load).toHaveBeenCalledTimes(2);
      await client.readPod('p');
      expect(load).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(3);
    });

    it('any other refusal keeps the clients', async () => {
      const load = jest.spyOn(k8s.KubeConfig.prototype, 'loadFromFile');
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'readNamespacedPod')
        .mockRejectedValueOnce(httpError(403))
        .mockResolvedValue({ metadata: {} } as never);
      const client = createCommunityKubeClient(config);

      await failureOf(client.readPod('p'));
      await client.readPod('p');

      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('deadline (10 s on the clock)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const never = () => new Promise<never>(() => undefined);

    it('a call that never answers rejects KubeCallError(null, op) after 10 s', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'createNamespacedSecret')
        .mockImplementation(never as never);

      const outcome = createCommunityKubeClient(config)
        .createSecret('s', {}, {})
        .then(
          () => 'resolved',
          (e: KubeCallError) => e,
        );
      await jest.advanceTimersByTimeAsync(9_999);
      let settled: unknown = 'pending';
      void outcome.then((v) => (settled = v));
      await Promise.resolve();
      expect(settled).toBe('pending');

      await jest.advanceTimersByTimeAsync(1);
      const error = (await outcome) as KubeCallError;
      expect(error).toBeInstanceOf(KubeCallError);
      expect(error.status).toBeNull();
      expect(error.message).toBe('createSecret failed status=network');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('an answer in time clears its timer', async () => {
      jest
        .spyOn(k8s.CoreV1Api.prototype, 'readNamespacedPod')
        .mockResolvedValue({ metadata: {} } as never);

      await createCommunityKubeClient(config).readPod('p');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('a review that never answers is cluster_unreachable after 10 s', async () => {
      reviewSpy().mockImplementation(never as never);

      const outcome = createCommunityKubeClient(config).reviewAccess();
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(outcome).resolves.toEqual({
        ok: false,
        reason: 'cluster_unreachable',
      });
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('with the real KubeConfig class', () => {
    /**
     * The real @kubernetes/client-node (Jest maps the package to the mock):
     * loaded through Node's own require, as keep-alive-kubeconfig.spec.ts
     * does, and handed to the client as its KubeConfig factory. The API
     * clients it would build are replaced by the mock's, so no request leaves
     * the test.
     */
    const realK8s = (
      process.getBuiltinModule('node:module') as typeof import('node:module')
    ).createRequire(__filename)('@kubernetes/client-node') as typeof k8s;

    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'k2-kubeconfig-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const kubeconfig = (
      user: string,
      contextNamespace = '',
      cluster = '    server: https://127.0.0.1:1',
    ): string => {
      const file = join(dir, 'kubeconfig');
      writeFileSync(
        file,
        [
          'apiVersion: v1',
          'kind: Config',
          'clusters:',
          '- name: c',
          '  cluster:',
          cluster,
          'contexts:',
          '- name: ctx',
          '  context:',
          '    cluster: c',
          '    user: u',
          contextNamespace ? `    namespace: ${contextNamespace}` : '',
          'current-context: ctx',
          'users:',
          '- name: u',
          '  user:',
          user,
          '',
        ].join('\n'),
      );
      return file;
    };

    const realClient = (file: string, allowInsecureTls = false) => {
      const built: string[] = [];
      const factory = () => {
        const kc = new realK8s.KubeConfig();
        jest.spyOn(kc, 'makeApiClient').mockImplementation(((cls: {
          name: string;
        }) => {
          built.push(cls.name);
          // the client asks for the API classes it imports (the mock's), and
          // the mock's KubeConfig hands them out
          const mockConfig = new k8s.KubeConfig();
          return cls === k8s.AuthorizationV1Api
            ? mockConfig.makeApiClient(k8s.AuthorizationV1Api)
            : mockConfig.makeApiClient(k8s.CoreV1Api);
        }) as never);
        return kc;
      };
      return {
        built,
        client: createCommunityKubeClient(
          { ...config, kubeconfigFile: file, allowInsecureTls },
          { kubeConfig: factory },
        ),
      };
    };

    it("uses the configured namespace, never the kubeconfig's context namespace", async () => {
      const file = kubeconfig('    token: t0ken', 'kube-system');
      const parsed = new realK8s.KubeConfig();
      parsed.loadFromFile(file);
      expect(parsed.getContextObject('ctx')?.namespace).toBe('kube-system');
      const review = reviewSpy().mockResolvedValue(allowed() as never);
      const read = jest
        .spyOn(k8s.CoreV1Api.prototype, 'readNamespacedPod')
        .mockResolvedValue({ metadata: {} } as never);
      const { client, built } = realClient(file);

      await expect(client.reviewAccess()).resolves.toEqual({ ok: true });
      await client.readPod('p');

      expect(built.length).toBeGreaterThan(0);
      expect(review).toHaveBeenCalledTimes(6);
      for (const [param] of review.mock.calls) {
        expect(
          (param as { body: k8s.V1SelfSubjectAccessReview }).body.spec
            .resourceAttributes.namespace,
        ).toBe('scans');
      }
      expect(read).toHaveBeenCalledWith({ name: 'p', namespace: 'scans' });
    });

    it('refuses an exec plugin: no process, kubeconfig_unreadable, one WARN without the command', async () => {
      const marker = join(dir, 'exec-ran');
      const file = kubeconfig(
        [
          '    exec:',
          '      apiVersion: client.authentication.k8s.io/v1beta1',
          '      command: /bin/sh',
          '      args:',
          `      - -c`,
          `      - touch ${marker}`,
          '      env:',
          '      - name: PLUGIN_SECRET',
          '        value: plugin-secret-value',
          '      interactiveMode: Never',
        ].join('\n'),
      );
      // the module object the real library reads `spawn` from (its exec auth
      // takes `child_process.spawn` off the default import)
      const childProcess = process.getBuiltinModule(
        'node:child_process',
      ) as typeof import('node:child_process');
      const spawn = jest.spyOn(childProcess, 'spawn');
      const spawnSync = jest.spyOn(childProcess, 'spawnSync');
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const review = reviewSpy();
      const { client, built } = realClient(file);

      await expect(client.reviewAccess()).resolves.toEqual({
        ok: false,
        reason: 'kubeconfig_unreadable',
      });
      const callError = await failureOf(client.readPod('p'));
      expect(callError.message).toBe('readPod failed status=network');

      expect(spawn).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
      expect(existsSync(marker)).toBe(false);
      expect(built).toEqual([]);
      expect(review).not.toHaveBeenCalled();
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toEqual(['CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED']);
      for (const text of [
        '/bin/sh',
        'touch',
        'PLUGIN_SECRET',
        'plugin-secret-value',
        dir,
        file,
      ]) {
        expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
      }
    });

    it('refuses an auth-provider plugin', async () => {
      const file = kubeconfig(
        [
          '    auth-provider:',
          '      name: oidc',
          '      config:',
          '        id-token: provider-secret',
        ].join('\n'),
      );
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { client, built } = realClient(file);

      await expect(client.reviewAccess()).resolves.toEqual({
        ok: false,
        reason: 'kubeconfig_unreadable',
      });
      expect(built).toEqual([]);
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        'CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED',
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('provider-secret');
    });

    it('a user without a token, a certificate or basic credentials is kubeconfig_unreadable', async () => {
      const { client, built } = realClient(
        kubeconfig('    impersonate: someone'),
      );

      await expect(client.reviewAccess()).resolves.toEqual({
        ok: false,
        reason: 'kubeconfig_unreadable',
      });
      expect(built).toEqual([]);
    });

    describe('TLS verification of the API server', () => {
      const skipVerify = [
        '    server: https://127.0.0.1:1',
        '    insecure-skip-tls-verify: true',
      ].join('\n');

      it('refuses insecure-skip-tls-verify: no API client, insecure_tls, one WARN naming the setting and the opt-in', async () => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        const review = reviewSpy();
        const file = kubeconfig('    token: t0ken', '', skipVerify);
        const { client, built } = realClient(file);

        await expect(client.reviewAccess()).resolves.toEqual({
          ok: false,
          reason: 'insecure_tls',
        });
        await expect(client.reviewAccess()).resolves.toEqual({
          ok: false,
          reason: 'insecure_tls',
        });
        const callError = await failureOf(client.readPod('p'));
        expect(callError.message).toBe('readPod failed status=network');

        expect(built).toEqual([]);
        expect(review).not.toHaveBeenCalled();
        expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
          'CLUSTER_KUBECONFIG_INSECURE_TLS setting=insecure-skip-tls-verify allow=CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS',
        ]);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('t0ken');
        expect(JSON.stringify(warn.mock.calls)).not.toContain(file);
      });

      it('refuses a plain http:// API server (the token would travel in clear)', async () => {
        const { client, built } = realClient(
          kubeconfig(
            '    token: t0ken',
            '',
            [
              '    server: http://127.0.0.1:1',
              '    insecure-skip-tls-verify: true',
            ].join('\n'),
          ),
        );
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        await expect(client.reviewAccess()).resolves.toEqual({
          ok: false,
          reason: 'insecure_tls',
        });
        expect(built).toEqual([]);
      });

      it('accepts insecure-skip-tls-verify when CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS opts in', async () => {
        reviewSpy().mockResolvedValue(allowed() as never);
        const { client } = realClient(
          kubeconfig('    token: t0ken', '', skipVerify),
          true,
        );

        await expect(client.reviewAccess()).resolves.toEqual({ ok: true });
      });

      it('accepts a cluster without a CA: the system trust store verifies the server', async () => {
        reviewSpy().mockResolvedValue(allowed() as never);
        const { client } = realClient(kubeconfig('    token: t0ken'));

        await expect(client.reviewAccess()).resolves.toEqual({ ok: true });
      });
    });

    it.each([
      ['a token', '    token: t0ken'],
      [
        'a client certificate',
        '    client-certificate-data: Y2VydA==\n    client-key-data: a2V5',
      ],
      ['basic credentials', '    username: u\n    password: p'],
    ])('accepts %s', async (_label, user) => {
      reviewSpy().mockResolvedValue(allowed() as never);
      const { client } = realClient(kubeconfig(user));

      await expect(client.reviewAccess()).resolves.toEqual({ ok: true });
    });
  });
});
