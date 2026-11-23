import { APPSEC, productFromPath, spaceOf, type Product } from '@/utils/product';

/** The space the full-page loader stands in: a product's, or none (the root, a page common to every space). */
export type LoaderSpace = Product | 'cybedefend';

/**
 * The mark the full-page loader draws: the space's own when it registers one,
 * the CybeDefend eye everywhere else. The Platform has no mark of its own:
 * it draws the eye, as the root does.
 */
export type LoaderMark = Product | 'cybedefend';

/**
 * Which space, from the address. The loader can render before the router
 * exists (App.tsx, the sign-in callback), so the caller hands it
 * `window.location.pathname`; `productFromPath` stays the one rule.
 */
export function loaderSpaceFor(pathname: string): LoaderSpace {
  return productFromPath(pathname) ?? 'cybedefend';
}

/** Which mark, from the address: the space's own when it registers one, the house eye otherwise. */
export function loaderMarkFor(pathname: string): LoaderMark {
  const space = loaderSpaceFor(pathname);
  return space !== 'cybedefend' && spaceOf(space).Mark ? space : 'cybedefend';
}

/**
 * What the status line says, in order: what the space is busy with while the
 * app gets ready. The keys are listed whole (never built), so a search finds
 * them. A registered space carries its own list; AppSec and the house (no
 * space) keep the core's.
 */
const HOUSE_STATUS_KEYS: readonly string[] = [
  'components.loaderHome.status.cybedefend.session',
  'components.loaderHome.status.cybedefend.workspace',
  'components.loaderHome.status.cybedefend.agents',
];
const APPSEC_STATUS_KEYS: readonly string[] = [
  'components.loaderHome.status.appsec.projects',
  'components.loaderHome.status.appsec.scans',
  'components.loaderHome.status.appsec.findings',
  'components.loaderHome.status.appsec.overview',
];

export function loaderStatusKeys(space: LoaderSpace): readonly string[] {
  if (space === 'cybedefend') return HOUSE_STATUS_KEYS;
  return spaceOf(space).loaderStatusKeys ?? APPSEC_STATUS_KEYS;
}

/**
 * Whether the loader shows its dark face. At app start nothing has put the
 * remembered theme (`localStorage.theme`) on `<html>` yet — the shell does it
 * when it mounts — so the loader reads it too, and wears it on its own root:
 * a dark-theme viewer sees no white page before the app, and the document is
 * left to the shell.
 */
export function loaderThemeIsDark(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return true;
  try {
    return localStorage.getItem('theme') === 'dark';
  } catch {
    return false;
  }
}
