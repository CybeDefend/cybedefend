import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import type { RootState } from '@/server/store';
import {
  selectActiveProducts,
  selectDeniedProducts,
  selectIsProductChoicePending,
  selectProductsKnown,
} from '@/server/store/selectors';
import { landingPath, preferredProduct } from '@/utils/landing';
import { PRODUCTS, readLastProduct, takeNextStart, type Product } from '@/utils/product';

/**
 * True once somebody is signed in and their profile is in the store. The
 * landing rule waits for it, and the layout gates the write of the last
 * product on it.
 *
 * The user slice is read with `?.`: the layout is rendered under stores that
 * carry only part of it, and an absent profile is a profile not loaded yet.
 */
/** The root, written with one slash or several. */
const ROOT = /^\/+$/;

export const selectIsProfileLoaded = (state: RootState): boolean =>
  state.user?.isProfileLoaded === true;

/**
 * The root `/` is no page: each time it is rendered, once the profile is
 * loaded, it sends the account to the home of its preferred product, keeping
 * the query string (minus the entry source) and the hash. Any other pathname
 * is left alone: a deeper URL is a destination the account chose, and the
 * product guard of that URL decides whether it may stay. The home is only ever
 * that of an active product the member may use (`landingPath`): the preferred
 * one if it is, else the other, else the « no access » page when the member
 * holds none of the active ones, else the page of an organisation with no
 * product. And the
 * signed-in shell uses the entry source up there (Layout).
 *
 * Before the profile is loaded nothing is decided and nothing is used up: a
 * signed-out visitor's render of `/` precedes the redirect to the login page.
 */
export function useLandingRedirect(): void {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const isProfileLoaded = useSelector(selectIsProfileLoaded);
  const userId = useSelector((state: RootState) => state.user?.id);
  const onboardingUsage = useSelector((state: RootState) => state.user?.onboardingUsage);
  const productChoicePending = useSelector(selectIsProductChoicePending);
  const productsKnown = useSelector(selectProductsKnown);
  const activeProducts = useSelector(selectActiveProducts);
  // Per-member products: never a product the member is known not to hold.
  const deniedProducts = useSelector(selectDeniedProducts);
  // One decision per visit of `/`. The decision uses things up (the promised
  // start, the entry source): an effect run again before the account has left
  // `/` — StrictMode runs every effect twice, a profile refetch changes a
  // dependency — must not decide a second time from what the first one left.
  const decided = useRef(false);

  useEffect(() => {
    // The router serves the root for any run of slashes (`//` from a link built
    // on an origin that already ends with one): each is the root.
    if (!ROOT.test(pathname)) {
      decided.current = false;
      return;
    }
    if (decided.current || !isProfileLoaded) return;
    decided.current = true;

    // The edition's entry link, kept only when it names a space of this build.
    const entry = ACTIVE_EXTENSIONS.entrySource?.read() ?? null;
    const source = PRODUCTS.includes(entry as Product) ? (entry as Product) : null;
    const questionPending = productChoicePending;
    // The start an answered question promised is one-shot, and taken here and
    // nowhere else. It is used up only by the landing it decides: with no
    // entry link outranking it and no question about to be asked again.
    // Otherwise it stays for a later landing. It is honoured for the account
    // it was promised to, and for no other.
    const nextStart = source === null && !questionPending ? takeNextStart(userId) : null;

    const target = preferredProduct({
      source,
      nextStart,
      lastProduct: readLastProduct(),
      usage: onboardingUsage,
    });
    // The query goes with the account, minus the entry source: in the address
    // of the home, a reload or a bookmark would capture it again at boot.
    navigate(
      {
        pathname: landingPath({ preferred: target, known: productsKnown, active: activeProducts, denied: deniedProducts }),
        search: ACTIVE_EXTENSIONS.entrySource?.without(search) ?? search,
        hash,
      },
      { replace: true },
    );
    // A pending question preselects from the source and clears it on answer.
    if (!questionPending) {
      ACTIVE_EXTENSIONS.entrySource?.clear();
    }
  }, [
    isProfileLoaded,
    userId,
    onboardingUsage,
    productChoicePending,
    productsKnown,
    activeProducts,
    deniedProducts,
    pathname,
    search,
    hash,
    navigate,
  ]);
}
