import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: 'creator' }] }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/onboarding-progress/OnboardingProgress', () => ({
  OnboardingProgress: () => null,
}));
vi.mock('@/ee/billing/components/molecules/trial-status-widget/TrialStatusWidget', () => ({
  TrialStatusWidget: () => null,
}));

import { SidebarContent } from './SidebarContent';
import { readySlots } from '@/edition/slots';

// What the closed areas register on `app.sidebar.items` loads on demand: loaded before the first render.
beforeAll(() => readySlots());

/**
 * At 320 × 640 the navigation scrolls with no visible bar,
 * and its last entry sat under the Settings footer with nothing to say there
 * was more. A fade at the bottom of the list says it, and lets every click
 * through.
 */
describe('SidebarContent — a list taller than the window', () => {
  it('fades the bottom of the scrolled navigation without catching clicks', () => {
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
        user: () => ({ id: 'me', isOnboardingCompleted: true }),
        appVersion: () => ({ versionInfo: null, isLoading: false, isLoaded: true }),
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/appsec']}>
          <SidebarContent />
        </MemoryRouter>
      </Provider>,
    );
    const fade = screen.getByTestId('sidebar-nav-fade');
    expect(fade).toHaveAttribute('aria-hidden', 'true');
    expect(fade).toHaveClass('pointer-events-none', 'absolute', 'bottom-0');
    const scroller = screen.getByRole('link', { name: 'Security Policies' }).closest('.overflow-y-auto');
    expect(scroller?.parentElement).toContainElement(fade);
    expect(scroller).not.toContainElement(fade);
    // The Platform rail shows no bar: the fade says there is more.
    expect(scroller).toHaveClass('scrollbar-hide');
  });
});
