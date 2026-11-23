import { MembershipRegistry } from '../membership.registry';

describe('MembershipRegistry', () => {
  let r: MembershipRegistry;
  beforeEach(() => {
    r = new MembershipRegistry();
  });

  it('size starts at 0', () => {
    expect(r.size()).toBe(0);
  });

  it('registers a connection for a user under a scope', () => {
    const close = jest.fn();
    r.register('org:o1', 'u1', 'c1', close);
    expect(r.size()).toBe(1);
  });

  it('kick() invokes close for matching user under matching scope only', () => {
    const closeA = jest.fn();
    const closeB = jest.fn();
    const closeC = jest.fn();
    r.register('org:o1', 'u1', 'c1', closeA);
    r.register('org:o1', 'u2', 'c2', closeB);
    r.register('org:o2', 'u1', 'c3', closeC);
    r.kick({ userId: 'u1', scopeType: 'organization', scopeId: 'o1' });
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect(closeC).not.toHaveBeenCalled();
  });

  it('kick() handles project and team scopeTypes correctly', () => {
    const closeP = jest.fn();
    const closeT = jest.fn();
    r.register('project:p1', 'u1', 'c1', closeP);
    r.register('team:t1', 'u1', 'c2', closeT);
    r.kick({ userId: 'u1', scopeType: 'project', scopeId: 'p1' });
    expect(closeP).toHaveBeenCalled();
    expect(closeT).not.toHaveBeenCalled();
  });

  it('multiple connections from the same user under the same scope are all kicked', () => {
    const c1 = jest.fn();
    const c2 = jest.fn();
    r.register('org:o', 'u', 'c1', c1);
    r.register('org:o', 'u', 'c2', c2);
    r.kick({ userId: 'u', scopeType: 'organization', scopeId: 'o' });
    expect(c1).toHaveBeenCalled();
    expect(c2).toHaveBeenCalled();
  });

  it('unregister removes a connection so kick no longer affects it', () => {
    const close = jest.fn();
    r.register('org:o', 'u', 'c', close);
    r.unregister('org:o', 'u', 'c');
    r.kick({ userId: 'u', scopeType: 'organization', scopeId: 'o' });
    expect(close).not.toHaveBeenCalled();
  });

  it('size decrements after unregister', () => {
    r.register('org:o', 'u1', 'c1', () => {});
    r.register('org:o', 'u2', 'c2', () => {});
    expect(r.size()).toBe(2);
    r.unregister('org:o', 'u1', 'c1');
    expect(r.size()).toBe(1);
  });

  it('kick is idempotent (no error if no matching connections)', () => {
    expect(() =>
      r.kick({
        userId: 'nobody',
        scopeType: 'organization',
        scopeId: 'nothing',
      }),
    ).not.toThrow();
  });

  it('handles unknown scopeType gracefully (no-op)', () => {
    const close = jest.fn();
    r.register('org:o', 'u', 'c', close);
    r.kick({ userId: 'u', scopeType: 'weird' as any, scopeId: 'o' });
    expect(close).not.toHaveBeenCalled();
  });
});
