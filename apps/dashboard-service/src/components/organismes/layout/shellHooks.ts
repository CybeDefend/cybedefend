import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import type { RootState } from '@/server/store';
import { selectIsProductChoicePending } from '@/server/store/selectors';
import type { Handlers, RealtimeEventType } from '@/server/services/realtimeStream';
import { ACTIVE_EXTENSIONS } from '@/edition/active';

/**
 * Pages of the shell where the account is asked nothing: on the first it is
 * being signed out, on the second its subscription is suspended and the page
 * is its way out. A question there would flash, or stand in the way. The
 * other pages a suspended account keeps are ruled out by the suspension
 * itself, see `useCanAskQuestions`.
 */
const NO_QUESTION_PATHS: readonly string[] = ['/logout', '/subscription-expired'];

/**
 * Whether the shell may ask its questions (persona, product) on this page.
 * Shared by Layout and by the frame a product space registers.
 */
export function useCanAskQuestions(): boolean {
  const { pathname } = useLocation();
  const productChoicePending = useSelector(selectIsProductChoicePending);
  // A suspended organisation keeps the shell on a few pages (billing, profile):
  // the navigation and the switch between spaces are hidden there (same signal
  // as the sidebar), so a question about the space to start in is not asked.
  // No subscription suspends anything in an edition that does not bill.
  const isSuspended = useSelector(
    (state: RootState) =>
      ACTIVE_EXTENSIONS.billing?.isSubscriptionSuspended(state.organization?.selectedOrganization?.subscription) ?? false,
  );
  // The suspension is AppSec's: with no product active, the product question is
  // the way out (activate one), so it is asked over a suspended AppSec plan.
  return (!isSuspended || productChoicePending) && !NO_QUESTION_PATHS.includes(pathname);
}

/** What a shell effect hears of the organisation's billing stream. */
type ShellStreamListener = (type: string, env: unknown) => void;

/** Adds a listener to the shell's stream; the function it returns removes it. */
type RegisterShellStreamListener = (listener: ShellStreamListener) => () => void;

const ShellBillingStreamContext = createContext<RegisterShellStreamListener>(() => () => undefined);

/** Provided by Layout around the shell effects the edition registers. */
export const ShellBillingStreamProvider = ShellBillingStreamContext.Provider;

/**
 * Layout's side of the organisation's billing stream: one stream per shell,
 * which every registered shell effect may listen to (`useShellBillingStream`).
 * `listening` says one does, so that Layout opens the stream for them;
 * `dispatch` hands every event to each of them.
 */
export function useShellBillingStreamHost(): {
  listening: boolean;
  register: RegisterShellStreamListener;
  dispatch: ShellStreamListener;
} {
  const listenersRef = useRef(new Set<ShellStreamListener>());
  const [listening, setListening] = useState(false);
  const register = useCallback<RegisterShellStreamListener>((listener) => {
    listenersRef.current.add(listener);
    setListening(true);
    return () => {
      listenersRef.current.delete(listener);
      setListening(listenersRef.current.size > 0);
    };
  }, []);
  const dispatch = useCallback<ShellStreamListener>((type, env) => {
    listenersRef.current.forEach((listener) => listener(type, env));
  }, []);
  return { listening, register, dispatch };
}

/**
 * A shell effect's side: listens to the shell's billing stream with these
 * handlers while they are not null (Layout then keeps the stream open), and
 * stops listening when they become null. The handlers are read when an event
 * comes, so they may change at every render without reopening anything.
 */
export function useShellBillingStream(handlers: Handlers | null): void {
  const register = useContext(ShellBillingStreamContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const listening = handlers !== null;
  useEffect(() => {
    if (!listening) return undefined;
    return register((type, env) => handlersRef.current?.[type as RealtimeEventType]?.(env));
  }, [listening, register]);
}
