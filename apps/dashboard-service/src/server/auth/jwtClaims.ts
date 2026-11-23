/**
 * Read timing claims from a JWT WITHOUT verifying it. Only used to schedule
 * the proactive token refresh — the gateway is the one that verifies
 * signatures. A token we cannot decode simply falls back to a fixed cadence.
 */
export interface TokenTiming {
  exp: number;
  iat: number | null;
}

/** Refresh this many seconds before `exp`, at least. */
export const MIN_REFRESH_MARGIN_S = 30;
/** …and at most this many, whatever the token lifetime. */
export const MAX_REFRESH_MARGIN_S = 120;
/** Margin as a fraction of the token lifetime (exp - iat). */
export const REFRESH_MARGIN_FRACTION = 0.1;
const DEFAULT_MARGIN_S = 60;

const decodeBase64Url = (segment: string): string => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

export function readTokenTiming(token: string): TokenTiming | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (!payload || typeof payload !== 'object') return null;
    const { exp, iat } = payload as { exp?: unknown; iat?: unknown };
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    return {
      exp,
      iat: typeof iat === 'number' && Number.isFinite(iat) ? iat : null,
    };
  } catch {
    return null;
  }
}

export function refreshMarginSeconds(timing: TokenTiming): number {
  if (timing.iat === null) return DEFAULT_MARGIN_S;
  const lifetime = Math.max(0, timing.exp - timing.iat);
  const raw = Math.round(lifetime * REFRESH_MARGIN_FRACTION);
  return Math.min(MAX_REFRESH_MARGIN_S, Math.max(MIN_REFRESH_MARGIN_S, raw));
}

/**
 * Milliseconds until the token should be refreshed (`exp - margin`), never
 * negative. `null` when the token cannot be decoded.
 */
export function computeRefreshDelayMs(
  token: string,
  nowMs: number = Date.now(),
): number | null {
  const timing = readTokenTiming(token);
  if (!timing) return null;
  const refreshAtMs = (timing.exp - refreshMarginSeconds(timing)) * 1000;
  return Math.max(0, refreshAtMs - nowMs);
}

/** Seconds left before `exp` (negative once expired); `null` if undecodable. */
export function secondsUntilExpiry(
  token: string,
  nowMs: number = Date.now(),
): number | null {
  const timing = readTokenTiming(token);
  if (!timing) return null;
  return Math.round(timing.exp - nowMs / 1000);
}
