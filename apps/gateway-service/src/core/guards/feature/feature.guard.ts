import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from 'src/edition/ports/entitlements.port';
import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import { OrganizationGetIdByTeamIdResponse } from '@grpc/global-management/organization';
import { GetUserProfileResponse } from '@grpc/global-management/user';
import { Span } from 'nestjs-otel';
import { ProjectOrgResolver } from 'src/core/project-org/project-org-resolver.service';
import {
  FEATURE_BY_ROUTE_PARAM,
  FeatureByRouteParamConfig,
} from './feature.decorator';

/**
 * Guard that checks whether a feature is enabled for the organisation.
 *
 * Resolution strategy (tried in order):
 * 1. `organizationId` from route params   → direct entitlements check
 * 2. `projectId` from route params        → resolve org via ProjectOrgResolver
 *    (global-management, kept in memory: the link never changes), then
 *    entitlements check
 * 3. `teamId` from route params           → resolve the team's org via
 *    global-management, then entitlements check. A team whose org cannot be
 *    resolved is refused: never the union below.
 * 4. Authenticated user (`req.user.sub`)  → fetch user profile, check ALL orgs.
 *    Access is granted if **any** org allows the feature (union model). Only
 *    for routes tied to the user alone.
 *
 * If none of the above yields an org the check is skipped (fail-open).
 *
 * Usage:
 * ```ts
 * @Feature('policies')
 * @UseGuards(FeatureGuard)
 * ```
 */
@Injectable()
export class FeatureGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(FeatureGuard.name);
  private orgClient!: OrganizationServiceClient;
  private userClient!: UserServiceClient;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly gmGrpc: ClientGrpc,
    private readonly projectOrg: ProjectOrgResolver,
  ) {}

  onModuleInit() {
    this.orgClient = this.gmGrpc.getService<OrganizationServiceClient>(
      ORGANIZATION_SERVICE_NAME,
    );
    this.userClient =
      this.gmGrpc.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  @Span()
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const feature =
      this.reflector.get<string>('feature', context.getHandler()) ||
      this.reflector.get<string>('feature', context.getClass()) ||
      this.resolveFeatureFromRouteParam(context, request);
    if (!feature) return true; // no @Feature() / no gated param value → skip

    try {
      // ── Strategy 1: organizationId in route params ──────────────
      let organizationId: string | undefined = request.params?.organizationId;

      // ── Strategy 2: resolve org from projectId ──────────────────
      if (!organizationId && request.params?.projectId) {
        try {
          organizationId =
            (await this.projectOrg.resolve(request.params.projectId)) ??
            undefined;
        } catch {
          // Cannot resolve → will try strategy 3 or skip
        }
      }

      // ── Strategy 3: resolve org from teamId ─────────────────────
      if (!organizationId && request.params?.teamId) {
        try {
          const res: OrganizationGetIdByTeamIdResponse =
            await firstValueFrom<OrganizationGetIdByTeamIdResponse>(
              this.orgClient.getOrganizationIdByTeamId({
                teamId: request.params.teamId,
              }) as any,
            );
          organizationId = res?.organizationId;
        } catch {
          // Cannot resolve → refused below
        }
        if (!organizationId) {
          this.logger.warn(
            `FeatureGuard: cannot resolve the team's org for feature=${feature} — blocking request`,
          );
          throw new ForbiddenException(
            `This feature (${feature}) is not available — unable to verify plan.`,
          );
        }
      }

      // ── Strategy 4: user-scoped — check all user orgs ──────────
      if (!organizationId && request.user?.sub) {
        return await this.checkAnyUserOrg(request.user.sub, feature);
      }

      if (!organizationId) {
        this.logger.warn(
          `FeatureGuard: cannot determine org for feature=${feature} — blocking request`,
        );
        throw new ForbiddenException(
          `This feature (${feature}) is not available — unable to verify plan.`,
        );
      }

      return await this.checkOrgFeature(organizationId, feature);
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(`FeatureGuard: check failed feature=${feature}: ${err}`);
      throw new ForbiddenException(
        `This feature (${feature}) is temporarily unavailable. Please try again later.`,
      );
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * `@FeatureByRouteParam(param, map)` on a multiplexed route —
   * the feature to check is `map[params[param]]`. A param value absent from
   * the map (or a missing param) means "this family is in every plan": no
   * feature, no check.
   */
  private resolveFeatureFromRouteParam(
    context: ExecutionContext,
    request: { params?: Record<string, string> },
  ): string | undefined {
    const config = this.reflector.get<FeatureByRouteParamConfig | undefined>(
      FEATURE_BY_ROUTE_PARAM,
      context.getHandler(),
    );
    if (!config) return undefined;
    const value = request.params?.[config.param];
    if (typeof value !== 'string') return undefined;
    return config.map[value.toLowerCase()];
  }

  /** Check a single org for the feature — throws on deny. */
  private async checkOrgFeature(
    organizationId: string,
    feature: string,
  ): Promise<boolean> {
    const resp = await this.entitlements.checkFeatureAccess(
      organizationId,
      feature,
    );

    if (resp?.allowed) return true;

    throw new ForbiddenException(planDenial(feature, resp?.requiredPlan));
  }

  /**
   * For user-scoped routes (no orgId / projectId in params):
   * fetch the user's orgs and grant access if ANY org allows the feature.
   */
  private async checkAnyUserOrg(
    userId: string,
    feature: string,
  ): Promise<boolean> {
    try {
      const profile: GetUserProfileResponse =
        await firstValueFrom<GetUserProfileResponse>(
          this.userClient.getUserProfile({ userId }) as any,
        );
      const orgs = profile?.myOrganizations || [];

      if (orgs.length === 0) return true; // no org → skip

      let requiredPlan = '';
      for (const org of orgs) {
        try {
          const resp = await this.entitlements.checkFeatureAccess(
            org.id,
            feature,
          );
          if (resp?.allowed) return true; // at least one org allows → OK
          requiredPlan ||= resp?.requiredPlan ?? '';
        } catch {
          // entitlements call failed for this org → skip, try next
        }
      }

      // All orgs deny the feature
      throw new ForbiddenException(planDenial(feature, requiredPlan));
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(
        `FeatureGuard: user org lookup failed user=${userId} feature=${feature}: ${err}`,
      );
      throw new ForbiddenException(
        `This feature (${feature}) is temporarily unavailable. Please try again later.`,
      );
    }
  }
}

/**
 * Display names of the plans billing may answer as `requiredPlan` (closed
 * extension), current and older keys alike. A raw key is never printed.
 */
const PLAN_DISPLAY_NAMES: Record<string, string> = {
  pro_v3: 'Pro',
  team_v3: 'Team',
  enterprise: 'Enterprise',
  developer: 'Developer',
  pro: 'Pro',
  team: 'Team',
  scale: 'Scale',
};

/**
 * The refusal of a feature the plan does not include. It names the plan
 * billing requires (`CheckFeatureAccess.requiredPlan`), and no plan when
 * billing names none it knows: never a guess.
 */
function planDenial(feature: string, requiredPlan?: string): string {
  const name = Object.prototype.hasOwnProperty.call(
    PLAN_DISPLAY_NAMES,
    requiredPlan ?? '',
  )
    ? PLAN_DISPLAY_NAMES[requiredPlan as string]
    : undefined;
  return (
    `This feature (${feature}) is not available on your current plan. ` +
    (name
      ? `Upgrade to ${name} or higher to unlock it.`
      : 'Upgrade your plan to unlock it.')
  );
}
