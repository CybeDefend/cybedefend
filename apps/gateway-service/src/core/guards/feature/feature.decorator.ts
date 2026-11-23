import { SetMetadata } from '@nestjs/common';

/**
 * Mark a handler as requiring a specific feature to be enabled for the
 * organization.  Used together with `FeatureGuard`.
 *
 * Allowed feature keys (matches `featuresDisabled` csv on the subscription):
 *   policies | reports | sbom | issues | container_scanning |
 *   ai-bom | eu-ai-act
 */
export const Feature = (feature: string) => SetMetadata('feature', feature);

/** Metadata key read by `FeatureGuard` for `@FeatureByRouteParam`. */
export const FEATURE_BY_ROUTE_PARAM = 'featureByRouteParam';

export interface FeatureByRouteParamConfig {
  /** Name of the route param carrying the family (e.g. `scanner`). */
  param: string;
  /** Lower-cased param value → feature key. Values absent from the map are not gated. */
  map: Record<string, string>;
}

/**
 * Plan-gate a MULTIPLEXED route from the value of one of its params.
 *
 * `@Feature()` is static: one handler, one feature. A route such as
 * `/mcp/project/:projectId/results/:scanner` serves every finding family from
 * one handler, and only some families are plan-gated (`container` is Team+,
 * `sast` is in every plan). `FeatureGuard` resolves the feature at request
 * time from `map[params[param].toLowerCase()]`; a value absent from the map
 * skips the plan check, so families included in every plan stay open.
 *
 * Usage:
 * ```ts
 * @FeatureByRouteParam('scanner', { container: 'container_scanning' })
 * @UseGuards(FeatureGuard, PermissionsGuard)
 * ```
 */
export const FeatureByRouteParam = (
  param: string,
  map: Record<string, string>,
) =>
  SetMetadata<string, FeatureByRouteParamConfig>(FEATURE_BY_ROUTE_PARAM, {
    param,
    map,
  });
