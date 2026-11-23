import { Injectable } from '@nestjs/common';

type CloseFn = () => void;

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

  size(): number {
    return this.total;
  }
}
