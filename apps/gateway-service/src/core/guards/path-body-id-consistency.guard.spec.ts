import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { PathBodyIdConsistencyGuard } from './path-body-id-consistency.guard';

function makeCtx(params: Record<string, any>, body: any): ExecutionContext {
  const req = { params, body };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('PathBodyIdConsistencyGuard', () => {
  let guard: PathBodyIdConsistencyGuard;

  beforeEach(() => {
    guard = new PathBodyIdConsistencyGuard();
  });

  it('allows when body has no id fields', () => {
    const ctx = makeCtx(
      { projectId: 'abc' },
      { vulnerabilityId: 'v1', branch: 'main' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when body is missing entirely', () => {
    const ctx = makeCtx({ projectId: 'abc' }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when body has projectId equal to path projectId', () => {
    const ctx = makeCtx(
      { projectId: 'abc' },
      { projectId: 'abc', message: 'hi' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws BadRequestException when body.projectId differs from path :projectId', () => {
    const ctx = makeCtx({ projectId: 'path-id' }, { projectId: 'other-id' });
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
    expect(() => guard.canActivate(ctx)).toThrow(/path\/body id mismatch/);
  });

  it('throws BadRequestException when body.organizationId differs from path :organizationId', () => {
    const ctx = makeCtx(
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when body.teamId differs from path :teamId', () => {
    const ctx = makeCtx({ teamId: 't-1' }, { teamId: 't-2' });
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
  });

  it('allows when body id matches path id for organization', () => {
    const ctx = makeCtx(
      { organizationId: 'org-1' },
      { organizationId: 'org-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('checks all known id keys (projectId, organizationId, teamId) independently', () => {
    // body has projectId but path does NOT — body field should be ignored when no path counterpart
    const ctx = makeCtx({}, { projectId: 'other-id' });
    // Without a corresponding path id we can't compare; allow (the route is not bound to a project param).
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects mismatch even if other id fields match', () => {
    const ctx = makeCtx(
      { projectId: 'p1', organizationId: 'o1' },
      { projectId: 'p1', organizationId: 'o2' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
  });

  it('allows when body has projectId set to empty string and path is missing it', () => {
    // Empty / falsy body id with no path counterpart should not throw
    const ctx = makeCtx({}, { projectId: '' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when body has projectId set to empty string but path projectId exists', () => {
    // An empty body id while the path has a real id is still a mismatch — block to avoid downstream falsy bypass.
    const ctx = makeCtx({ projectId: 'p1' }, { projectId: '' });
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
  });
});
