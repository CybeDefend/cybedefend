/**
 * The storage key of an import scan's uploaded file,
 * `import/<projectId>/<scanId>.sarif`, whatever the compression (gzip is
 * detected from the first bytes by readers). file-management builds the same
 * key when it signs the upload URL (its own copy), analysis-reporting
 * reads the object through `GetImportDownloadUrl` with this key, and
 * security-scanning deletes it with `DeleteImportObject` at every terminal
 * state the import reaches.
 *
 * A Community cluster container's results are stored
 * per container, `import/<projectId>/<scanId>/<containerId>.sarif`. Without a
 * container (or with an empty one) the key is exactly the scan's.
 */
export function importObjectKey(
  projectId: string,
  scanId: string,
  containerId?: string,
): string {
  return containerId
    ? `import/${projectId}/${scanId}/${containerId}.sarif`
    : `import/${projectId}/${scanId}.sarif`;
}

/**
 * The key of the CycloneDX SBOM an `sca` import may store next to its SARIF
 * (`CreateScanRequest.import_sbom`), `import/<projectId>/<scanId>.sbom`:
 * file-management signs it with `kind: sbom`, analysis-reporting reads it as
 * `ImportResultsRequest.sbom_file_key`. The sca container of a Community
 * cluster scan (trivy fs, scan protocol 2) stores its own,
 * `import/<projectId>/<scanId>/<containerId>.sbom`.
 */
export function importSbomObjectKey(
  projectId: string,
  scanId: string,
  containerId?: string,
): string {
  return containerId
    ? `import/${projectId}/${scanId}/${containerId}.sbom`
    : `import/${projectId}/${scanId}.sbom`;
}

/** Whether an import scan stored an SBOM: `metadata.importSbom === true`. */
export function hasImportSbom(scan: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  return scan.metadata?.importSbom === true;
}

/**
 * Every object an import scan stored: its SARIF, and its SBOM when it has
 * one. Each terminal move deletes them all.
 */
export function importObjectKeysOf(scan: {
  projectId: string;
  id: string;
  metadata?: Record<string, unknown> | null;
}): string[] {
  return [
    importObjectKey(scan.projectId, scan.id),
    ...(hasImportSbom(scan)
      ? [importSbomObjectKey(scan.projectId, scan.id)]
      : []),
  ];
}
