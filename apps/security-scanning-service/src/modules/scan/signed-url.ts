/**
 * Make a presigned object URL safe to write to the log store.
 *
 * A presigned URL is a bearer credential: its query string carries the
 * signature that grants read access to the object for the lifetime of
 * `X-Amz-Expires`. Logging it in full hands customer source code to anyone
 * with read access to the logs. Pino's `redact.paths` (core/logger/logger.ts)
 * cannot cover this — it rewrites structured fields, whereas these URLs are
 * interpolated into the message string — so redaction happens at the call site.
 *
 * The bucket and object key survive: that is the part which makes a log line
 * useful when tracing a scan, and it grants nothing on its own.
 */
const REDACTED_MARKER = '?<redacted>';

export function redactSignedUrl(url: string | null | undefined): string {
  if (!url) return '<none>';

  // Cut at the first '?' rather than parsing: it holds for well-formed URLs and
  // for anything malformed alike, so a value that is not a URL still gets
  // scrubbed instead of being echoed back with its signature intact.
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const base = url.slice(0, queryStart);
  // Idempotent: re-redacting an already-redacted value must not append a
  // second marker (log lines get passed through helpers more than once).
  return url.slice(queryStart) === REDACTED_MARKER
    ? url
    : `${base}${REDACTED_MARKER}`;
}
