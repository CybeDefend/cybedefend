import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import type { EeProductId } from '@/edition/ee-entry';
import type { ProductSpace } from '@/edition/extensions';
import { shortDigest } from './shortDigest';

/**
 * The single owner of « which product is this ».
 *
 * The dashboard has one product space per edition entry: the core's own AppSec
 * space, plus the spaces the closed tree registers through
 * `ACTIVE_EXTENSIONS.products`. The URL decides which one a page belongs to;
 * the sidebar, the project tabs, the breadcrumb and the header all read it from
 * here instead of each holding its own rule.
 *
 * Each product lives under its own prefix (`/appsec`, …), read from the
 * registry. The root `/` is no page: it sends the account to the home of a
 * product. Pages common to every space stay unprefixed. A former AppSec URL
 * (`/project/:id/sast`, `/autofix`, …) is redirected to its `/appsec` form,
 * and belongs to AppSec for the one commit of that redirect.
 */
export type Product = 'appsec' | EeProductId;

/** The core's own product. */
export const APPSEC: Product = 'appsec';

/** The core's own product space. */
const APPSEC_SPACE: ProductSpace = {
  id: 'appsec',
  prefix: '/appsec',
  order: 10,
  labelKey: 'components.productSwitch.appsec',
};

/** Every product space of the active edition: the registered ones plus AppSec, sorted by display order. */
export const PRODUCT_SPACES: readonly ProductSpace[] = [...ACTIVE_EXTENSIONS.products, APPSEC_SPACE].sort(
  (a, b) => a.order - b.order,
);

/** The product ids, in display order (the order of the switch). */
export const PRODUCTS: readonly Product[] = PRODUCT_SPACES.map((space) => space.id as Product);

/** The space of a product; AppSec's own when the id is not registered. */
export function spaceOf(product: Product): ProductSpace {
  return PRODUCT_SPACES.find((space) => space.id === product) ?? APPSEC_SPACE;
}

type MaybeReady = { ready?: () => Promise<void> };

/**
 * Loads every component of the registered spaces that loads on demand (a
 * component with `ready()`), the wizard's steps
 * included, so it renders at once. The boot loads them; a test that renders a
 * core page in a registered space awaits it before its first render.
 */
export async function readyProductSpaces(): Promise<void> {
  const loads: Array<Promise<void> | undefined> = [];
  for (const space of PRODUCT_SPACES) {
    for (const value of Object.values(space)) {
      if (typeof value === 'function') loads.push((value as MaybeReady).ready?.());
    }
    for (const step of space.createProjectSteps ?? []) loads.push((step.Component as MaybeReady).ready?.());
  }
  await Promise.all(loads);
}

export const APPSEC_PREFIX = APPSEC_SPACE.prefix;
export const LAST_PRODUCT_KEY = 'cybedefend.lastProduct';
export const NEXT_START_KEY = 'cybedefend.nextStart';
/** The page of an organisation with no active product (`NoProductPage`). */
export const NO_PRODUCT_PATH = '/products';

/** Pages shared by every space: the product shown there is the last one used. */
const COMMON_PREFIXES = [
  '/organization/settings',
  '/profile',
  '/subscription-expired',
  '/on-boarding',
  '/logout',
  // An organisation with no active product: the product question, or « ask an administrator ».
  NO_PRODUCT_PATH,
];
/** AppSec pages that happen to sit under a common prefix. */
const APPSEC_UNDER_COMMON = ['/organization/settings/policies'];

const hasPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const isProduct = (value: unknown): value is Product =>
  typeof value === 'string' && PRODUCTS.includes(value as Product);

/** The product a path belongs to, or null for a page common to every space. */
export function productFromPath(pathname: string): Product | null {
  for (const space of PRODUCT_SPACES) {
    if (hasPrefix(pathname, space.prefix)) return space.id as Product;
  }
  // The root only sends the account somewhere.
  if (pathname === '/') return null;
  if (APPSEC_UNDER_COMMON.some((prefix) => hasPrefix(pathname, prefix))) return APPSEC;
  if (COMMON_PREFIXES.some((prefix) => hasPrefix(pathname, prefix))) return null;
  // A bare top-level segment no space owns: with a single space it belongs to
  // no product (the other spaces' homes are not pages of this edition);
  // otherwise it is a former AppSec URL, AppSec for the one commit of its redirect.
  if (PRODUCTS.length === 1 && /^\/[^/]+$/.test(pathname)) return null;
  return APPSEC;
}

/** A convenience, never the source of truth: storage can be empty or blocked. */
export function readLastProduct(): Product | null {
  try {
    const value = localStorage.getItem(LAST_PRODUCT_KEY);
    return isProduct(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastProduct(product: Product): void {
  try {
    localStorage.setItem(LAST_PRODUCT_KEY, product);
  } catch {
    // Storage unavailable (private window, blocked site data): the URL still decides.
  }
}

/**
 * The space an answered question promised an account for its next landing,
 * when it was not moved there at once. It outranks the last product used, for
 * one landing of that account.
 *
 * Stored as `<product>:<digest of the account id>`: nothing clears this
 * browser at sign-out, so one account's answer must not decide where the next
 * one lands, and the account id itself must not stay behind. The stored value
 * is writable by anything running on the page: it is never parsed, only
 * compared, whole, with the value this account would have written for each of
 * the registered products.
 */

/** A binding, not a secret: it only has to tell two accounts of one browser apart, and a collision costs one landing. */
const nextStartValue = (product: Product, userId: string): string =>
  `${product}:${shortDigest(userId)}`;

/** Nothing is written without an account to promise it to. */
export function writeNextStart(product: Product, userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem(NEXT_START_KEY, nextStartValue(product, userId));
  } catch {
    // Storage unavailable: the next landing follows the usual rule.
  }
}

/**
 * The start promised to this account, removed as it is read. Anything else
 * found there — another account's, an older form, a malformed value — is
 * removed too and gives nothing: a promise does not survive another account's
 * deciding landing on this browser, nor another account's saved answer, which
 * clears the marker when it does not write its own. Without an account nothing
 * is taken.
 */
export function takeNextStart(userId: string | null | undefined): Product | null {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(NEXT_START_KEY);
    if (value === null) return null;
    // Removed before it is honoured: a value that cannot be removed would decide every landing.
    localStorage.removeItem(NEXT_START_KEY);
    return PRODUCTS.find((product) => value === nextStartValue(product, userId)) ?? null;
  } catch {
    return null;
  }
}

export function clearNextStart(): void {
  try {
    localStorage.removeItem(NEXT_START_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The account is in `product`: if that is the space it was promised, the promise is kept. */
function dropNextStartOnceReached(product: Product, userId: string): void {
  try {
    // Any other value is left as it is here. It goes with the next saved answer, or with the next landing that reads the marker, whichever account it is.
    if (localStorage.getItem(NEXT_START_KEY) === nextStartValue(product, userId)) {
      localStorage.removeItem(NEXT_START_KEY);
    }
  } catch {
    // Storage unavailable: there is no promise to keep.
  }
}

export function resolveProduct(pathname: string): Product {
  return productFromPath(pathname) ?? readLastProduct() ?? APPSEC;
}

export const productHome = (product: Product): string => spaceOf(product).prefix;

/**
 * The page where a product that is not active for the organisation is
 * presented and activated. A guarded URL sends there without carrying its
 * path: after activation the account lands on `productHome(product)`.
 */
export const activationPath = (product: Product): string => `${productHome(product)}/activate`;

/**
 * The page of a product active for the organisation that the member does not
 * hold (per-member products): « ask an administrator ». A
 * guarded URL sends there without carrying its path.
 */
export const noAccessPath = (product: Product): string => `${productHome(product)}/no-access`;

/** True on the activation page of any product, with or without a trailing slash. */
export function isActivationPath(pathname: string): boolean {
  return PRODUCTS.some(
    (product) => pathname === activationPath(product) || pathname === `${activationPath(product)}/`,
  );
}

/**
 * An AppSec page, under the AppSec prefix: `appsecPath('/autofix')` is
 * `/appsec/autofix`. It takes the paths the application writes; anything that
 * is not a single-slash path of this origin gives the AppSec home, so it can
 * never build a link elsewhere.
 */
export function appsecPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return APPSEC_PREFIX;
  return path === '/' ? APPSEC_PREFIX : `${APPSEC_PREFIX}${path}`;
}

/**
 * The AppSec project list's own URL. In the cloud it is also what the AppSec
 * home shows; in the Community Edition the home is the « Get started » page
 * and the list lives only here.
 */
export const APPSEC_PROJECTS_PATH = appsecPath('/projects');

/**
 * True on the home of a product, with or without a trailing slash. A home is
 * the only page an account may be moved away from: any deeper URL is a
 * destination it chose.
 */
export function isProductHome(pathname: string): boolean {
  return (
    pathname === '/' ||
    PRODUCTS.some((product) => pathname === productHome(product) || pathname === `${productHome(product)}/`)
  );
}

export const projectPath = (product: Product, projectId: string, segment?: string): string => {
  const base = `${productHome(product)}/project/${projectId}`;
  return segment ? `${base}/${segment}` : base;
};

/** `/project/integration/...` are onboarding routes, not a project page. */
const NOT_A_PROJECT_ID = 'integration';
/** The project pages every space has, at the same segment: switching product keeps them. */
const SHARED_PROJECT_PAGES = ['settings', 'code-graph'] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The equivalent page in another product. Switching product never changes
 * project: a project page mirrors to the same project, anything else to the
 * target product's home. The AppSec space also owns the former, unprefixed
 * project URLs; every other space is reached under its own prefix only.
 */
export function mirrorPath(pathname: string, target: Product): string {
  if (productFromPath(pathname) === target) return pathname;
  for (const space of PRODUCT_SPACES) {
    const prefix = space.id === APPSEC ? `(?:${APPSEC_PREFIX})?` : escapeRegExp(space.prefix);
    // cybedefend-ignore[CD-SAST-0434]: the prefix is a constant of this file or escaped by escapeRegExp(), and the pattern has no nested quantifier, so matching is linear in the path
    const match = new RegExp(`^${prefix}/project/([^/]+)(/.*)?$`).exec(pathname);
    if (!match || match[1] === NOT_A_PROJECT_ID) continue;
    const shared = SHARED_PROJECT_PAGES.find((segment) => match[2] === `/${segment}`);
    return projectPath(target, match[1], shared);
  }
  return productHome(target);
}

export function useProduct(): Product {
  const { pathname } = useLocation();
  return resolveProduct(pathname);
}

/**
 * Remembers the product of every product-owned route the user visits.
 *
 * `enabled` is false while nobody is signed in: the shell renders an AppSec
 * route for one commit before the redirect to the login page, and that render
 * is not a product the user chose.
 *
 * With the signed-in account's `userId`, a visit to the space an answer
 * promised that account for its next landing also keeps the promise: it is
 * dropped, so the account is not sent there again on a later landing. A page
 * common to every space, and the root `/` that only sends the account to a
 * home, have no product of their own and keep nothing.
 */
export function useRememberProduct(enabled: boolean, userId?: string | null): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!enabled) return;
    const product = productFromPath(pathname);
    if (!product) return;
    writeLastProduct(product);
    if (userId) dropNextStartOnceReached(product, userId);
  }, [enabled, pathname, userId]);
}
