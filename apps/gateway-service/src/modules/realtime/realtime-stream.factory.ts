import {
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  Observable,
  Subject,
  finalize,
  interval,
  map,
  merge,
  of,
  takeUntil,
} from 'rxjs';
import { ulid } from 'ulid';
import {
  isBroadScopeChannel,
  toBroadScopeEnvelope,
} from './broad-scope-envelope';
import { MembershipRegistry } from './membership.registry';
import { REALTIME_REDIS_SUB } from './redis-subscriber.factory';
import {
  StreamAuthorizer,
  type StreamPermissionCheck,
} from './stream-authorization';

export interface CreateStreamInput {
  channels: string[];
  membershipScope?: { scopeKey: string; userId: string };
  request: any; // Fastify req — needs req.raw.on('close'), req.user.exp, req.user.sub
  lastEventId?: string | null; // ignored for now (Phase 2)
  /**
   * The permission checks the route passed (`@StreamAuthorization()`). The
   * stream repeats them while it is open and closes once one fails.
   */
  authorization?: StreamPermissionCheck[];
}

const HEARTBEAT_MS = 20_000;
const AUTH_REFRESH_LEAD_MS = 60_000;
/**
 * How often an open stream repeats its permission checks, in milliseconds
 * (`REALTIME_PERMISSION_RECHECK_MS`, 5 s to 1 h), within 20 % either way so
 * that streams opened together do not check together; the first check falls
 * at a random point between 20 % and 100 % of the period. A membership change
 * of the user re-checks at once; no event ever triggers a check.
 */
export const REALTIME_PERMISSION_RECHECK_MS = 60_000;
/**
 * The longest a stream lives when the request carries no token expiry (a
 * personal access token): the client reconnects, and its token is verified
 * again (`REALTIME_STREAM_MAX_LIFETIME_MS`, 1 min to 24 h).
 */
export const REALTIME_STREAM_MAX_LIFETIME_MS = 15 * 60_000;
/**
 * A check the permission engine cannot answer keeps the stream, and the next
 * period tries again; this many failures in a row close it. Only an explicit
 * deny closes a stream at once.
 */
export const REALTIME_PERMISSION_MAX_CONSECUTIVE_ERRORS = 3;

function boundedEnvMs(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return value >= min && value <= max ? value : fallback;
}

@Injectable()
export class RealtimeStreamFactory {
  private readonly logger = new Logger(RealtimeStreamFactory.name);

  // Refcount per channel: how many active streams are subscribed to it
  private readonly channelRefcounts = new Map<string, number>();

  // Per-channel set of subjects that receive incoming Redis messages
  private readonly channelSubjects = new Map<
    string,
    Set<Subject<MessageEvent>>
  >();

  // Whether we have already installed the shared 'message' listener on `sub`
  private listenerInstalled = false;

  constructor(
    @Inject(REALTIME_REDIS_SUB) private readonly sub: Redis,
    private readonly membership: MembershipRegistry,
    @Optional() private readonly authorizer?: StreamAuthorizer,
  ) {}

  createScopedStream(input: CreateStreamInput): Observable<MessageEvent> {
    const connectionId = ulid();
    const subject$ = new Subject<MessageEvent>();
    const disconnect$ = new Subject<void>();
    const timers: NodeJS.Timeout[] = [];

    // ── 1. Refcount + subject registration per channel ──────────────────────
    for (const ch of input.channels) {
      // Register this subject under the channel
      if (!this.channelSubjects.has(ch)) {
        this.channelSubjects.set(ch, new Set());
      }
      this.channelSubjects.get(ch)!.add(subject$);

      // Increment refcount; subscribe if this is the first consumer
      const rc = (this.channelRefcounts.get(ch) ?? 0) + 1;
      this.channelRefcounts.set(ch, rc);
      if (rc === 1) {
        // First subscriber for this channel — issue Redis SUBSCRIBE
        this.sub
          .subscribe(ch)
          .catch((e: Error) =>
            this.logger.error(`subscribe ${ch} failed: ${e.message}`),
          );
      }
    }

    // ── 2. Install the shared message dispatcher exactly once ───────────────
    this.installListenerOnce();

    // ── 3. Membership registration ──────────────────────────────────────────
    if (input.membershipScope) {
      this.membership.register(
        input.membershipScope.scopeKey,
        input.membershipScope.userId,
        connectionId,
        () => disconnect$.next(),
      );
    }

    // ── 4. Token expiry, or the longest a stream without one may live ──────
    const exp =
      typeof input.request?.user?.exp === 'number'
        ? input.request.user.exp * 1000
        : null;
    const now = Date.now();
    if (exp !== null) {
      const warnIn = exp - AUTH_REFRESH_LEAD_MS - now;
      if (warnIn > 0) {
        timers.push(
          setTimeout(() => {
            subject$.next({
              event: 'auth-refresh',
              data: JSON.stringify({ reason: 'token-expiring' }),
            } as MessageEvent);
          }, warnIn),
        );
      }
    }
    // The earlier of the token's expiry and the maximum lifetime: a stream
    // never outlives either, and the delay always fits a timer (24 h at most).
    const lifetimeEnd =
      now +
      boundedEnvMs(
        'REALTIME_STREAM_MAX_LIFETIME_MS',
        REALTIME_STREAM_MAX_LIFETIME_MS,
        60_000,
        86_400_000,
      );
    const closeAt = exp === null ? lifetimeEnd : Math.min(exp, lifetimeEnd);
    timers.push(
      setTimeout(() => disconnect$.next(), Math.max(0, closeAt - now)),
    );

    // ── 4b. Permission re-check: on a period and on a membership change ────
    let closed = false;
    let recheckTimer: NodeJS.Timeout | undefined;
    const userId: string | undefined = input.request?.user?.sub;
    const checks = input.authorization ?? [];
    if (this.authorizer && userId && checks.length > 0) {
      const authorizer = this.authorizer;
      const period = boundedEnvMs(
        'REALTIME_PERMISSION_RECHECK_MS',
        REALTIME_PERMISSION_RECHECK_MS,
        5_000,
        3_600_000,
      );
      let checking = false;
      let requested = false;
      let consecutiveErrors = 0;
      const recheck = () => {
        if (closed) return;
        if (checking) {
          // Asked for during a check that may have read the old answer:
          // run again once it ends.
          requested = true;
          return;
        }
        checking = true;
        requested = false;
        authorizer
          .isAllowed(userId, checks)
          .then(
            (allowed) => {
              consecutiveErrors = 0;
              if (!allowed) disconnect$.next();
            },
            () => {
              // The engine could not answer: keep the stream, try again at
              // the next period, close after too many failures in a row.
              consecutiveErrors += 1;
              if (
                consecutiveErrors >= REALTIME_PERMISSION_MAX_CONSECUTIVE_ERRORS
              ) {
                disconnect$.next();
              }
            },
          )
          .finally(() => {
            checking = false;
            if (requested) recheck();
          });
      };
      const schedule = (delay: number) => {
        recheckTimer = setTimeout(() => {
          recheck();
          schedule(period * (0.8 + 0.4 * Math.random()));
        }, delay);
      };
      schedule(period * (0.2 + 0.8 * Math.random()));
      this.membership.registerRecheck(userId, connectionId, recheck);
    }

    // ── 5. Client disconnect (Fastify raw socket close) ─────────────────────
    if (input.request?.raw?.on) {
      input.request.raw.on('close', () => disconnect$.next());
    }

    // ── 6. Stream composition ────────────────────────────────────────────────
    const connected$ = of({
      data: JSON.stringify({ type: 'connected', connectionId, ts: Date.now() }),
      id: connectionId,
    } as MessageEvent);

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        () =>
          ({
            data: JSON.stringify({ type: 'heartbeat', ts: Date.now() }),
          }) as MessageEvent,
      ),
    );

    return merge(connected$, subject$, heartbeat$).pipe(
      takeUntil(disconnect$),
      finalize(() => {
        closed = true;
        // Clear all scheduled timers
        for (const t of timers) clearTimeout(t);
        clearTimeout(recheckTimer);
        if (userId) this.membership.unregisterRecheck(userId, connectionId);

        // Decrement refcounts; unsubscribe from Redis when reaching zero
        for (const ch of input.channels) {
          const set = this.channelSubjects.get(ch);
          if (set) {
            set.delete(subject$);
          }

          const rc = (this.channelRefcounts.get(ch) ?? 0) - 1;
          if (rc <= 0) {
            this.channelRefcounts.delete(ch);
            this.channelSubjects.delete(ch);
            this.sub.unsubscribe(ch).catch(() => {});
          } else {
            this.channelRefcounts.set(ch, rc);
          }
        }

        // Unregister from membership registry
        if (input.membershipScope) {
          this.membership.unregister(
            input.membershipScope.scopeKey,
            input.membershipScope.userId,
            connectionId,
          );
        }
      }),
    );
  }

  private installListenerOnce(): void {
    if (this.listenerInstalled) return;
    this.listenerInstalled = true;

    this.sub.on('message', (channel: string, payload: string) => {
      const set = this.channelSubjects.get(channel);
      if (!set || set.size === 0) return;

      let env: any;
      try {
        env = JSON.parse(payload);
      } catch {
        // Malformed JSON — drop silently
        return;
      }

      // Organisation / team / org-billing channels are decided from the
      // channel name, never by the handler: a project event reaches them as
      // an invalidation only (see broad-scope-envelope.ts).
      const forwarded = isBroadScopeChannel(channel)
        ? toBroadScopeEnvelope(env)
        : env;
      const msg: MessageEvent = {
        data: JSON.stringify(forwarded),
        id: env?.event_id ?? env?.eventId,
      } as MessageEvent;

      for (const subj of set) {
        subj.next(msg);
      }
    });
  }
}
