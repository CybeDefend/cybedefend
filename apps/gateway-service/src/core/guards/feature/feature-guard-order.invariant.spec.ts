import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FEATURE_BY_ROUTE_PARAM } from './feature.decorator';
import { FeatureGuard } from './feature.guard';

/**
 * Guards run in the order of their metadata, class first, and two
 * `@UseGuards` on one target are applied bottom-up, so FeatureGuard, and its
 * gRPC calls, can end up before authentication. No gateway
 * controller may run FeatureGuard before CombinedAuthRateLimitGuard.
 */
const SRC = join(__dirname, '../../..');

const controllerFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'grpc' ? [] : controllerFiles(path);
    }
    return entry.endsWith('.controller.ts') ? [path] : [];
  });

const guardsOf = (target: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

describe('FeatureGuard runs after authentication on every controller', () => {
  const routes: Array<{
    route: string;
    guards: unknown[];
    /** A plan gate is declared: @Feature or @FeatureByRouteParam. */
    planGated: boolean;
  }> = [];

  beforeAll(() => {
    for (const file of controllerFiles(SRC)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported: Record<string, unknown> = require(file);
      for (const candidate of Object.values(exported)) {
        if (
          typeof candidate !== 'function' ||
          Reflect.getMetadata(PATH_METADATA, candidate) === undefined
        ) {
          continue;
        }
        const prototype = candidate.prototype as Record<string, unknown>;
        for (const method of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[method];
          if (
            method === 'constructor' ||
            typeof handler !== 'function' ||
            Reflect.getMetadata(PATH_METADATA, handler) === undefined
          ) {
            continue;
          }
          routes.push({
            route: `${candidate.name}.${method}`,
            guards: [...guardsOf(candidate), ...guardsOf(handler)],
            planGated: [candidate, handler].some(
              (target) =>
                Reflect.getMetadata('feature', target) !== undefined ||
                Reflect.getMetadata(FEATURE_BY_ROUTE_PARAM, target) !==
                  undefined,
            ),
          });
        }
      }
    }
  });

  it('finds the routes gated by FeatureGuard', () => {
    const gated = routes.filter(({ guards }) => guards.includes(FeatureGuard));
    // Not vacuous: the routes gated after their Permify check, plus the
    // Policy and Slack routes, plus the ones gated without a Permify check.
    // The closed routes (the SBOM route and the container registry
    // scan-start routes) are checked with the cloud edition, hence a floor
    // that does not count them.
    expect(gated.length).toBeGreaterThanOrEqual(49);
    expect(gated.map(({ route }) => route)).toEqual(
      expect.arrayContaining([
        'PolicyController.listPolicies',
        'SlackController.getInstallation',
        'ScanController.startContainerScan',
      ]),
    );
  });

  it('runs FeatureGuard on every route that declares a plan gate', () => {
    const ungated = routes
      .filter(({ planGated }) => planGated)
      .filter(({ guards }) => !guards.includes(FeatureGuard))
      .map(({ route }) => route);

    expect(ungated).toEqual([]);
  });

  it('never runs FeatureGuard before CombinedAuthRateLimitGuard', () => {
    const offending = routes
      .filter(({ guards }) => guards.includes(FeatureGuard))
      .filter(({ guards }) => {
        const auth = guards.indexOf(CombinedAuthRateLimitGuard);
        return auth === -1 || auth > guards.indexOf(FeatureGuard);
      })
      .map(({ route }) => route);

    expect(offending).toEqual([]);
  });

  /**
   * On a route that also checks a Permify permission, the plan
   * check comes after it, whether FeatureGuard is declared on the route or on
   * its class: a caller Permify refuses costs no gRPC call (global-management,
   * billing) and never learns whether the organization has the plan. A guard
   * declared on the class runs before a method-level PermissionsGuard.
   */
  it('never runs FeatureGuard before PermissionsGuard', () => {
    const offending = routes
      .filter(({ guards }) => guards.includes(FeatureGuard))
      .filter(({ guards }) => {
        const permissions = guards.indexOf(PermissionsGuard);
        return permissions !== -1 && permissions > guards.indexOf(FeatureGuard);
      })
      .map(({ route }) => route);

    expect(offending).toEqual([]);
  });
});
