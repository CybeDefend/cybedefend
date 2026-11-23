import { FeatureGuard } from './feature.guard';
import { ProjectOrgResolver } from 'src/core/project-org/project-org-resolver.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import type { EntitlementsPort } from 'src/edition/ports/entitlements.port';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: jest.Mocked<Reflector>;
  let entitlements: jest.Mocked<EntitlementsPort>;
  let gmGrpc: any;
  let orgClient: any;
  let userClient: any;

  const makeContext = (
    params: Record<string, string> = {},
    user: any = { sub: 'user-1' },
  ): ExecutionContext => {
    const req = { params, user };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = {
      get: jest.fn(),
    } as any;

    entitlements = {
      checkFeatureAccess: jest.fn(),
      isWritable: jest.fn(),
      hasFeature: jest.fn(),
    };
    orgClient = {
      getOrganizationIdByProjectId: jest.fn(),
      getOrganizationIdByTeamId: jest.fn(),
    };
    userClient = {
      getUserProfile: jest.fn(),
    };

    gmGrpc = {
      getService: jest.fn((name: string) => {
        if (name.includes('Organization')) return orgClient;
        return userClient;
      }),
    };

    guard = new FeatureGuard(
      reflector,
      entitlements,
      gmGrpc,
      new ProjectOrgResolver(gmGrpc),
    );
    guard.onModuleInit();
  });

  // ──────────────────────────────────────────────────────────────
  // No @Feature decorator → skip
  // ──────────────────────────────────────────────────────────────
  it('allows when no @Feature() decorator is present', async () => {
    reflector.get.mockReturnValue(undefined);
    const ctx = makeContext({ organizationId: 'org-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // Strategy 1: organizationId in route params
  // ──────────────────────────────────────────────────────────────
  describe('Strategy 1 — organizationId in params', () => {
    it('allows when feature is enabled', async () => {
      reflector.get
        .mockReturnValueOnce('policies')
        .mockReturnValueOnce(undefined);
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-1',
        'policies',
      );
    });

    it('throws ForbiddenException when feature is disabled', async () => {
      reflector.get
        .mockReturnValueOnce('policies')
        .mockReturnValueOnce(undefined);
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'pro',
      });
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('includes required plan in error message', async () => {
      reflector.get
        .mockReturnValueOnce('container_scanning')
        .mockReturnValueOnce(undefined);
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'enterprise',
      });
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(/Enterprise/);
    });

    // The plan named is billing's, by its
    // display name, never a hard-coded `pro` nor a raw key such as `team_v3`.
    it.each([
      ['team_v3', 'Team'],
      ['pro_v3', 'Pro'],
      ['enterprise', 'Enterprise'],
    ])('names requiredPlan %p as %p', async (requiredPlan, name) => {
      reflector.get
        .mockReturnValueOnce('policies')
        .mockReturnValueOnce(undefined);
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan,
      });
      const ctx = makeContext({ organizationId: 'org-1' });
      const err = await guard.canActivate(ctx).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain(`Upgrade to ${name} or higher`);
      expect(err.message).not.toMatch(/_v3/);
    });

    it.each(['', 'bogus'])(
      'names no plan when billing names none it knows (%p)',
      async (requiredPlan) => {
        reflector.get
          .mockReturnValueOnce('policies')
          .mockReturnValueOnce(undefined);
        entitlements.checkFeatureAccess.mockResolvedValue({
          allowed: false,
          requiredPlan,
        });
        const ctx = makeContext({ organizationId: 'org-1' });
        const err = await guard.canActivate(ctx).catch((e) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.message).toMatch(/not available on your current plan/);
        expect(err.message).not.toMatch(/\bpro\b|bogus/i);
      },
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Strategy 2: projectId → resolve org
  // ──────────────────────────────────────────────────────────────
  describe('Strategy 2 — projectId resolves to orgId', () => {
    it('resolves org from projectId then checks feature', async () => {
      reflector.get
        .mockReturnValueOnce('reports')
        .mockReturnValueOnce(undefined);
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        of({ organizationId: 'org-from-project' }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
      const ctx = makeContext({ projectId: 'proj-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // The lookup now carries the trace context as gRPC metadata.
      expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledWith(
        { projectId: 'proj-1' },
        expect.anything(),
      );
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-from-project',
        'reports',
      );
    });

    it('blocks when feature is disabled for the resolved org', async () => {
      reflector.get.mockReturnValueOnce('sbom').mockReturnValueOnce(undefined);
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        of({ organizationId: 'org-dev' }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'pro',
      });
      const ctx = makeContext({ projectId: 'proj-1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('falls through to strategy 3 if getOrganizationIdByProjectId fails', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        throwError(() => new Error('NOT_FOUND')),
      );
      // Strategy 3: user profile lookup
      userClient.getUserProfile.mockReturnValue(
        of({
          myOrganizations: [{ id: 'org-user' }],
        }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
      const ctx = makeContext({ projectId: 'proj-1' }, { sub: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Strategy 3: user-scoped — union model
  // ──────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────
  // A /team/:teamId/* route resolves the team's own organization: a plan
  // held by another organization of the user never unlocks the feature in
  // this team.
  // ──────────────────────────────────────────────────────────────
  describe("Strategy 3 — teamId resolves to the team's organization", () => {
    beforeEach(() => {
      reflector.get
        .mockReturnValueOnce('reports')
        .mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        of({ myOrganizations: [{ id: 'org-paying' }, { id: 'org-of-team' }] }),
      );
    });

    it("allows when the team's organization has the feature", async () => {
      orgClient.getOrganizationIdByTeamId.mockReturnValue(
        of({ organizationId: 'org-of-team' }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });

      await expect(
        guard.canActivate(makeContext({ teamId: 'team-1' })),
      ).resolves.toBe(true);
      expect(orgClient.getOrganizationIdByTeamId).toHaveBeenCalledWith({
        teamId: 'team-1',
      });
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-of-team',
        'reports',
      );
    });

    it("refuses when the team's organization lacks the feature, even if another organization of the user has it", async () => {
      orgClient.getOrganizationIdByTeamId.mockReturnValue(
        of({ organizationId: 'org-of-team' }),
      );
      entitlements.checkFeatureAccess.mockImplementation(
        (organizationId: string) =>
          Promise.resolve({
            allowed: organizationId === 'org-paying',
            requiredPlan: 'pro',
          }),
      );

      await expect(
        guard.canActivate(makeContext({ teamId: 'team-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(entitlements.checkFeatureAccess).not.toHaveBeenCalledWith(
        'org-paying',
        expect.anything(),
      );
    });

    it("refuses when the team's organization cannot be resolved, without trying the user's organizations", async () => {
      orgClient.getOrganizationIdByTeamId.mockReturnValue(
        throwError(() => new Error('5 NOT_FOUND: Team not found')),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });

      await expect(
        guard.canActivate(makeContext({ teamId: 'team-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
    });
  });

  describe('Strategy 4 — user-scoped union model', () => {
    it('allows if any user org allows the feature', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        of({
          myOrganizations: [{ id: 'org-dev' }, { id: 'org-pro' }],
        }),
      );
      // First org denies, second allows
      entitlements.checkFeatureAccess
        .mockResolvedValueOnce({ allowed: false, requiredPlan: 'pro' })
        .mockResolvedValueOnce({ allowed: true });
      const ctx = makeContext({}, { sub: 'user-1' }); // no orgId or projectId
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('denies if ALL user orgs deny the feature', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        of({
          myOrganizations: [{ id: 'org-dev1' }, { id: 'org-dev2' }],
        }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'pro',
      });
      const ctx = makeContext({}, { sub: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("names billing's required plan when every org denies", async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        of({
          myOrganizations: [{ id: 'org-a' }, { id: 'org-b' }],
        }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'team_v3',
      });
      const err = await guard
        .canActivate(makeContext({}, { sub: 'user-1' }))
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain('Upgrade to Team or higher');
      expect(err.message).not.toMatch(/\bpro\b/i);
    });

    it('names no plan when every org denies without one', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        of({
          myOrganizations: [{ id: 'org-a' }],
        }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: '',
      });
      const err = await guard
        .canActivate(makeContext({}, { sub: 'user-1' }))
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).not.toMatch(/\bpro\b/i);
    });

    it('allows if user has no orgs (fail-open)', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(of({ myOrganizations: [] }));
      const ctx = makeContext({}, { sub: 'user-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws ForbiddenException if getUserProfile throws', async () => {
      reflector.get.mockReturnValueOnce('pat').mockReturnValueOnce(undefined);
      userClient.getUserProfile.mockReturnValue(
        throwError(() => new Error('gRPC error')),
      );
      const ctx = makeContext({}, { sub: 'user-1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('throws ForbiddenException when no user and no params', async () => {
      reflector.get
        .mockReturnValueOnce('policies')
        .mockReturnValueOnce(undefined);
      const ctx = makeContext({}, undefined);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when billing gRPC throws unexpected error', async () => {
      reflector.get
        .mockReturnValueOnce('reports')
        .mockReturnValueOnce(undefined);
      entitlements.checkFeatureAccess.mockRejectedValue(
        new Error('Billing service unavailable'),
      );
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('reads @Feature from class when not on handler', async () => {
      // First call (handler) returns undefined, second call (class) returns 'policies'
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce('policies');
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Feature resolved from a route param (multiplexed routes)
  // ──────────────────────────────────────────────────────────────
  describe('@FeatureByRouteParam — feature resolved from a route param', () => {
    const byParam = {
      param: 'scanner',
      map: { container: 'container_scanning' },
    };
    // reflector.get call order: 'feature' on handler, 'feature' on class,
    // then 'featureByRouteParam' on the handler.
    const mockNoStaticFeature = () =>
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(byParam);

    it('checks the mapped feature when the param value is in the map', async () => {
      mockNoStaticFeature();
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'team',
      });
      const ctx = makeContext({
        organizationId: 'org-1',
        scanner: 'container',
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-1',
        'container_scanning',
      );
    });

    it('matches the param value case-insensitively', async () => {
      mockNoStaticFeature();
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
      const ctx = makeContext({
        organizationId: 'org-1',
        scanner: 'Container',
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-1',
        'container_scanning',
      );
    });

    it('skips the plan check when the param value is not in the map (sast is in every plan)', async () => {
      mockNoStaticFeature();
      const ctx = makeContext({ organizationId: 'org-1', scanner: 'sast' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
    });

    it('skips the plan check when the param is absent from the request', async () => {
      mockNoStaticFeature();
      const ctx = makeContext({ organizationId: 'org-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
    });
  });
});
