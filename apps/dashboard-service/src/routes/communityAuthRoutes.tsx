import type { RouteObject } from 'react-router-dom';
import type { SetupStatus } from '@/edition/auth/community/authApi';
import CommunityLoginPage from '@/pages/community-auth/CommunityLoginPage';
import ForgotPasswordPage from '@/pages/community-auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/community-auth/ResetPasswordPage';
import SetupPage from '@/pages/community-auth/SetupPage';
import SignUpPage from '@/pages/community-auth/SignUpPage';
import { safeReturnTo } from '@/pages/community-auth/returnTo';

/** Where a signed-out visitor signs in: `/login` in both editions. */
export function loginPath(): string {
  return '/login';
}

/**
 * The Community Edition's sign-in pages, rendered with no frame like the
 * cloud's. `/invite/:token` is App's own route, the same in both editions;
 * App also serves the Community link `/invite` (`#token=…`) to that page.
 * `/callback` and `/sso` do not exist here.
 */
export const communityAuthRoutes: RouteObject[] = [
  { path: '/login', element: <CommunityLoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
];

const PUBLIC_PATHS = new Set(communityAuthRoutes.map((route) => route.path));

/** A page a signed-out visitor of the Community Edition may stay on. */
export function isCommunityPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || /^\/invite(\/[^/]+)?\/?$/.test(pathname);
}

/**
 * Where a signed-out visitor of any other page goes: `/setup` while setup is
 * open, else `/login` with the page as `returnTo` (only a path `safeReturnTo`
 * accepts, and never the home). An unreadable status sends to `/login`.
 */
export function communitySignInRedirect(pathWithSearch: string, status: SetupStatus | null): string {
  if (status?.setupOpen) return '/setup';
  const returnTo = safeReturnTo(pathWithSearch);
  return returnTo && returnTo !== '/' ? `${loginPath()}?returnTo=${encodeURIComponent(returnTo)}` : loginPath();
}
