import {
  Building,
  FileAlt,
  Home,
  ShieldHalved,
  WandMagicSparkles,
} from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';
import type React from 'react';
import { appsecPath, productHome } from '@/utils/product';

/** Any icon from the registry. */
export type IconComponent = React.ComponentType<IconProps>;

/**
 * One icon per destination, named once.
 *
 * The sidebar and each page header used to choose their own: the dashboard was
 * a house at the top of the page and a branching diagram in the rail, and
 * Security Reports was a document in the rail but a shield in the header —
 * which also said the wrong thing, since a shield is what Security *Policies*
 * are. Two independent lists could not stay in step, so there is now one.
 *
 * Keyed by route, because the route is what the user is actually navigating to.
 * The AppSec destinations live under its prefix; the policies are a common
 * settings page and keep theirs.
 */
export const DESTINATION_ICONS: Record<string, IconComponent> = {
  [productHome('appsec')]: Home,
  [appsecPath('/organization/overview')]: Building,
  [appsecPath('/autofix')]: WandMagicSparkles,
  [appsecPath('/reports')]: FileAlt,
  '/organization/settings/policies': ShieldHalved,
};

/**
 * The glyph of a destination. A route named without the AppSec prefix (a
 * caller written before AppSec had one) is read as the AppSec page it
 * redirects to; a route with no entry gets the dashboard glyph.
 */
export const destinationIcon = (route: string): IconComponent =>
  DESTINATION_ICONS[route] ?? DESTINATION_ICONS[appsecPath(route)] ?? Home;
