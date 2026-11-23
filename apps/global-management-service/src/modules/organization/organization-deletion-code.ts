import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Organization deletion confirmation: only the creator deletes an
 * organization, with a 6-digit code e-mailed to them. The values below are
 * the product's limits.
 */

/** A code is valid 10 minutes, once. */
export const ORGANIZATION_DELETION_CODE_TTL_MS = 600_000;
/** Comparisons per code; the attempt is counted before the comparison. */
export const ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS = 5;
/** Codes sent per organization per hour. */
export const ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR = 3;
/** Minimum time between two sends for one organization. */
export const ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS = 60_000;
/** Failed comparisons per organization within 24 h that lock the deletion. */
export const ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY = 10;
/** How long the deletion stays locked. */
export const ORGANIZATION_DELETION_CODE_LOCK_MS = 86_400_000;

/** The window of the send limit and of the failure count. */
export const ORGANIZATION_DELETION_CODE_SEND_WINDOW_MS = 3_600_000;
export const ORGANIZATION_DELETION_CODE_FAILURE_WINDOW_MS = 86_400_000;

const CODE_SPACE = 1_000_000;
const CODE_PATTERN = /^\d{6}$/;

/** A uniform 6-digit code, zero-padded (`crypto.randomInt`, never Math.random). */
export function generateDeletionCode(): string {
  return String(crypto.randomInt(0, CODE_SPACE)).padStart(6, '0');
}

export function isWellFormedDeletionCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

/**
 * scrypt parameters: N = 2^15, r = 8, p = 1 needs 128·N·r = 32 MiB, exactly
 * node's default `maxmem`, which refuses it: 64 MiB leaves the margin.
 */
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const SALT_BYTES = 16;

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/** What is stored of a code: never the code itself. Both hex. */
export interface StoredDeletionCode {
  hash: string;
  salt: string;
}

export async function hashDeletionCode(
  code: string,
): Promise<StoredDeletionCode> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(code, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

/** Constant-time comparison of a candidate with a stored code. */
export async function deletionCodeMatches(
  candidate: string,
  stored: StoredDeletionCode,
): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = await scrypt(
    candidate,
    Buffer.from(stored.salt, 'hex'),
    SCRYPT_KEYLEN,
    SCRYPT_OPTIONS,
  );
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * The refusals, a closed list, the code as the gRPC message: the gateway
 * answers it as `body.code` (`organization-deletion-refusals.ts`).
 * `DELETION_CODE_INVALID` never says which: wrong, expired, already used,
 * missing or malformed.
 */
export const ORGANIZATION_DELETION_REFUSALS = [
  'NOT_ORGANIZATION_CREATOR',
  'DELETION_CODE_INVALID',
  'DELETION_CODE_ATTEMPTS_EXCEEDED',
  'DELETION_CODE_RATE_LIMITED',
  'DELETION_LOCKED',
] as const;

export type OrganizationDeletionRefusal =
  (typeof ORGANIZATION_DELETION_REFUSALS)[number];

const REFUSAL_STATUS: Record<OrganizationDeletionRefusal, status> = {
  NOT_ORGANIZATION_CREATOR: status.PERMISSION_DENIED,
  DELETION_CODE_INVALID: status.INVALID_ARGUMENT,
  DELETION_CODE_ATTEMPTS_EXCEEDED: status.FAILED_PRECONDITION,
  DELETION_CODE_RATE_LIMITED: status.RESOURCE_EXHAUSTED,
  DELETION_LOCKED: status.RESOURCE_EXHAUSTED,
};

export function organizationDeletionRefusal(
  code: OrganizationDeletionRefusal,
): RpcException {
  return new RpcException({ code: REFUSAL_STATUS[code], message: code });
}
