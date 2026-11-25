import { Injectable } from '@nestjs/common';

type CloseFn = () => void;
type RecheckFn = () => void;

interface KickEvent {
  userId: string;
  scopeType: 'organization' | 'team' | 'project';
  scopeId: string;
}

const SCOPE_TYPE_TO_PREFIX: Record<string, string> = {
  organization: 'org',
  team: 'team',
  project: 'project',
};

@Injectable()
export class MembershipRegistry {
  // scopeKey -> userId -> Map<connectionId, closeFn>
  private byScope = new Map<string, Map<string, Map<string, CloseFn>>>();
  // userId -> Map<connectionId, recheckFn>
  private rechecksByUser = new Map<string, Map<string, RecheckFn>>();
  private total = 0;

  register(
    scopeKey: string,
    userId: string,
    connectionId: string,
    close: CloseFn,
  ): void {
    const userMap = this.byScope.get(scopeKey) ?? new Map();
    const connMap = userMap.get(userId) ?? new Map();
    if (!connMap.has(connectionId)) this.total++;
    connMap.set(connectionId, close);
    userMap.set(userId, connMap);
    this.byScope.set(scopeKey, userMap);
  }

  unregister(scopeKey: string, userId: string, connectionId: string): void {
    const userMap = this.byScope.get(scopeKey);
    if (!userMap) return;
    const connMap = userMap.get(userId);
    if (!connMap) return;
    if (connMap.delete(connectionId)) this.total--;
    if (connMap.size === 0) userMap.delete(userId);
    if (userMap.size === 0) this.byScope.delete(scopeKey);
  }

  kick(event: KickEvent): void {
    const prefix = SCOPE_TYPE_TO_PREFIX[event.scopeType];
    if (!prefix) return;
    const scopeKey = `${prefix}:${event.scopeId}`;
    const userMap = this.byScope.get(scopeKey);
    if (!userMap) return;
    const connMap = userMap.get(event.userId);
    if (!connMap) return;
    for (const closeFn of connMap.values()) {
      try {
        closeFn();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Registers how to re-check one of the user's open streams. A membership
   * change of the user re-checks every one of them, whatever their scope: a
   * removal from a team or an organization is published on that scope, while
   * the stream that loses its access may be a project's.
   */
  registerRecheck(
    userId: string,
    connectionId: string,
    recheck: RecheckFn,
  ): void {
    const connMap = this.rechecksByUser.get(userId) ?? new Map();
    connMap.set(connectionId, recheck);
    this.rechecksByUser.set(userId, connMap);
  }

  unregisterRecheck(userId: string, connectionId: string): void {
    const connMap = this.rechecksByUser.get(userId);
    if (!connMap) return;
    connMap.delete(connectionId);
    if (connMap.size === 0) this.rechecksByUser.delete(userId);
  }

  /** Re-checks every open stream of the user. */
  recheckUser(userId: string): void {
    const connMap = this.rechecksByUser.get(userId);
    if (!connMap) return;
    for (const recheck of [...connMap.values()]) {
      try {
        recheck();
      } catch {
        /* ignore */
      }
    }
  }

  size(): number {
    return this.total;
  }
}
