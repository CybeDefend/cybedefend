import { ChannelCredentials, credentials } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';

/**
 * Transport security of every gRPC client channel of this service.
 *
 * When `GRPC_TLS_CA_FILE` names a PEM file, every channel to a server listed
 * in GRPC_TLS_SERVER_PACKAGES, or registered with
 * registerGrpcTlsServerPackages(), is TLS: the server must present a certificate
 * signed by that CA and valid for the host of the target (`<host>:<port>`).
 * A channel to any other package stays plaintext, since its server offers no
 * TLS. Unset or empty, every channel stays plaintext, as when the servers are
 * reached on a private network without certificates.
 *
 * A file that is set but unreadable or empty stops the boot: falling back to
 * plaintext would send the calls, and the caller's token, in clear.
 *
 * The file is read once, on the first TLS channel; a new CA is picked up on
 * restart. Every gRPC client option object passes `credentials:
 * grpcClientChannelCredentials(<its proto package>)` next to its
 * `channelOptions`.
 */
export const GRPC_TLS_CA_FILE_ENV = 'GRPC_TLS_CA_FILE';

export function buildGrpcChannelCredentials(
  caFile: string | undefined,
  read: (path: string) => Buffer = readFileSync,
): ChannelCredentials {
  const path = caFile?.trim();
  if (!path) return credentials.createInsecure();
  let ca: Buffer;
  try {
    ca = read(path);
  } catch (error) {
    throw new Error(
      `${GRPC_TLS_CA_FILE_ENV}=${path} cannot be read: ${(error as Error).message}`,
    );
  }
  if (ca.length === 0) {
    throw new Error(`${GRPC_TLS_CA_FILE_ENV}=${path} is empty`);
  }
  return credentials.createSsl(ca);
}

/** The proto packages of this edition's servers, which accept TLS when a CA is configured. */
export const GRPC_TLS_SERVER_PACKAGES: ReadonlySet<string> = new Set([
  'cybedefend.global_management',
  'cybedefend.security_scanning',
  'cybedefend.analysis_reporting',
  'cybedefend.file_management',
  'cybedefend.external_integrations',
  'cybedefend.policy_management',
]);

const registeredPackages = new Set<string>();

/**
 * Adds proto packages whose servers accept TLS, for servers another edition
 * runs. An empty list forgets every package registered so far. Called when
 * the module that registers them loads, before any client is built.
 */
export function registerGrpcTlsServerPackages(
  packages: readonly string[],
): void {
  if (packages.length === 0) {
    registeredPackages.clear();
    return;
  }
  for (const p of packages) registeredPackages.add(p);
}

function servedBehindTls(protoPackage: string): boolean {
  return (
    GRPC_TLS_SERVER_PACKAGES.has(protoPackage) ||
    registeredPackages.has(protoPackage)
  );
}

let plaintext: ChannelCredentials | undefined;
let configured: ChannelCredentials | undefined;
const warnedPackageSets = new Set<string>();

/**
 * A client that mixes a TLS server with a package served without TLS stays
 * plaintext even when a CA is set, so the TLS server is dialled in clear: one
 * warning per package set says so. A package that serves no TLS on its own is
 * plaintext by design and stays silent.
 */
function warnPlaintextFallback(packages: readonly string[]): void {
  const withoutTls = packages.filter((p) => !servedBehindTls(p));
  if (withoutTls.length === 0 || withoutTls.length === packages.length) return;
  if (!process.env[GRPC_TLS_CA_FILE_ENV]?.trim()) return;
  const key = packages.join(',');
  if (warnedPackageSets.has(key)) return;
  warnedPackageSets.add(key);
  new Logger('GrpcTls').warn(
    `GRPC_TLS_PLAINTEXT_FALLBACK packages=${key} without_tls=${withoutTls.join(',')}: the channel stays plaintext`,
  );
}

/**
 * The credentials of a gRPC client channel built for `protoPackage` (the
 * `package` of its client options): TLS when a CA is configured and every
 * package of the client is served behind TLS, plaintext otherwise. Built once
 * per process.
 */
export function grpcClientChannelCredentials(
  protoPackage: string | readonly string[],
): ChannelCredentials {
  const packages: readonly string[] =
    typeof protoPackage === 'string' ? [protoPackage] : protoPackage;
  const tls = packages.length > 0 && packages.every(servedBehindTls);
  if (!tls) {
    warnPlaintextFallback(packages);
    plaintext ??= credentials.createInsecure();
    return plaintext;
  }
  configured ??= buildGrpcChannelCredentials(process.env[GRPC_TLS_CA_FILE_ENV]);
  return configured;
}
