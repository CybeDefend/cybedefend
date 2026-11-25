/**
 * The first path segments of the product spaces of the edition, for the
 * Markdown link filter. The product registry fills it when it loads
 * (`utils/product.ts`); the filter only reads it, at render time. It imports
 * nothing, so the filter can read it without importing the edition's
 * registry, which loads after the components that render Markdown.
 */
const roots = new Set<string>();

/** Records the prefixes (`/appsec`, …) of the product spaces. */
export function registerLinkRoots(prefixes: readonly string[]): void {
  prefixes.forEach((prefix) => {
    const first = prefix.replace(/^\/+/, '').split('/')[0];
    if (first) roots.add(first);
  });
}

/** True when `segment` is the first segment of a product space. */
export const isProductSpaceRoot = (segment: string): boolean => roots.has(segment);
