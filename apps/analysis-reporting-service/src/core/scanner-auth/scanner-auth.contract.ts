// Generic: byte-identical in security-scanning-service and
// analysis-reporting-service (scripts/tests/service-auth-parity.bats).
// Change both copies together.
//
// The contract of scanner-call authentication for the two services that
// answer scanner pods. The values the generic interceptor and edition glue
// also need (headers, audience, server settings, refusals, log lines) live in
// ../service-auth/scanner-call-auth, which every gRPC service holds, and are
// re-exported here unchanged; this file adds what only these two services
// use: the call binding's answers and the scanner pod's mounts.
//
// Settings and where they are read:
// - SCANNER_AUTH_MODE: resolveScannerAuthMode() in
//   ../service-auth/service-auth.edition (enforce only when exactly
//   `enforce`; always enforce in the Community Edition).
// - SCANNER_AUTH_NAMESPACES, SCANNER_AUTH_SERVICE_ACCOUNT,
//   SCANNER_AUTH_CLOSED_GRACE_SECONDS on the server side: the read* helpers,
//   whose defaults are the DEFAULT_* constants.
// - SCANNER_AUTH_SERVICE_ACCOUNT has a second reader with another meaning:
//   security-scanning's pod builder gives a scanner pod that service account,
//   its token volume and SCANNER_AUTH_TOKEN_FILE only when the variable is
//   set. Unset, pods are created exactly as before. So the builder reads
//   process.env itself and never falls back to the default, and the Joi
//   schema gives this variable NO default: @nestjs/config copies every Joi
//   default into process.env at boot, which would turn the token on in every
//   deployment. The server-side default comes from this contract instead.
// - SCANNER_GRPC_TLS (`true` adds the TLS settings and the CA volume to the
//   pod) and SCANNER_GRPC_CA_SECRET (default scanner-grpc-ca): security-scanning's
//   pod builder.
export * from '../service-auth/scanner-call-auth';

/**
 * What the call binding (edition port SCANNER_CALL_BINDING) answers for a
 * verified scanner call: ok, or why the token does not cover this request.
 * - not-bound: the request names another scan or project, or the pod is not a
 *   container of the scan;
 * - closed: the pod's container closed longer ago than the grace;
 * - lookup-failed: the scan could not be looked up.
 */
export type ScannerBindingAnswer =
  | 'ok'
  | 'not-bound'
  | 'closed'
  | 'lookup-failed';

export const SCANNER_BINDING_ANSWERS: readonly ScannerBindingAnswer[] = [
  'ok',
  'not-bound',
  'closed',
  'lookup-failed',
];

// The scanner pod's token: a projected service account token, read-only.
export const SCANNER_TOKEN_VOLUME = 'scanner-auth';
export const SCANNER_TOKEN_MOUNT_PATH = '/var/run/secrets/cybedefend/scanner';
export const SCANNER_TOKEN_PATH = 'token';
export const SCANNER_TOKEN_FILE = `${SCANNER_TOKEN_MOUNT_PATH}/${SCANNER_TOKEN_PATH}`;
/** The shortest lifetime Kubernetes issues; the kubelet renews the file before it ends. */
export const SCANNER_TOKEN_EXPIRATION_SECONDS = 600;
/** The pod variable naming the token file. Absent, the scanner sends no token. */
export const SCANNER_POD_TOKEN_FILE_ENV = 'SCANNER_AUTH_TOKEN_FILE';

// TLS to the scanner listeners: only the CA certificate is mounted, never a key.
export const SCANNER_GRPC_TLS_VARIABLE = 'SCANNER_GRPC_TLS';
export const SCANNER_GRPC_CA_SECRET_VARIABLE = 'SCANNER_GRPC_CA_SECRET';
export const DEFAULT_SCANNER_GRPC_CA_SECRET = 'scanner-grpc-ca';
export const SCANNER_CA_VOLUME = 'scanner-grpc-ca';
export const SCANNER_CA_SECRET_KEY = 'ca.crt';
export const SCANNER_CA_MOUNT_PATH = '/etc/cybedefend/scanner-ca';
export const SCANNER_CA_FILE = `${SCANNER_CA_MOUNT_PATH}/${SCANNER_CA_SECRET_KEY}`;
export const SCANNER_POD_GRPC_TLS_MODE_ENV = 'GRPC_TLS_MODE';
export const SCANNER_POD_GRPC_TLS_MODE = 'tls';
export const SCANNER_POD_GRPC_TLS_CA_FILE_ENV = 'GRPC_TLS_CA_FILE';
