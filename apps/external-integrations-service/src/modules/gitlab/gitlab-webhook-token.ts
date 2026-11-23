import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The secret token of a GitLab project webhook.
 *
 * GitLab sends the token it was given at registration, as is, in the
 * `X-Gitlab-Token` header of every delivery. Each hook gets its own random
 * token, so a token seen by an administrator of one GitLab instance, or in
 * one delivery, authenticates only the events of that project. Only its
 * SHA-256 is stored: comparing is all the service ever does with it, and a
 * 256-bit random token needs no slow hash.
 */

/** Random bytes per token: 32 bytes, 64 hex characters. */
const TOKEN_BYTES = 32;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A fresh random token, hex encoded. */
export function generateWebhookToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/** The SHA-256 of a token, hex encoded: what the repository row stores. */
export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * True when `candidate` hashes to one of `hashes`. Every comparison runs in
 * constant time on equal-length digests; a malformed stored hash is skipped.
 */
export function webhookTokenMatches(
  candidate: string | undefined | null,
  hashes: ReadonlyArray<string | null | undefined>,
): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  const digest = Buffer.from(hashWebhookToken(candidate), 'hex');
  let matched = false;
  for (const hash of hashes) {
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      continue;
    }
    // No early return: every stored hash is compared.
    if (timingSafeEqual(digest, Buffer.from(hash, 'hex'))) {
      matched = true;
    }
  }
  return matched;
}

const isProjectId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * The GitLab project a webhook payload is about: `project.id` (push and merge
 * request events) or `project_id` (project lifecycle events). When both are
 * present they must agree, since the token is checked against one project
 * and the handlers act on the other. Null when no usable id is found.
 */
export function gitlabProjectIdOf(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const body = payload as {
    project_id?: unknown;
    project?: { id?: unknown } | null;
  };
  const nested = body.project?.id;
  const flat = body.project_id;
  const ids = [nested, flat].filter((v) => v !== undefined && v !== null);
  if (ids.length === 0 || !ids.every(isProjectId)) {
    return null;
  }
  if (ids.length === 2 && ids[0] !== ids[1]) {
    return null;
  }
  return ids[0] as number;
}

/**
 * Reads `GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED`. Off unless set to `true`:
 * hooks registered before per-hook tokens existed carried the OAuth
 * application secret, and that token is accepted only while this is on and
 * only for a project none of whose rows holds a token hash yet.
 */
export function legacyWebhookTokenAccepted(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}
