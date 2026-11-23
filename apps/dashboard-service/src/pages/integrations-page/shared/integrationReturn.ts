import type { IntegrationProvider } from '@/server/interfaces/IntegrationProvider';
import { APPSEC, PRODUCTS, type Product, appsecPath, productHome, spaceOf } from '@/utils/product';

/**
 * Where the GitHub and GitLab callbacks bring back a connection started from
 * the create-project wizard: to the wizard of the product it left, open on the
 * provider. Without it the callback hands over to the AppSec project import,
 * and an account that connected GitHub from another space ended up in AppSec.
 *
 * The wizard writes the product just before it leaves for the provider; the
 * callback takes it back, once. It lives in localStorage because GitHub opens
 * in a new tab (`noopener`), which does not get this tab's sessionStorage.
 *
 * The stored value is writable by anything running on the page: it is matched
 * whole against the shape this module writes, and only the product it names
 * builds a path, when it is one of the registered spaces (`PRODUCTS`).
 */

export const INTEGRATION_RETURN_KEY = 'cybedefend.integrationReturn';

/** The query parameter that asks a page to open its wizard on a provider. */
export const NEW_PROJECT_PARAM = 'newProject';

/** Long enough to install an app or sign in at the provider; past it the connection is not the wizard's any more. */
export const INTEGRATION_RETURN_TTL_MS = 30 * 60 * 1000;

const PROVIDERS: readonly IntegrationProvider[] = ['github', 'gitlab'];

const STORED = /^([a-z][a-z0-9-]{0,31}):(github|gitlab):(\d{1,15})$/;

export function rememberIntegrationReturn(
  product: Product,
  provider: IntegrationProvider,
  now: number = Date.now(),
): void {
  try {
    localStorage.setItem(INTEGRATION_RETURN_KEY, `${product}:${provider}:${now}`);
  } catch {
    // Storage unavailable: the callback hands over to its usual page.
  }
}

/**
 * The product the wizard left for this provider, removed as it is read.
 * Anything else found there (another provider's, an expired or malformed
 * value) is removed too and gives nothing.
 */
export function takeIntegrationReturn(
  provider: IntegrationProvider,
  now: number = Date.now(),
): Product | null {
  try {
    const value = localStorage.getItem(INTEGRATION_RETURN_KEY);
    if (value === null) return null;
    // Removed before it is honoured: a value that cannot be removed would decide every callback.
    localStorage.removeItem(INTEGRATION_RETURN_KEY);
    const match = STORED.exec(value);
    if (!match || match[2] !== provider) return null;
    const age = now - Number(match[3]);
    if (age < 0 || age > INTEGRATION_RETURN_TTL_MS) return null;
    return PRODUCTS.find((product) => product === match[1]) ?? null;
  } catch {
    return null;
  }
}

/**
 * The page holding the product's wizard, asked to open it on the provider:
 * the AppSec home, or the page a space names (`ProductSpace.newProjectPath`),
 * else its home. A space whose shell holds a wizard of its own names another
 * page, so a single wizard opens.
 */
export function integrationReturnPath(product: Product, provider: IntegrationProvider): string {
  const query = `?${NEW_PROJECT_PARAM}=${provider}`;
  if (product === APPSEC) return `${appsecPath('/')}${query}`;
  return `${spaceOf(product).newProjectPath ?? productHome(product)}${query}`;
}

/** The provider named by the URL, from the fixed list only. */
export function readNewProjectParam(params: URLSearchParams): IntegrationProvider | null {
  const value = params.get(NEW_PROJECT_PARAM);
  return PROVIDERS.find((provider) => provider === value) ?? null;
}
