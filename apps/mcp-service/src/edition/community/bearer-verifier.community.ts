import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import type {
  BearerRejection,
  BearerVerifier,
  VerifiedBearer,
} from '../ports/bearer-verifier.port';

/** `cdp_` + 32 random bytes in base64url without padding. */
export const COMMUNITY_TOKEN_PATTERN = /^cdp_[A-Za-z0-9_-]{43}$/;

/** How long a token the gateway accepted is trusted without asking again. */
export const POSITIVE_TTL_MS = 60_000;

/** How long a token the gateway refused stays refused without asking again. */
export const NEGATIVE_TTL_MS = 60_000;

/** Upper bound on cached answers, so random tokens cannot grow memory. */
const MAX_CACHED_ANSWERS = 10_000;

/** The check is one small authenticated read: it must not hold a request. */
const CHECK_TIMEOUT_MS = 10_000;

/** An authenticated route that every valid token may read. */
const CHECK_PATH = '/user/profile';

interface Answer {
  accepted: boolean;
  /** The id of the token's owner, from the profile the gateway answers. */
  ownerId?: string;
}

interface CachedAnswer extends Answer {
  expiresAt: number;
}

/**
 * Community bearer: a CybeDefend personal access token.
 *
 * A bearer that is not shaped like one (a JWT, a Logto `pat_` token) is
 * refused without a network call. A well-formed token is checked against the
 * gateway, which verifies personal access tokens, before the request goes
 * further: an unknown or revoked token gets 401 and no session is created
 * for it. The answer is cached for a short time per token, so the calls of a
 * session do not check it again each time; a gateway that cannot answer (a
 * network error, 429, 5xx) is not cached and refuses the request.
 *
 * The userId is a hash prefix of the token, never the token: it keys the
 * session store, the cache, and appears in logs. `subject` names the owner
 * of the token (the profile's id), so the request budget is per person.
 */
@Injectable()
export class PersonalAccessTokenBearerVerifier implements BearerVerifier {
  /** Each bearer not cached costs one call to the gateway. */
  readonly remote = true;
  protected readonly maxEntries: number = MAX_CACHED_ANSWERS;
  private readonly http: AxiosInstance;
  private readonly answers = new Map<string, CachedAnswer>();
  private readonly inFlight = new Map<string, Promise<Answer>>();

  constructor(config: ConfigService) {
    this.http = axios.create({
      baseURL: config.get<string>('CYBEDEFEND_API_RESOURCE'),
      timeout: CHECK_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'User-Agent': 'cybedefend-mcp-service' },
    });
  }

  async verify(token: string): Promise<VerifiedBearer | null> {
    if (!COMMUNITY_TOKEN_PATTERN.test(token)) {
      return null;
    }
    const digest = createHash('sha256').update(token).digest('hex');
    const answer = await this.answerFor(token, digest);
    if (!answer.accepted) return null;
    return {
      userId: `pat:${digest.slice(0, 32)}`,
      accessToken: token,
      ...(answer.ownerId ? { subject: `user:${answer.ownerId}` } : {}),
    };
  }

  // No resource_metadata: the OAuth discovery routes are closed (cloud only).
  challenge(reason: BearerRejection): string {
    return reason === 'missing_bearer'
      ? 'Bearer'
      : 'Bearer error="invalid_token"';
  }

  private async answerFor(token: string, digest: string): Promise<Answer> {
    const cached = this.answers.get(digest);
    if (cached && cached.expiresAt > Date.now()) {
      return { accepted: cached.accepted, ownerId: cached.ownerId };
    }
    if (cached) {
      this.answers.delete(digest);
    }

    // Requests that carry the same token at the same time share one check.
    let pending = this.inFlight.get(digest);
    if (!pending) {
      pending = this.askGateway(token).finally(() =>
        this.inFlight.delete(digest),
      );
      this.inFlight.set(digest, pending);
    }
    const answer = await pending;
    this.remember(digest, answer);
    return answer;
  }

  /** A definite answer; throws when there is none. */
  private async askGateway(token: string): Promise<Answer> {
    const { status, data } = await this.http.get(CHECK_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status >= 200 && status < 300) {
      const id = (data as { id?: unknown } | undefined)?.id;
      return typeof id === 'string' && id !== ''
        ? { accepted: true, ownerId: id }
        : { accepted: true };
    }
    if (status === 401 || status === 403) {
      return { accepted: false };
    }
    throw Object.assign(
      new Error(`personal access token check answered ${status}`),
      { code: `GATEWAY_${status}` },
    );
  }

  private remember(digest: string, answer: Answer): void {
    this.answers.delete(digest);
    while (this.answers.size >= this.maxEntries) {
      const oldest = this.answers.keys().next().value as string;
      this.answers.delete(oldest);
    }
    this.answers.set(digest, {
      ...answer,
      expiresAt:
        Date.now() + (answer.accepted ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
  }
}
