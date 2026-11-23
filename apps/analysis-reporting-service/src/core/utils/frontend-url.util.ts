/** The Community compose's own default for CYBEDEFEND_PUBLIC_URL. */
export const COMMUNITY_DEFAULT_FRONTEND_URL = 'http://localhost:8080';

export interface ConfigReader {
  get<T = string>(key: string, fallback?: T): T | undefined;
}

export interface WarnLogger {
  warn(message: string): void;
}

// One warning per process: three providers resolve the URL at construction.
let invalidFrontendUrlWarned = false;

/**
 * Base URL of the dashboard as the instance configures it: FRONTEND_URL (the
 * Community compose sets it from CYBEDEFEND_PUBLIC_URL, as for
 * global-management), one trailing slash stripped. A value that is not an
 * http(s) URL falls back to http://localhost:8080 with one warning, which
 * never echoes the value.
 *
 * Anything that hands a clickable link to a human or to an external system
 * (issue trackers, an export) resolves its base through the
 * FRONTEND_URL_RESOLVER edition port, whose Community binding is this
 * function; a closed extension may bind another resolution.
 */
export function resolveConfiguredFrontendUrl(
  config: ConfigReader,
  logger: WarnLogger,
): string {
  const raw = config.get<string>('FRONTEND_URL');
  if (raw === undefined || raw === null) return COMMUNITY_DEFAULT_FRONTEND_URL;
  const value = String(raw).trim();
  if (isHttpUrl(value)) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }
  if (!invalidFrontendUrlWarned) {
    invalidFrontendUrlWarned = true;
    logger.warn(
      `FRONTEND_URL is not an http(s) URL; dashboard links use ${COMMUNITY_DEFAULT_FRONTEND_URL}`,
    );
  }
  return COMMUNITY_DEFAULT_FRONTEND_URL;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !!url.host
    );
  } catch {
    return false;
  }
}
