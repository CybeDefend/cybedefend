import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { currentEdition, type Edition } from '../../edition/edition';
import {
  BEARER_VERIFIER,
  type BearerVerifier,
  type VerifiedBearer,
} from '../../edition/ports/bearer-verifier.port';
import { clientRateLimitAddressOf, isInternalPeer } from './client-ip';
import { corsOptionsFor } from './http-surface.options';
import {
  allowedOriginsFrom,
  isOriginAllowed,
  type AllowedOrigins,
} from './origin-policy';

/**
 * Request limits and the origin check of the public HTTP entry.
 *
 * Budgets, each counted in a fixed window:
 *
 *  - a request with a bearer is verified here, before the handler, and
 *    counted on the person it belongs to (the verifier's `subject`, else its
 *    `userId`). If authentication then refuses a request counted here, its
 *    count is given back. A bearer the verifier refuses is never counted on
 *    a person, and the authentication guard answers it 401;
 *  - a request without a bearer is counted on the caller's address, in a
 *    small budget of its own (`anonymousMax`). A peer inside the deployment
 *    (no edge address header where an edge rewrites it) is never limited by
 *    address.
 *
 * What a refused bearer costs depends on the verifier (`BearerVerifier`'s
 * `remote`):
 *
 *  - a local verifier (a signature check) costs nothing to ask: a refused
 *    bearer is counted nowhere, and what other bearers did never makes a
 *    valid one wait;
 *  - a remote verifier calls another service for each bearer it has not
 *    cached, so made-up bearers would make this service call it without
 *    bound. There, a bearer this process has not accepted recently first
 *    takes a place in its address's budget of unverified bearers (same
 *    limit as `anonymousMax`, separate count), before the verifier is
 *    called. An accepted bearer gives its place back at once and is
 *    remembered (a digest, never the token) for an hour; a refused one, or
 *    one the verifier could not check, keeps its place until the window
 *    ends. With no place left, the request gets 429 before verification:
 *    `retry-after` is the window's end when refusals hold the places, one
 *    second when only verifications in flight do. A bearer remembered as
 *    accepted is verified and served whatever other bearers from its
 *    address did. Accepted consequence: while one address floods refused
 *    bearers, a bearer never used on this process from that same address
 *    waits until the window ends; bearers already in use, and every other
 *    address, are served. Behind a reverse proxy every caller has the
 *    proxy's address unless the proxy is trusted (`TRUST_PROXY_CIDR`).
 *
 * So no request without valid credentials ever spends an authenticated
 * caller's share, and an authenticated caller's burst never locks out
 * another identity.
 *
 * A request whose `Origin` header names a site that is not allowed is
 * refused with 403 before anything else (see `origin-policy.ts`).
 *
 * The health probe and the OAuth discovery documents are neither limited
 * nor origin-checked: probes and unauthenticated handshakes must always get
 * an answer. Counters live in this process only.
 */

/** Default budget of an authenticated identity per window. */
export const DEFAULT_AUTHENTICATED_MAX = 120;

/**
 * Default budget per address, per window, for requests without a bearer. An
 * agent's first contact without a bearer and an OAuth handshake take a few
 * requests each, so a few dozen leave room for several agents behind one
 * address.
 */
export const DEFAULT_ANONYMOUS_MAX = 60;

/** Default window of every budget. */
export const DEFAULT_WINDOW_MS = 60_000;

/** Upper bound on the keys a counter holds, so random keys cannot grow memory. */
const MAX_TRACKED_KEYS = 50_000;

export interface RequestGuardOptions {
  authenticatedMax: number;
  anonymousMax: number;
  windowMs: number;
  allowedOrigins: AllowedOrigins;
  edition?: Edition;
  nodeEnv?: string;
  now?: () => number;
  /** The application's `BEARER_VERIFIER` when omitted. */
  verifier?: BearerVerifier;
}

interface WindowCount {
  count: number;
  resetAt: number;
}

/** Fixed-window counters, bounded in size (the oldest key is dropped first). */
class WindowCounter {
  private readonly counts = new Map<string, WindowCount>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  private current(key: string): WindowCount {
    const entry = this.counts.get(key);
    const now = this.now();
    if (!entry || entry.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return entry;
  }

  /** Counts one request for a key and returns the new count. */
  hit(key: string): WindowCount {
    const current = this.current(key);
    const next = { count: current.count + 1, resetAt: current.resetAt };
    this.counts.delete(key);
    while (this.counts.size >= MAX_TRACKED_KEYS) {
      this.counts.delete(this.counts.keys().next().value as string);
    }
    this.counts.set(key, next);
    return next;
  }

  /** Gives back one request counted in the window that ends at `resetAt`. */
  refund(key: string, resetAt: number): void {
    const entry = this.counts.get(key);
    if (entry && entry.resetAt === resetAt && entry.count > 0) {
      entry.count -= 1;
    }
  }
}

/**
 * How long a bearer accepted by a remote verifier is remembered (at least
 * one window), refreshed at each acceptance.
 */
const ACCEPTED_BEARER_MEMORY_MS = 60 * 60_000;

/** Upper bound on remembered bearers (the oldest is dropped first). */
const MAX_ACCEPTED_BEARERS = 10_000;

/** A place taken in the unverified-bearer budget of an address. */
interface Place {
  /** The verifier accepted the bearer: the place is free again at once. */
  release(): void;
  /** The verifier refused it or could not check it: held until the window ends. */
  keep(): void;
}

type PlaceOutcome =
  | { taken: true; place: Place }
  | { taken: false; retryAt: number };

interface AddressPlaces {
  /** Places of refused bearers, held until `resetAt`. */
  held: number;
  /** Places of bearers being verified now. */
  inFlight: number;
  resetAt: number;
}

/**
 * Per-address budget of bearers a remote verifier has not accepted recently.
 * A place is taken before the verifier is called, so concurrent requests
 * cannot overshoot it.
 */
class UnverifiedBearerPlaces {
  private readonly addresses = new Map<string, AddressPlaces>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** The address's entry, its window renewed once it has ended. */
  private current(key: string): AddressPlaces {
    const now = this.now();
    let entry = this.addresses.get(key);
    if (!entry) {
      entry = { held: 0, inFlight: 0, resetAt: now + this.windowMs };
    } else if (entry.resetAt <= now) {
      entry.held = 0;
      entry.resetAt = now + this.windowMs;
    }
    this.addresses.delete(key);
    while (this.addresses.size >= MAX_TRACKED_KEYS) {
      this.addresses.delete(this.addresses.keys().next().value as string);
    }
    this.addresses.set(key, entry);
    return entry;
  }

  take(key: string): PlaceOutcome {
    const entry = this.current(key);
    if (entry.held + entry.inFlight >= this.max) {
      // Places held by refusals free up when the window ends; places held
      // only by verifications in flight free up as soon as they answer.
      return {
        taken: false,
        retryAt: entry.held > 0 ? entry.resetAt : this.now() + 1_000,
      };
    }
    entry.inFlight += 1;
    let settled = false;
    const settle = (keep: boolean): void => {
      if (settled) return;
      settled = true;
      const live = this.addresses.get(key);
      if (!live) return;
      if (live.inFlight > 0) live.inFlight -= 1;
      if (keep) {
        this.current(key).held += 1;
      } else if (live.held === 0 && live.inFlight === 0) {
        this.addresses.delete(key);
      }
    };
    return {
      taken: true,
      place: { release: () => settle(false), keep: () => settle(true) },
    };
  }
}

/**
 * Digests of the bearers a remote verifier accepted recently, never the
 * bearers themselves. Bounded: the oldest is dropped first.
 */
class RecentlyAcceptedBearers {
  private readonly expiries = new Map<string, number>();

  constructor(
    private readonly lifetimeMs: number,
    private readonly now: () => number,
  ) {}

  has(digest: string): boolean {
    const expiresAt = this.expiries.get(digest);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.expiries.delete(digest);
      return false;
    }
    return true;
  }

  remember(digest: string): void {
    this.expiries.delete(digest);
    while (this.expiries.size >= MAX_ACCEPTED_BEARERS) {
      this.expiries.delete(this.expiries.keys().next().value as string);
    }
    this.expiries.set(digest, this.now() + this.lifetimeMs);
  }

  forget(digest: string): void {
    this.expiries.delete(digest);
  }
}

function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The bearer a request carries, or null; same parsing as `AuthGuard`. */
function bearerOf(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  const match = /^bearer\s+(.+)$/i.exec(
    typeof header === 'string' ? header : '',
  );
  const token = match?.[1].trim();
  return token ? token : null;
}

/** Routes outside the limits and the origin check. */
function isExempt(rawUrl: string | undefined): boolean {
  // The router tolerates duplicate leading slashes (see
  // `httpAdapterOptions`), but hooks see the raw URL.
  const url = (rawUrl || '').replace(/^\/{2,}/, '/');
  return (
    url.startsWith('/health') ||
    url.startsWith('/.well-known/oauth-protected-resource') ||
    url.startsWith('/.well-known/oauth-authorization-server')
  );
}

function tooManyRequests(
  reply: FastifyReply,
  resetAt: number,
  now: number,
): FastifyReply {
  const seconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return reply
    .code(429)
    .header('retry-after', String(seconds))
    .send({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${seconds}s`,
    });
}

interface CountedIdentity {
  key: string;
  resetAt: number;
}

function requestGuardsPlugin(
  options: RequestGuardOptions,
  verifier: BearerVerifier,
) {
  const now = options.now ?? Date.now;
  const edition = options.edition ?? currentEdition();
  const identities = new WindowCounter(options.windowMs, now);
  const anonymous = new WindowCounter(options.windowMs, now);
  // A verifier that does not say is local.
  const remote = verifier?.remote === true;
  const unverified = new UnverifiedBearerPlaces(
    options.anonymousMax,
    options.windowMs,
    now,
  );
  const accepted = new RecentlyAcceptedBearers(
    Math.max(options.windowMs, ACCEPTED_BEARER_MEMORY_MS),
    now,
  );
  const counted = new WeakMap<FastifyRequest, CountedIdentity>();

  const plugin = async (fastify: FastifyInstance): Promise<void> => {
    fastify.addHook('onRequest', async (req, reply) => {
      if (isExempt(req.url)) return;

      const origin = req.headers.origin;
      if (
        typeof origin === 'string' &&
        !isOriginAllowed(origin, options.allowedOrigins)
      ) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Origin not allowed',
        });
      }

      // A preflight carries no credentials and runs no handler.
      if (req.method === 'OPTIONS') return;

      const token = bearerOf(req);
      if (!token) {
        if (isInternalPeer(req, options.nodeEnv, edition)) return;
        const address = clientRateLimitAddressOf(req, options.nodeEnv, edition);
        const count = anonymous.hit(`address:${address}`);
        if (count.count > options.anonymousMax) {
          return tooManyRequests(reply, count.resetAt, now());
        }
        return;
      }

      // Where a verification is a call to another service, a bearer this
      // process has not accepted recently first takes a place in its
      // address's budget, so made-up bearers cannot make it call that
      // service without bound.
      let place: Place | null = null;
      let digest: string | null = null;
      if (remote && !isInternalPeer(req, options.nodeEnv, edition)) {
        digest = digestOf(token);
        if (!accepted.has(digest)) {
          const address = clientRateLimitAddressOf(
            req,
            options.nodeEnv,
            edition,
          );
          const outcome = unverified.take(`address:${address}`);
          if (outcome.taken === false) {
            return tooManyRequests(reply, outcome.retryAt, now());
          }
          place = outcome.place;
        }
      }

      let verified: VerifiedBearer | null;
      try {
        verified = await verifier.verify(token);
      } catch {
        // No answer: the authentication guard decides. Only the place taken
        // above, if any, is counted.
        place?.keep();
        if (digest) accepted.forget(digest);
        return;
      }
      if (!verified) {
        place?.keep();
        if (digest) accepted.forget(digest);
        return;
      }
      place?.release();
      if (digest) accepted.remember(digest);

      const key = `identity:${verified.subject ?? verified.userId}`;
      const count = identities.hit(key);
      if (count.count > options.authenticatedMax) {
        return tooManyRequests(reply, count.resetAt, now());
      }
      counted.set(req, { key, resetAt: count.resetAt });
    });

    fastify.addHook('onResponse', async (req, reply) => {
      const identity = counted.get(req);
      // Authentication refused a request counted on an identity here (the
      // bearer expired or was revoked in between): it was not that
      // identity's request, so its count is given back.
      if (identity && reply.statusCode === 401) {
        identities.refund(identity.key, identity.resetAt);
      }
    });
  };
  // Hooks apply to every route of the application, not to an encapsulated
  // child context (what `fastify-plugin` does).
  (plugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] =
    true;
  return plugin;
}

/**
 * Wires CORS, the origin check and the request limits on the application.
 * Call before `init`/`listen`.
 */
export async function registerRequestGuards(
  app: NestFastifyApplication,
  options: RequestGuardOptions,
): Promise<void> {
  app.enableCors(corsOptionsFor(options.allowedOrigins));
  const verifier =
    options.verifier ?? app.get<string, BearerVerifier>(BEARER_VERIFIER);
  await app
    .getHttpAdapter()
    .getInstance()
    .register(requestGuardsPlugin(options, verifier));
}

/** A positive integer from the environment, or the default. */
function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/**
 * A window length from `RATE_LIMIT_WINDOW`: milliseconds, or `<n> <unit>`
 * (`1 minute`, `10 seconds`, `30s`). Anything else is the default.
 */
export function windowMsFrom(raw: string | undefined): number {
  const text = (raw ?? '').trim().toLowerCase();
  if (/^\d+$/.test(text)) return positiveInteger(text, DEFAULT_WINDOW_MS);
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(text);
  const unit = match ? UNIT_MS[match[2]] : undefined;
  if (!match || unit === undefined) return DEFAULT_WINDOW_MS;
  const ms = Math.round(Number(match[1]) * unit);
  return ms > 0 ? ms : DEFAULT_WINDOW_MS;
}

/**
 * The options from the environment: `RATE_LIMIT_MAX` (authenticated budget),
 * `RATE_LIMIT_ANONYMOUS_MAX`, `RATE_LIMIT_WINDOW`, `MCP_ALLOWED_ORIGINS` and
 * `PUBLIC_URL`. An invalid value falls back to its default.
 */
export function requestGuardOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  edition: Edition = currentEdition(),
): RequestGuardOptions {
  return {
    authenticatedMax: positiveInteger(
      env.RATE_LIMIT_MAX,
      DEFAULT_AUTHENTICATED_MAX,
    ),
    anonymousMax: positiveInteger(
      env.RATE_LIMIT_ANONYMOUS_MAX,
      DEFAULT_ANONYMOUS_MAX,
    ),
    windowMs: windowMsFrom(env.RATE_LIMIT_WINDOW),
    allowedOrigins: allowedOriginsFrom(
      env.MCP_ALLOWED_ORIGINS,
      env.PUBLIC_URL,
      edition,
    ),
    edition,
    nodeEnv: env.NODE_ENV,
  };
}
