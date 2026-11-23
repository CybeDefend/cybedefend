import React from 'react';
import { beforeAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('react-rebac', () => ({
  useRebac: () => ({
    userEntities: [{ id: 'org-1', type: 'organization', relation: 'creator' }],
  }),
  // Permify gating is a separate axis; let everything through so this test
  // measures the suspension gate alone.
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/molecules/onboarding-progress/OnboardingProgress', () => ({
  OnboardingProgress: () => <div data-testid="onboarding-progress" />,
}));

import { SidebarContent } from './SidebarContent';
import { readySlots } from '@/edition/slots';

// What the closed areas register on `app.sidebar.items` loads on demand: loaded before the first render.
beforeAll(() => readySlots());

const ORG_NAME = 'Acme';

const renderSidebar = (status: string, myRole = 'member', path = '/subscription-expired') => {
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: {
          id: 'org-1',
          name: ORG_NAME,
          myRole,
          subscription: { status, featuresDisabled: '' },
        },
      }),
      user: () => ({ id: 'me', isOnboardingCompleted: true }),
      // BottomSidebar (the footer rail: theme toggle, help, version) reads this.
      appVersion: () => ({ versionInfo: null, isLoading: false, isLoaded: true }),
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

/** Nav entries that lead to routes a suspended org cannot reach (Cybe AutoFix, an ee entry, is checked in src/ee). */
const DEAD_ENDS = [
  'Manage Projects',
  'Organization Overview',
  'Security Reports',
  'Security Policies',
];

describe('SidebarContent while the organization is suspended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('healthy subscription (regression guard)', () => {
    it.each(DEAD_ENDS)('still shows %s', (label) => {
      renderSidebar('active');
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('still shows the settings menu', () => {
      renderSidebar('active');
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('suspended, user cannot manage billing', () => {
    it('keeps the organization switcher, so they can move to a healthy org', () => {
      renderSidebar('canceled', 'member');
      expect(screen.getByText(ORG_NAME)).toBeInTheDocument();
    });
  });
});
