import { Inject, Injectable, Logger, MessageEvent } from '@nestjs/common';
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

export interface CreateStreamInput {
  channels: string[];
  membershipScope?: { scopeKey: string; userId: string };
  request: any; // Fastify req — needs req.raw.on('close'), req.user.exp, req.user.sub
  lastEventId?: string | null; // ignored for now (Phase 2)
}

const HEARTBEAT_MS = 20_000;
const AUTH_REFRESH_LEAD_MS = 60_000;

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

    // ── 4. JWT expiry timers ────────────────────────────────────────────────
    const exp = input.request?.user?.exp ? input.request.user.exp * 1000 : null;
    if (exp !== null) {
      const now = Date.now();
      const warnIn = exp - AUTH_REFRESH_LEAD_MS - now;
      const closeIn = exp - now;
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
      if (closeIn > 0) {
        timers.push(
          setTimeout(() => {
            disconnect$.next();
          }, closeIn),
        );
      }
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
        // Clear all scheduled timers
        for (const t of timers) clearTimeout(t);

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
