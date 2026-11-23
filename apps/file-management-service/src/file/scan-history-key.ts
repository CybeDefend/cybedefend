/**
 * Object key of a scan's git history tar, next to its archive. It lives under
 * `scan/<projectId>/`, so the project purge removes it with the archive, and
 * no `FileScan` row points at it, so the upload cron never processes it.
 */
export function historyObjectKey(projectId: string, scanId: string): string {
  return `scan/${projectId}/${scanId}.history.tar`;
}

/**
 * The history tar key that goes with an archive key `scan/<p>/<s>.zip`, or
 * null when the key is not of that shape. Never throws.
 */
export function historyKeyForArchive(objectPath: string): string | null {
  const m = /^scan\/([^/]+)\/([^/.]+)\.zip$/.exec(objectPath ?? '');
  return m ? historyObjectKey(m[1], m[2]) : null;
}
