import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The Platform rail's skin. It is pinned to the byte by
 * src/test/appsecUntouched.test.tsx; a few of its literals are re-checked
 * here. Another product space renders its own shell, covered by that shell's
 * own tests.
 */
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: 'creator' }] }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/onboarding-progress/OnboardingProgress', () => ({
  OnboardingProgress: () => <div data-testid="onboarding-progress" />,
}));
vi.mock('@/ee/billing/components/molecules/trial-status-widget/TrialStatusWidget', () => ({
  TrialStatusWidget: () => <div data-testid="trial-status-widget" />,
}));
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));

import { SidebarContent } from './SidebarContent';
import { readySlots } from '@/edition/slots';
import { appsecProjectListPath } from '@/utils/appsecProjectList';

// What the closed areas register on `app.sidebar.items` loads on demand: loaded before the first render.
beforeAll(() => readySlots());

const renderSidebar = (path: string, myRole = 'member') => {
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: {
          id: 'org-1',
          name: 'Acme',
          myRole,
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

const rootOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const link = (name: string) => screen.getByRole('link', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('SidebarContent — the Platform rail', () => {
  it('draws the rail black on light, on the surface of the header on dark', () => {
    const { container } = renderSidebar('/appsec');
    expect(rootOf(container)).toHaveClass('flex', 'h-full', 'flex-col', 'bg-[#060608]', 'dark:bg-as-surface');
    // A breath of the accent at its top in dark: never a fill.
    expect(rootOf(container).className).toMatch(/dark:bg-\[radial-gradient\(.*--color-secondary-rgb/);
  });

  it('keeps the active entry on its gradient wash', () => {
    // « Manage Projects » is active on the project list: the AppSec home in the
    // cloud, /appsec/projects in the Community Edition (its home is « Get started »).
    renderSidebar(appsecProjectListPath());
    expect(link('Manage Projects').className).toMatch(/from-secondary\/20/);
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('opens the dark picker of the black rail', () => {
    renderSidebar('/appsec');
    const row = screen.getByText('Acme').closest('button') as HTMLButtonElement;
    expect(row).not.toHaveAttribute('aria-expanded');
    fireEvent.click(row);
    expect(document.querySelector('.modal-content')).toHaveClass('bg-[#111113]', 'dark');
  });

  it('fades the foot of a cut list into the black, hidden while everything fits', () => {
    renderSidebar('/appsec');
    expect(screen.getByTestId('sidebar-nav-fade').className).toBe(
      'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#060608] to-transparent transition-opacity duration-150 dark:from-as-surface opacity-0',
    );
  });

  it('keeps the shared footer', () => {
    renderSidebar('/appsec');
    expect(screen.queryByTestId('rail-footer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Help/ })).toBeInTheDocument();
  });

  it('marks Settings active on the Platform usage and billing page', () => {
    for (const path of ['/appsec/billing', '/appsec/billing/']) {
      const view = renderSidebar(path, 'creator');
      const settings = screen.getByText('Settings').closest('button') as HTMLButtonElement;
      expect(settings.className).toMatch(/from-secondary\/20/);
      view.unmount();
    }
  });
});
