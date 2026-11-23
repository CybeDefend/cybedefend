import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * « Get started » and « Manage Projects », per edition.
 *
 * « Manage Projects », per edition.
 * In Community the AppSec home is the « Get started » page, so the entry leads
 * to the project list's own URL; in the cloud the home is the project list and
 * the entry is unchanged.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  const { COMMUNITY_SLOTS } = await import('@/edition/community-slots');
  return {
    ...actual,
    activeSlots: () => (ed.edition === 'community' ? COMMUNITY_SLOTS : actual.activeSlots('cloud')),
  };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: 'creator' }] }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/onboarding-progress/OnboardingProgress', () => ({
  OnboardingProgress: () => <div data-testid="onboarding-progress" />,
}));
vi.mock('@/ee/billing/components/molecules/trial-status-widget/TrialStatusWidget', () => ({
  TrialStatusWidget: () => null,
}));
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));

import { SidebarContent } from './SidebarContent';
import { readySlots } from '@/edition/slots';

beforeAll(() => readySlots());
afterEach(() => {
  ed.edition = 'community';
});

const renderSidebar = (path = '/appsec') => {
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: {
          id: 'org-1',
          name: 'Acme',
          myRole: 'creator',
          subscription: { status: 'active', featuresDisabled: '' },
        },
      }),
      user: () => ({ id: 'me', isOnboardingCompleted: true, myOrganizations: [{ id: 'org-1', name: 'Acme' }] }),
      appVersion: () => ({ versionInfo: { version: '0.4.0', commit: 'abc' }, isLoading: false, isLoaded: true }),
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <SidebarContent />
      </MemoryRouter>
    </Provider>,
  );
};

// The rail marks its current row with the active gradient (`AS_RAIL_ACTIVE`).
const manageProjects = () => screen.getByRole('link', { name: 'Manage Projects' });

describe('SidebarContent — « Manage Projects »', () => {
  it('in Community, leads to the project list, not to the Get started home', () => {
    renderSidebar();
    expect(manageProjects()).toHaveAttribute('href', '/appsec/projects');
  });

  it('in Community, is the current page on the project list only', () => {
    renderSidebar('/appsec/projects');
    expect(manageProjects()).toHaveClass('from-secondary/20');
  });

  it('in Community, is not the current page on the Get started home', () => {
    renderSidebar('/appsec');
    expect(manageProjects()).not.toHaveClass('from-secondary/20');
  });

  it('in the cloud, still leads to the AppSec home, which is the project list', () => {
    ed.edition = 'cloud';
    renderSidebar('/appsec');
    expect(manageProjects()).toHaveAttribute('href', '/appsec');
    expect(manageProjects()).toHaveClass('from-secondary/20');
  });
});

/*
 * « Get started »: in Community the AppSec home is the Get started page,
 * and the rail's Discover section opens on an entry for it, above « Manage Projects ». It is the
 * current page on the home only, never on the list nor on a project. The cloud's rail has none.
 */
const PROJECT_PAGE = '/appsec/project/00000000-0000-4000-8000-000000000001/overview';
const getStarted = () => screen.queryByRole('link', { name: 'Get started' });
const ACTIVE = 'from-secondary/20';

describe('SidebarContent — « Get started »', () => {
  it('in Community, opens the Discover section, right above « Manage Projects »', () => {
    renderSidebar();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    const at = links.indexOf('Get started');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(links[at + 1]).toBe('Manage Projects');
    const discover = screen.getByText('Discover');
    expect(discover.compareDocumentPosition(getStarted()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('in Community, leads to the AppSec home', () => {
    renderSidebar('/appsec/projects');
    expect(getStarted()).toHaveAttribute('href', '/appsec');
  });

  it('in Community, is the current page on the home, and « Manage Projects » is not', () => {
    renderSidebar('/appsec');
    expect(getStarted()).toHaveClass(ACTIVE);
    expect(manageProjects()).not.toHaveClass(ACTIVE);
  });

  it('in Community, is the current page on the home written with a trailing slash', () => {
    renderSidebar('/appsec/');
    expect(getStarted()).toHaveClass(ACTIVE);
  });

  it('in Community, is not the current page on the project list, which « Manage Projects » is', () => {
    renderSidebar('/appsec/projects');
    expect(getStarted()).not.toHaveClass(ACTIVE);
    expect(manageProjects()).toHaveClass(ACTIVE);
  });

  it('in Community, is not the current page on a project page', () => {
    renderSidebar(PROJECT_PAGE);
    expect(getStarted()).not.toHaveClass(ACTIVE);
  });

  it('in the cloud, is not on the rail, whose home entry stays « Manage Projects »', () => {
    ed.edition = 'cloud';
    renderSidebar('/appsec');
    expect(getStarted()).toBeNull();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links.indexOf('Manage Projects')).toBeGreaterThanOrEqual(0);
  });

  it('in the cloud, on a project page, shows no Get started entry either', () => {
    ed.edition = 'cloud';
    renderSidebar(PROJECT_PAGE);
    expect(getStarted()).toBeNull();
  });
});
