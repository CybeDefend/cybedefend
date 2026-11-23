import { HttpStatus } from '@nestjs/common';
import type {
  CreateLocalPersonalAccessTokenResponse,
  LocalPersonalAccessToken,
} from '@grpc/global-management/local_auth';
import { AUTH_ERROR, localAuthRefusal } from './local-auth-errors';

/**
 * The REST shape of a personal access token. The
 * gRPC `LocalPersonalAccessToken` carries int64 epoch-ms fields, which the
 * gRPC loader hands over as strings (`longs: String`): every `*At` is read
 * with Number() here, and the REST answer carries ISO 8601 dates, `null`
 * for 0 (never). The secret never travels on a list item.
 */
export interface PersonalAccessTokenItem {
  id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** The creation answer: the metadata plus the secret, shown once. */
export interface CreatedPersonalAccessToken {
  id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  expiresAt: string | null;
  /** The `cdp_…` secret: `value` on the wire, never the metadata object. */
  token: string;
}

/** 0, '0', '' or absent → null; anything else → ISO 8601. */
export function msToIsoOrNull(ms: string | number | undefined): string | null {
  if (ms === undefined || ms === '') return null;
  const n = Number(ms);
  return Number.isFinite(n) && n !== 0 ? new Date(n).toISOString() : null;
}

/**
 * An ISO 8601 date → epoch ms; absent → 0 (never expires). A present value
 * that `Date` cannot read (the basic and week forms `@IsISO8601` accepts, such
 * as `20300101`) or one at or before 1970 is refused: global-management stores
 * any value ≤ 0 as « never expires », so it must never reach it.
 */
export function isoToMs(iso: string | undefined): number {
  if (iso === undefined) return 0;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw localAuthRefusal('PAT_EXPIRY_INVALID', HttpStatus.BAD_REQUEST);
  }
  return ms;
}

export function toPersonalAccessTokenItem(
  t: LocalPersonalAccessToken,
): PersonalAccessTokenItem {
  return {
    id: t.id,
    name: t.name,
    lastFour: t.lastFour,
    createdAt: new Date(Number(t.createdAt)).toISOString(),
    lastUsedAt: msToIsoOrNull(t.lastUsedAt),
    expiresAt: msToIsoOrNull(t.expiresAt),
  };
}

/**
 * Maps the creation response: the gRPC `value` is the `cdp_` secret and
 * becomes the REST `token`; the `token` field is the metadata. A response
 * without either half is a server bug: 500 AUTH_ERROR, never a half answer.
 */
export function toCreatedPersonalAccessToken(
  r: CreateLocalPersonalAccessTokenResponse,
): CreatedPersonalAccessToken {
  const meta = r.token;
  if (!meta || typeof r.value !== 'string' || !r.value) {
    throw localAuthRefusal(AUTH_ERROR, HttpStatus.INTERNAL_SERVER_ERROR);
  }
  return {
    id: meta.id,
    name: meta.name,
    lastFour: meta.lastFour,
    createdAt: new Date(Number(meta.createdAt)).toISOString(),
    expiresAt: msToIsoOrNull(meta.expiresAt),
    token: r.value,
  };
}
