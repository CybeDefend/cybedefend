import { productFromPath, resolveProduct, type Product } from '@/utils/product';

/**
 * The ways the app can fail, each with its own page in the same family
 * (`AppFailurePage`):
 *
 * - `session`: the sign-in bootstrap gave up (`useAuth().authError`);
 * - `workspace`: signed in, but the profile or the organisation could not be
 *   loaded (App.tsx's `organizationError`, a gateway that answers 503 above all);
 * - `crash`: rendering threw, caught by the root `AppErrorBoundary`. App.tsx
 *   never chooses it.
 */
export type AppFailureVariant = 'session' | 'workspace' | 'crash';

export interface AppFailureState {
  authError: boolean;
  organizationError: string | null;
  isAuthenticated: boolean;
}

/**
 * Which failure page App.tsx shows, if any. The session failure comes first,
 * as it did when App.tsx held the two pages inline: without a session nothing
 * else can load. A workspace failure only counts while the account is signed
 * in; signed out, App.tsx sends it to the sign-in page instead.
 */
export function appFailureVariant({ authError, organizationError, isAuthenticated }: AppFailureState): Exclude<AppFailureVariant, 'crash'> | null {
  if (authError) return 'session';
  if (organizationError && isAuthenticated) return 'workspace';
  return null;
}

/**
 * The product the page stands in, from the addresses it is handed (the shell
 * has not mounted, so no router hook): a space under its prefix, the last
 * product used at the root and on a page common to every space, the Platform
 * when nothing is remembered. `resolveProduct` stays the one rule.
 *
 * `entryPathname` is the address the tab was opened at. A failed profile load
 * leaves the profile without organisations, and App's post-profile effect
 * moves the tab to `/on-boarding` before this page mounts: when the current
 * address belongs to no product, the one the account asked for decides. It is
 * read for the two pages shown at boot (`session`, `workspace`) only: a render
 * crash happens later in the session, when the boot address is out of date,
 * and on a common page it keeps the last product used, as the shell does.
 */
export function appFailureProduct(variant: AppFailureVariant, pathname: string, entryPathname?: string): Product {
  const entry = variant !== 'crash' && entryPathname ? productFromPath(entryPathname) : null;
  return productFromPath(pathname) ?? entry ?? resolveProduct(pathname);
}

/**
 * What each page says. The keys are listed whole (never built), so a search
 * finds them. The page never prints a server's text: these sentences are all
 * it says.
 */
export const APP_FAILURE_COPY: Record<AppFailureVariant, { titleKey: string; messageKey: string }> = {
  session: {
    titleKey: 'components.appFailure.session.title',
    messageKey: 'components.appFailure.session.message',
  },
  workspace: {
    titleKey: 'components.appFailure.workspace.title',
    messageKey: 'components.appFailure.workspace.message',
  },
  crash: {
    titleKey: 'components.appFailure.crash.title',
    messageKey: 'components.appFailure.crash.message',
  },
};
