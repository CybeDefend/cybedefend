import { ConfigService } from '@nestjs/config';

/**
 * The public URL of this instance's dashboard: FRONTEND_URL (the cloud
 * variable) first, then APP_PUBLIC_URL (the Community Edition variable).
 * Trailing slashes are removed; undefined when neither is set — a Community
 * instance without a public URL renders no link instead of linking to the
 * cloud.
 */
export function publicAppUrl(
  config: Pick<ConfigService, 'get'>,
): string | undefined {
  const url =
    config.get<string>('FRONTEND_URL') ?? config.get<string>('APP_PUBLIC_URL');
  if (!url) {
    return undefined;
  }
  return url.replace(/\/+$/, '');
}

/** The Community compose's own default for CYBEDEFEND_PUBLIC_URL. */
export const COMMUNITY_DEFAULT_APP_URL = 'http://localhost:8080';

interface WarnLogger {
  warn(message: string): void;
}

// One warning per process, never per message: several providers resolve it.
let invalidAppUrlWarned = false;

/**
 * The dashboard URL of a Community instance, never a cloud host: FRONTEND_URL
 * (the compose sets it from CYBEDEFEND_PUBLIC_URL), else APP_PUBLIC_URL, one
 * trailing slash stripped. Unset gives http://localhost:8080; a value that is
 * not an http(s) URL gives it too, with one warning that never echoes the
 * value. Same rule as analysis-reporting's resolveFrontendUrl.
 */
export function communityAppUrl(
  config: Pick<ConfigService, 'get'>,
  logger: WarnLogger,
): string {
  const raw =
    nonEmpty(config.get<string>('FRONTEND_URL')) ??
    nonEmpty(config.get<string>('APP_PUBLIC_URL'));
  if (raw === undefined) {
    return COMMUNITY_DEFAULT_APP_URL;
  }
  if (isHttpUrl(raw)) {
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }
  if (!invalidAppUrlWarned) {
    invalidAppUrlWarned = true;
    logger.warn(
      `FRONTEND_URL / APP_PUBLIC_URL is not an http(s) URL; dashboard links use ${COMMUNITY_DEFAULT_APP_URL}`,
    );
  }
  return COMMUNITY_DEFAULT_APP_URL;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
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
