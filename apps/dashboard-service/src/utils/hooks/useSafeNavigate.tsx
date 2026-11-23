/**
 * Router-aware navigator that degrades gracefully outside a `<Router>`.
 *
 * `useNavigate()` is the only sanctioned way to perform SPA navigation in
 * react-router-dom 7, but it THROWS when invoked outside a Router context.
 * The dashboard mounts the Router at the app root (see `src/index.tsx`), so
 * production renders are always inside a Router. A small set of standalone
 * render surfaces (Storybook stories, ad-hoc tests, first paint before the
 * router mounts) need a graceful fallback to a plain
 * `window.location.assign(path)` instead of crashing.
 *
 * Rules of Hooks
 * --------------
 * The previous implementation conditionally called `useNavigate()` inside an
 * `if (inRouter)` branch, suppressed with an `eslint-disable
 * react-hooks/rules-of-hooks` comment. If `inRouter` ever toggled between
 * renders of the same component instance (e.g. a lazily-mounted Router),
 * the hook call order would change and React's internal hook-tracking would
 * desync — a latent state-corruption bug.
 *
 * The new implementation splits the in-Router and standalone paths into two
 * distinct sub-components (`RouterNavigatorChild` and
 * `FallbackNavigatorChild`), each with its own stable hook order. The
 * `SafeNavigator` parent decides ONCE per render which child to mount based
 * on `useInRouterContext()`. Rules of Hooks is satisfied regardless of how
 * the consumer is wrapped — the conditional sits OUTSIDE the
 * sub-components, so each child always calls the same hooks in the same
 * order across all of its own renders.
 *
 * Public API
 *  - `<SafeNavigator>{(navigate) => …}</SafeNavigator>` — render-prop
 *    component that works both inside and outside a Router.
 *  - `useSafeNavigate()` — hook variant. MUST be called from a component
 *    rendered inside a Router. The hook calls a fixed, unconditional set of
 *    hooks; no eslint-disable. For standalone renders (Storybook,
 *    ad-hoc tests), use `<SafeNavigator>` instead.
 */
import React from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';

export type NavigateFn = (path: string) => void;

/**
 * Module-level fallback: full-page navigation when no Router is mounted.
 * Defined at module scope so its reference is stable across renders.
 */
const fallbackNavigate: NavigateFn = (path: string) => {
    if (typeof window !== 'undefined') {
        window.location.assign(path);
    }
};

interface NavigatorChildProps {
    render: (navigate: NavigateFn) => React.ReactNode;
}

/**
 * In-Router sub-component. ALWAYS calls `useNavigate()` unconditionally.
 * Rendered by `<SafeNavigator>` only when `useInRouterContext()` is true,
 * so the call is always safe.
 */
const RouterNavigatorChild: React.FC<NavigatorChildProps> = ({ render }) => {
    const navigate = useNavigate();
    const wrapped: NavigateFn = (path: string) => navigate(path);
    return <>{render(wrapped)}</>;
};

/**
 * Standalone sub-component. NEVER calls `useNavigate()`, so it cannot throw
 * the "must be used within a Router" invariant. Rendered by `<SafeNavigator>`
 * only when no Router context is available.
 */
const FallbackNavigatorChild: React.FC<NavigatorChildProps> = ({ render }) => {
    return <>{render(fallbackNavigate)}</>;
};

export interface SafeNavigatorProps {
    children: (navigate: NavigateFn) => React.ReactNode;
}

/**
 * Render-prop component exposing a Router-aware navigator to its children.
 *
 * Picks ONCE per render between two sub-components, each with its own
 * stable hook order. Rules-of-Hooks safe regardless of how the consumer is
 * wrapped — the conditional sits OUTSIDE the sub-components.
 */
export const SafeNavigator: React.FC<SafeNavigatorProps> = ({ children }) => {
    const inRouter = useInRouterContext();
    if (inRouter) {
        return <RouterNavigatorChild render={children} />;
    }
    return <FallbackNavigatorChild render={children} />;
};

/**
 * Hook variant — always calls `useNavigate()` unconditionally. The hook is
 * therefore Rules-of-Hooks safe.
 *
 * Constraint: must be called from a component rendered INSIDE a `<Router>`.
 * The dashboard mounts the Router at the app root, so this is satisfied for
 * every production consumer. For Storybook stories or ad-hoc test renders
 * that do not mount a Router, use the `<SafeNavigator>` component instead;
 * it transparently falls back to `window.location.assign`.
 */
export const useSafeNavigate = (): NavigateFn => {
    const navigate = useNavigate();
    return (path: string) => navigate(path);
};

export default useSafeNavigate;
