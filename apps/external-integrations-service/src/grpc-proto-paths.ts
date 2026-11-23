import { readFileSync } from 'node:fs';

/**
 * The protos main.ts always loads, relative to libs/protos. The closed paths
 * (crm-sync/crm_sync.proto, external-integrations/repository_history.proto)
 * are not here: they live in EE_PROTO_PATHS and are appended in
 * cloud mode only, through editionProtoPaths() — in the exported tree the
 * files do not exist and a core reference to them kills the process at
 * start. The eleven container registry protos are closed too: their
 * gRPC servers belong to the closed edition (container results enter the
 * Community Edition as a SARIF import).
 */
export const CORE_GRPC_PROTO_PATHS: readonly string[] = [
  'external-integrations/external_integrations.proto',
  'external-integrations/issue.proto',
  'health/health.proto',
];

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;

/**
 * The proto packages the gRPC server binds, read from the proto files it
 * loads (each package once, in load order). Nest throws
 * InvalidGrpcPackageException at start for a `package` option no loaded
 * proto declares, so a hard-coded list would name, in the community
 * edition, the package of a closed proto it does not load.
 */
export function grpcPackagesOf(protoFiles: readonly string[]): string[] {
  const packages: string[] = [];
  for (const file of protoFiles) {
    const match = PACKAGE_RE.exec(readFileSync(file, 'utf8'));
    if (match && !packages.includes(match[1])) packages.push(match[1]);
  }
  return packages;
}
