import { useLayoutEffect } from 'react';
import type { Product } from './product';

/**
 * The accent of a product space.
 *
 * `data-product` drives the `secondary` colour (see `src/index.css`): violet in
 * AppSec, zinc ink in a closed space that registers its own accent. The same attribute does two jobs:
 *
 * - on `<html>`, written by the shell through `useProductAccentRoot`, it gives
 *   the whole document the accent of the space the account is in;
 * - on any element, written in the markup, it gives that element and what it
 *   contains the accent of the product it leads to, wherever it is shown:
 *   `<Link data-product="appsec" className="border border-secondary …">`.
 *
 * It only ever takes a `Product` value. Which product a page belongs to is
 * decided by `useProduct()` in `utils/product.ts`, never here.
 */
export const PRODUCT_ATTRIBUTE = 'data-product';

/**
 * Carries the product of the page to the document root, for as long as the
 * shell is mounted.
 *
 * The shell renders a fragment: its header, its sidebar and its page are
 * siblings, toasts are mounted beside it and portals go to `document.body`.
 * `<html>` is the only ancestor they all share.
 *
 * A layout effect, so the attribute is there before the first paint and a
 * switch never shows one frame in the other accent. Removed on unmount: the
 * pages outside the shell (sign-in, the callback, the onboarding) keep the
 * default accent, whatever space the account was in before it signed out.
 */
export function useProductAccentRoot(product: Product): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(PRODUCT_ATTRIBUTE, product);
    return () => root.removeAttribute(PRODUCT_ATTRIBUTE);
  }, [product]);
}
