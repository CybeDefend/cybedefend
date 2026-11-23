import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

/** Upload size cap for one SARIF import object: 50 MiB. */
export const IMPORT_MAX_UPLOAD_BYTES = 52_428_800;
/** Signed upload URL validity, in seconds. */
export const IMPORT_UPLOAD_TTL_SECONDS = 300;
/** Signed download URL validity, in seconds. */
export const IMPORT_DOWNLOAD_TTL_SECONDS = 1_200;

/** How the import object was encoded; sets only the signed Content-Type. */
export type ImportEncoding = 'identity' | 'gzip';

/**
 * What an import object holds: the SARIF file, or the CycloneDX SBOM an
 * `sca` import may send next to it (`RequestImportUploadUrlRequest.kind`).
 */
export type ImportKind = 'sarif' | 'sbom';

const UUID_SEGMENT =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/**
 * The four import key forms, and nothing else: the scan's own object
 * `import/<p>/<s>.sarif`, one object per scanner container of a Community
 * cluster scan `import/<p>/<s>/<c>.sarif`, the SBOM of an sca import
 * `import/<p>/<s>.sbom`, and the SBOM of a cluster scan's sca container
 * `import/<p>/<s>/<c>.sbom`. Every segment is a lower-case uuid, so a key is
 * never `..`, never empty, and never a prefix of other objects.
 */
const IMPORT_KEY_PATTERN = new RegExp(
  `^import/(${UUID_SEGMENT})/(${UUID_SEGMENT})(?:/(${UUID_SEGMENT}))?\\.(?:sarif|sbom)$`,
);
const CONTAINER_ID_PATTERN = new RegExp(`^${UUID_SEGMENT}$`);

/**
 * The one key of a SARIF import object, whatever the compression: readers
 * detect gzip from the first bytes (`1f 8b`), so the key never carries the
 * encoding. With a container id (a Community cluster scan, one object
 * per scanner container) the key is `import/<p>/<s>/<c>.sarif`; without one
 * (`undefined` or `null`) it is `import/<p>/<s>.sarif`, as before. Callers
 * check the container id with `assertImportContainerId` first, and the key
 * with `assertImportObjectKey` before any storage call.
 */
export function importObjectKey(
  projectId: string,
  scanId: string,
  containerId?: string | null,
): string {
  if (containerId === undefined || containerId === null) {
    return `import/${projectId}/${scanId}.sarif`;
  }
  return `import/${projectId}/${scanId}/${containerId}.sarif`;
}

/**
 * The key of the CycloneDX SBOM of an sca import, whatever the compression:
 * `import/<p>/<s>.sbom`, or, with a container id (the sca container of a
 * Community cluster scan), `import/<p>/<s>/<c>.sbom`.
 */
export function importSbomObjectKey(
  projectId: string,
  scanId: string,
  containerId?: string | null,
): string {
  if (containerId === undefined || containerId === null) {
    return `import/${projectId}/${scanId}.sbom`;
  }
  return `import/${projectId}/${scanId}/${containerId}.sbom`;
}

/**
 * INVALID_ARGUMENT unless the kind is absent (`undefined` / `null`: the
 * SARIF), `sarif` or `sbom`. Which containers may send an SBOM (the sca one)
 * is security-scanning's decision, from the container's token.
 */
export function assertImportKind(kind: string | null | undefined): void {
  if (
    kind === undefined ||
    kind === null ||
    kind === 'sarif' ||
    kind === 'sbom'
  ) {
    return;
  }
  throw new RpcException({
    code: status.INVALID_ARGUMENT,
    message: "kind must be 'sarif' or 'sbom'",
  });
}

/**
 * INVALID_ARGUMENT unless the container id is absent (`undefined` / `null`)
 * or a lower-case uuid. An empty string is NOT absent: proto3 `optional`
 * delivers an unset field as `undefined`, so `''` was sent on purpose and is
 * refused rather than read as « no container ».
 */
export function assertImportContainerId(
  containerId: string | null | undefined,
): void {
  if (containerId === undefined || containerId === null) return;
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'container_id must be a uuid',
    });
  }
}

/**
 * INVALID_ARGUMENT unless the key is exactly `import/<uuid>/<uuid>.sarif` or
 * `import/<uuid>/<uuid>/<uuid>.sarif` and its project segment is the caller's
 * projectId (lower-cased): an import object key can never reach another
 * project's objects or another prefix.
 */
export function assertImportObjectKey(projectId: string, key: string): void {
  const match = IMPORT_KEY_PATTERN.exec(key ?? '');
  if (!match || match[1] !== String(projectId ?? '').toLowerCase()) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message:
        'object_key must be import/<projectId>/<scanId>[/<containerId>].sarif or import/<projectId>/<scanId>[/<containerId>].sbom of this project',
    });
  }
}

/** The signed Content-Type of an import object; the key never changes. */
export function importContentType(
  encoding: ImportEncoding,
  kind: ImportKind = 'sarif',
): string {
  if (encoding === 'gzip') return 'application/gzip';
  return kind === 'sbom'
    ? 'application/vnd.cyclonedx+json'
    : 'application/sarif+json';
}
