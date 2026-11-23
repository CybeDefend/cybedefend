import { Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type { V1Pod } from '@kubernetes/client-node';
import type { ClusterScanningConfig } from './cluster-scanning.config';
import { insecureTlsRefusal, insecureTlsSettingOf } from './kubeconfig-tls';

/**
 * The minimal Kubernetes client of the Community cluster engine. Six verbs in one namespace, nothing else:
 * `create`, `get`, `list` and `delete` on pods, `create` and `delete` on
 * Secrets. Never `list` on Secrets: a list returns their values,
 * so a Secret is only ever deleted by its name (`<podName>-run`).
 *
 * - The kubeconfig is the mounted file of CYBEDEFEND_SCANNER_KUBECONFIG_FILE,
 *   read again on every access review, so a file fixed or rotated while the
 *   service runs is picked up without a restart.
 * - The namespace is always the configured one, never the namespace of the
 *   kubeconfig's context.
 * - The kubeconfig's user must hold a token, a client certificate or basic
 *   credentials. An `exec` or `auth-provider` plugin is refused before any
 *   API client is built (it would spawn a process inside the service, and
 *   the image ships no plugin binary): kubeconfig_unreadable, with one WARN
 *   CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED that names nothing of the plugin.
 * - The API server must be verified: a cluster with
 *   `insecure-skip-tls-verify: true` or a plain `http://` server is refused
 *   before any API client is built (insecure_tls, one WARN
 *   CLUSTER_KUBECONFIG_INSECURE_TLS that names the setting and the opt-in),
 *   unless CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS=true. Without it the token
 *   would reach whoever answers at the server's address.
 * - Every call and every access review is bounded at 10 s on the clock
 *   (client-node's fetch has no timeout): past it a call rejects
 *   KubeCallError(null, op) and a review answers cluster_unreachable.
 * - A 401 drops the API clients, so the next call reads the kubeconfig again
 *   and picks up a rotated token.
 * - Every rejection becomes a KubeCallError that carries the operation and
 *   the HTTP status only: an API error body can quote the object sent (a
 *   Secret's token or archive URL), and a parse error of the kubeconfig can
 *   quote the file.
 */

/** Provider token; its value is a CommunityKubeClient. */
export const COMMUNITY_KUBE_CLIENT = 'COMMUNITY_KUBE_CLIENT';

/** Why the engine cannot use the cluster (`CLUSTER_SCANNING_DISABLED reason=`). */
export type KubeFailure =
  | 'kubeconfig_unreadable'
  | 'insecure_tls'
  | 'cluster_unreachable'
  | 'access_denied';

/** The label every object of the engine carries, and the one it lists by. */
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'cybedefend';
/**
 * The instance an object belongs to (`ClusterScanningConfig.instanceId`):
 * on every pod and Secret, and in the sweep's selector.
 */
export const INSTANCE_LABEL = 'cybedefend.io/instance';

/** A rejected Kubernetes call: the operation and its HTTP status (null: no answer). */
export class KubeCallError extends Error {
  constructor(
    readonly status: number | null,
    readonly operation: string,
  ) {
    super(`${operation} failed status=${status ?? 'network'}`);
    this.name = 'KubeCallError';
  }
}

export interface CommunityKubeClient {
  /** The six verbs, in the namespace. */
  reviewAccess(): Promise<{ ok: true } | { ok: false; reason: KubeFailure }>;
  createSecret(
    name: string,
    labels: Record<string, string>,
    data: Record<string, string>,
  ): Promise<void>;
  /** A missing Secret (404) resolves. */
  deleteSecret(name: string): Promise<void>;
  createPod(pod: V1Pod): Promise<{ uid: string }>;
  /** A missing pod (404) is null. */
  readPod(name: string): Promise<V1Pod | null>;
  /**
   * This instance's pods: app.kubernetes.io/managed-by=cybedefend AND
   * cybedefend.io/instance=<instanceId>. Pods only.
   */
  listManagedPods(): Promise<V1Pod[]>;
  /** A missing pod (404) resolves. */
  deletePod(name: string): Promise<void>;
}

/** The verbs the engine needs. */
const ACCESS: readonly { verb: string; resource: string }[] = [
  { verb: 'create', resource: 'pods' },
  { verb: 'get', resource: 'pods' },
  { verb: 'list', resource: 'pods' },
  { verb: 'delete', resource: 'pods' },
  { verb: 'create', resource: 'secrets' },
  { verb: 'delete', resource: 'secrets' },
];

/**
 * The HTTP status of a rejection of @kubernetes/client-node 1.x (an
 * ApiException carries it as a number in `code`), null for a failure with no
 * answer (a network error carries a string `code`, ECONNREFUSED).
 */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as {
    code?: unknown;
    statusCode?: unknown;
    response?: { statusCode?: unknown; status?: unknown };
  };
  for (const candidate of [
    e.code,
    e.statusCode,
    e.response?.statusCode,
    e.response?.status,
  ]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The deadline of one Kubernetes call or one access review. */
export const KUBE_CALL_DEADLINE_MS = 10_000;

export interface CommunityKubeClientOptions {
  /** Builds the KubeConfig the file is read into (tests: the real class). */
  kubeConfig?: () => k8s.KubeConfig;
}

class DeadlineExceeded extends Error {}

/** `p`, or a DeadlineExceeded rejection after `ms`; the timer is cleared either way. */
async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

interface Apis {
  core: k8s.CoreV1Api;
  authorization: k8s.AuthorizationV1Api;
}

class KubeconfigUnreadable extends Error {}
class KubeconfigInsecureTls extends Error {}

const logger = new Logger('CommunityKubeClient');

/** The credentials the engine accepts: a token, a client certificate or basic. */
function hasPlainCredentials(user: k8s.User): boolean {
  return Boolean(
    user.token ||
    ((user.certData || user.certFile) && (user.keyData || user.keyFile)) ||
    (user.username && user.password),
  );
}

export function createCommunityKubeClient(
  config: ClusterScanningConfig,
  options: CommunityKubeClientOptions = {},
): CommunityKubeClient {
  const namespace = config.namespace;
  const newKubeConfig = options.kubeConfig ?? (() => new k8s.KubeConfig());
  let apis: Apis | null = null;
  let pluginWarned = false;
  let insecureWarned = false;

  /** Reads the kubeconfig file; its error text never leaves this function. */
  const load = (): Apis => {
    apis = null;
    let kubeConfig: k8s.KubeConfig;
    let user: k8s.User | null;
    let cluster: k8s.Cluster | null;
    try {
      kubeConfig = newKubeConfig();
      kubeConfig.loadFromFile(config.kubeconfigFile);
      user = kubeConfig.getCurrentUser();
      cluster = kubeConfig.getCurrentCluster();
    } catch {
      throw new KubeconfigUnreadable();
    }
    const insecure = insecureTlsSettingOf(cluster);
    if (insecure && !config.allowInsecureTls) {
      if (!insecureWarned) {
        insecureWarned = true;
        logger.warn(insecureTlsRefusal(insecure));
      }
      throw new KubeconfigInsecureTls();
    }
    insecureWarned = false;
    if (user?.exec || user?.authProvider) {
      if (!pluginWarned) {
        pluginWarned = true;
        logger.warn('CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED');
      }
      throw new KubeconfigUnreadable();
    }
    pluginWarned = false;
    if (!user || !hasPlainCredentials(user)) throw new KubeconfigUnreadable();
    try {
      apis = {
        core: kubeConfig.makeApiClient(k8s.CoreV1Api),
        authorization: kubeConfig.makeApiClient(k8s.AuthorizationV1Api),
      };
      return apis;
    } catch {
      throw new KubeconfigUnreadable();
    }
  };

  const current = (): Apis => apis ?? load();

  /** Runs one call; any rejection becomes a KubeCallError(status). */
  const call = async <T>(
    operation: string,
    run: (a: Apis) => Promise<T>,
  ): Promise<T> => {
    let a: Apis;
    try {
      a = current();
    } catch {
      throw new KubeCallError(null, operation);
    }
    try {
      return await withDeadline(run(a), KUBE_CALL_DEADLINE_MS);
    } catch (error) {
      const status = error instanceof DeadlineExceeded ? null : statusOf(error);
      // a rotated token: read the kubeconfig again at the next call
      if (status === 401) apis = null;
      throw new KubeCallError(status, operation);
    }
  };

  const ignoreMissing = async (p: Promise<unknown>): Promise<void> => {
    try {
      await p;
    } catch (error) {
      if (error instanceof KubeCallError && error.status === 404) return;
      throw error;
    }
  };

  return {
    async reviewAccess() {
      let a: Apis;
      try {
        a = load();
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof KubeconfigInsecureTls
              ? 'insecure_tls'
              : 'kubeconfig_unreadable',
        };
      }
      try {
        const answers = await withDeadline(
          Promise.all(
            ACCESS.map(({ verb, resource }) =>
              a.authorization.createSelfSubjectAccessReview({
                body: {
                  apiVersion: 'authorization.k8s.io/v1',
                  kind: 'SelfSubjectAccessReview',
                  spec: { resourceAttributes: { namespace, verb, resource } },
                },
              }),
            ),
          ),
          KUBE_CALL_DEADLINE_MS,
        );
        if (answers.every((answer) => answer?.status?.allowed === true)) {
          return { ok: true };
        }
        return { ok: false, reason: 'access_denied' };
      } catch (error) {
        const status =
          error instanceof DeadlineExceeded ? null : statusOf(error);
        return {
          ok: false,
          reason:
            status === 401 || status === 403
              ? 'access_denied'
              : 'cluster_unreachable',
        };
      }
    },

    async createSecret(name, labels, data) {
      await call('createSecret', (a) =>
        a.core.createNamespacedSecret({
          namespace,
          body: {
            apiVersion: 'v1',
            kind: 'Secret',
            type: 'Opaque',
            metadata: { name, namespace, labels },
            stringData: data,
          },
        }),
      );
    },

    async deleteSecret(name) {
      await ignoreMissing(
        call('deleteSecret', (a) =>
          a.core.deleteNamespacedSecret({ name, namespace }),
        ),
      );
    },

    async createPod(pod) {
      const created = await call('createPod', (a) =>
        a.core.createNamespacedPod({
          namespace,
          body: { ...pod, metadata: { ...pod.metadata, namespace } },
        }),
      );
      const uid = created?.metadata?.uid;
      if (!uid) throw new KubeCallError(null, 'createPod');
      return { uid };
    },

    async readPod(name) {
      try {
        return await call('readPod', (a) =>
          a.core.readNamespacedPod({ name, namespace }),
        );
      } catch (error) {
        if (error instanceof KubeCallError && error.status === 404) return null;
        throw error;
      }
    },

    async listManagedPods() {
      const list = await call('listManagedPods', (a) =>
        a.core.listNamespacedPod({
          namespace,
          labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE},${INSTANCE_LABEL}=${config.instanceId}`,
        }),
      );
      return list?.items ?? [];
    },

    async deletePod(name) {
      await ignoreMissing(
        call('deletePod', (a) =>
          a.core.deleteNamespacedPod({ name, namespace }),
        ),
      );
    },
  };
}
