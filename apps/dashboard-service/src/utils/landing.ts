import { APPSEC, NO_PRODUCT_PATH, PRODUCTS, PRODUCT_SPACES, noAccessPath, productHome, type Product } from '@/utils/product';

/**
 * Onboarding step recorded on the account once it has chosen the products of
 * an organisation. `onboardingProgress` is merged server-side, so the marker
 * follows the account to every device.
 */
export const PRODUCT_CHOICE_STEP = 'product_choice_v1';

/**
 * Where the usage answer of an account starts it: the first registered space,
 * in display order, that claims one of its answers (`landingUsage`), AppSec
 * otherwise. The core claims none.
 */
export function productFromUsage(usage: readonly string[] | null | undefined): Product {
  const claimed = PRODUCT_SPACES.find((space) => space.landingUsage?.some((answer) => usage?.includes(answer)));
  return claimed ? (claimed.id as Product) : APPSEC;
}

interface PreferredProductInput {
  /** The space the entry link of this session was for. */
  source: Product | null;
  /** What an answered question promised for this landing (`takeNextStart`). */
  nextStart: Product | null;
  lastProduct: Product | null;
  usage: readonly string[] | null | undefined;
}

/**
 * Where an account starts when the URL does not say: the entry link of this
 * session, then the start an answered question promised, then the last space
 * used in this browser, then the account's answer.
 */
export function preferredProduct({
  source,
  nextStart,
  lastProduct,
  usage,
}: PreferredProductInput): Product {
  return source ?? nextStart ?? lastProduct ?? productFromUsage(usage);
}

interface LandingPathInput {
  /** What `preferredProduct` chose. */
  preferred: Product | null;
  /** False while the organisation's products are unknown (billing unavailable). */
  known: boolean;
  /** The active products of the selected organisation. */
  active: readonly Product[];
  /**
   * The products the member is known not to hold (per-member products,
   * `selectDeniedProducts`). None while the member's own products
   * are unknown, which keeps the landing of before.
   */
  denied?: readonly Product[];
}

/**
 * Where the root sends the account: only ever to an active product the member
 * may use. The preferred one if it is, else the other, else, when the
 * organisation has active products none of which the member holds, the « no
 * access » page of the preferred one (or of an active one), else the page of
 * an organisation with no product. While the organisation's products are
 * unknown the preferred one opens, unless the member is known not to hold it:
 * unknown is not « none ».
 *
 * With a single space the landing is its home and nothing is asked: there is
 * nowhere else to go.
 */
export function landingPath({ preferred, known, active, denied = [] }: LandingPathInput): string {
  if (PRODUCTS.length === 1) return productHome(APPSEC);
  const chosen = preferred ?? APPSEC;
  const mayOpen = (product: Product): boolean => !denied.includes(product);
  if (!known) {
    if (mayOpen(chosen)) return productHome(chosen);
    const other = PRODUCTS.find((product) => product !== chosen && mayOpen(product));
    return other ? productHome(other) : noAccessPath(chosen);
  }
  const open = active.filter(mayOpen);
  if (open.includes(chosen)) return productHome(chosen);
  if (open.length > 0) return productHome(open[0]);
  if (active.length === 0) return NO_PRODUCT_PATH;
  return noAccessPath(active.includes(chosen) ? chosen : active[0]);
}
