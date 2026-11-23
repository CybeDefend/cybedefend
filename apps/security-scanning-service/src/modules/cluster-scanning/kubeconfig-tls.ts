/**
 * Whether a kubeconfig's cluster lets the client verify the API server.
 *
 * `insecure-skip-tls-verify: true` turns off the check of the server's
 * certificate, and a plain `http://` server has none: the bearer token or
 * the basic credentials of the kubeconfig then reach whoever answers at that
 * address. A cluster without `certificate-authority(-data)` is still
 * verified, against the system trust store, and is accepted.
 *
 * Shared by every client this service builds from a kubeconfig file or
 * string.
 */

/** The variable that accepts such a kubeconfig anyway. */
export const ALLOW_INSECURE_TLS_VARIABLE =
  'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS';

/** The kubeconfig setting that turns verification off. */
export type InsecureTlsSetting = 'insecure-skip-tls-verify' | 'http-server';

/** The fields of a client-node `Cluster` this check reads. */
export interface ClusterTlsFields {
  server?: string;
  skipTLSVerify?: boolean;
}

/** The setting that leaves the API server unverified, or null when it is verified. */
export function insecureTlsSettingOf(
  cluster: ClusterTlsFields | null | undefined,
): InsecureTlsSetting | null {
  if (!cluster) return null;
  if (cluster.skipTLSVerify === true) return 'insecure-skip-tls-verify';
  if (/^http:/i.test(cluster.server ?? '')) return 'http-server';
  return null;
}

/** The fixed WARN line of a refused kubeconfig: the setting, never a value of the file. */
export function insecureTlsRefusal(setting: InsecureTlsSetting): string {
  return `CLUSTER_KUBECONFIG_INSECURE_TLS setting=${setting} allow=${ALLOW_INSECURE_TLS_VARIABLE}`;
}
