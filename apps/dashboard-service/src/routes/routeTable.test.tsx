import { describe, expect, it } from 'vitest';
import { Navigate, createRoutesFromChildren, matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { appRouteTable } from '@/App';
import type { Edition } from '@/edition/edition';
import { communitySignInRedirect, isCommunityPublicPath, loginPath } from './communityAuthRoutes';

/** App's route table for an edition, as route objects. */
const routeTable = (edition: Edition): RouteObject[] =>
  createRoutesFromChildren((appRouteTable(edition).props as { children: ReactNode }).children);

/** The name of the element the deepest matching route renders. */
const pageAt = (edition: Edition, path: string): string | null => {
  const matches = matchRoutes(routeTable(edition), path);
  if (!matches || matches.length === 0) return null;
  const element = matches[matches.length - 1].route.element as ReactElement | undefined;
  if (!element) return null;
  const type = element.type as { displayName?: string; name?: string } | string;
  return typeof type === 'string' ? type : (type.displayName ?? type.name ?? null);
};

const INVITE = `/invite/${'ab'.repeat(32)}`;

describe('the route table per edition', () => {
  it('community serves /login, /setup, /signup, /forgot-password, /reset-password, /invite/:token and not /callback or /sso', () => {
    expect(pageAt('community', '/login')).toBe('CommunityLoginPage');
    expect(pageAt('community', '/setup')).toBe('SetupPage');
    expect(pageAt('community', '/signup')).toBe('SignUpPage');
    expect(pageAt('community', '/forgot-password')).toBe('ForgotPasswordPage');
    expect(pageAt('community', '/reset-password')).toBe('ResetPasswordPage');
    expect(pageAt('community', INVITE)).toBe('OrganizationInvitationPage');
    expect(pageAt('community', '/callback')).toBe('NotFoundPage');
  });

  it('community serves the fragment link /invite (#token=…) to the invitation page', () => {
    expect(pageAt('community', '/invite')).toBe('OrganizationInvitationPage');
    expect(pageAt('community', '/invite/')).toBe('OrganizationInvitationPage');
    expect(pageAt('community', '/sso')).toBe('NotFoundPage');
  });

  it('community serves the AppSec SAST page a GitHub or GitLab import opens', () => {
    expect(pageAt('community', '/appsec/project/proj-new/sast')).not.toBe('NotFoundPage');
    expect(pageAt('community', '/appsec/project/proj-new/sast')).not.toBeNull();
  });

  it('community serves /editions', () => {
    expect(pageAt('community', '/editions')).not.toBe('NotFoundPage');
    expect(pageAt('community', '/editions')).not.toBeNull();
  });
});

/**
 * Licence management is the cloud's: the Community
 * Edition serves neither the licence classifications page nor a licence's
 * detail page (a SARIF import carries no licence).
 */
describe('the licence pages per edition', () => {
  it('community serves no licence classifications page and no licence detail', () => {
    expect(pageAt('community', '/organization/settings/licenses')).toBe('NotFoundPage');
    expect(pageAt('community', '/appsec/project/proj-1/sca/license/MIT')).toBe('NotFoundPage');
    expect(pageAt('community', '/project/proj-1/sca/license/MIT')).toBe('NotFoundPage');
  });

  it('the cloud serves both', () => {
    expect(pageAt('cloud', '/organization/settings/licenses')).not.toBe('NotFoundPage');
    expect(pageAt('cloud', '/organization/settings/licenses')).not.toBeNull();
    expect(pageAt('cloud', '/appsec/project/proj-1/sca/license/MIT')).not.toBe('NotFoundPage');
  });
});

/**
 * The organisation's policies live in its settings (the page the rail links to). `/appsec/policies`
 * once rendered a page of sample policies with buttons that did nothing: it now leads to the real one.
 */
describe('the policies page per edition', () => {
  it.each(['community', 'cloud'] as const)('%s sends /appsec/policies to the organisation settings policies', (edition) => {
    const matches = matchRoutes(routeTable(edition), '/appsec/policies');
    // The edition's product guard may wrap the route's element: the redirect is what it renders.
    let element = matches?.[matches.length - 1].route.element as ReactElement<{ to?: string; children?: ReactNode }> | undefined;
    while (element && element.type !== Navigate && element.props.children) {
      element = element.props.children as ReactElement<{ to?: string; children?: ReactNode }>;
    }
    expect(element?.type).toBe(Navigate);
    expect(element?.props.to).toBe('/organization/settings/policies');
    expect(pageAt(edition, '/organization/settings/policies')).not.toBe('NotFoundPage');
    expect(pageAt(edition, '/organization/settings/policies')).not.toBeNull();
  });
});

describe('loginPath', () => {
  it('is /login in both editions', () => {
    expect(loginPath()).toBe('/login');
  });
});

describe('isCommunityPublicPath', () => {
  it.each(['/login', '/setup', '/signup', '/forgot-password', '/reset-password', INVITE, '/invite', '/invite/'])('%s is public', (path) => {
    expect(isCommunityPublicPath(path)).toBe(true);
  });

  it.each(['/', '/appsec', '/callback', '/sso', '/login/x', '/invites', `${INVITE}/x`, '/profile'])('%s is not', (path) => {
    expect(isCommunityPublicPath(path)).toBe(false);
  });
});

describe('communitySignInRedirect', () => {
  const closed = { setupOpen: false, signupMode: 'invite_only' as const, passwordResetByEmail: true };

  it('sends to /setup while setup is open', () => {
    expect(communitySignInRedirect('/project/abc', { ...closed, setupOpen: true })).toBe('/setup');
  });

  it('sends to /login with the page as returnTo', () => {
    expect(communitySignInRedirect('/project/abc?x=1', closed)).toBe(
      `/login?returnTo=${encodeURIComponent('/project/abc?x=1')}`,
    );
  });

  it('sends to /login with returnTo when the setup status could not be read', () => {
    expect(communitySignInRedirect('/appsec', null)).toBe(`/login?returnTo=${encodeURIComponent('/appsec')}`);
  });

  it.each(['/', '//evil.com', '/\\evil.com', 'https://evil.com'])('drops a returnTo of %j', (path) => {
    expect(communitySignInRedirect(path, closed)).toBe('/login');
  });
});
