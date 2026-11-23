import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * Where « Getting started » sits in the rail, per edition.
 * The cloud's navigation is long: the checklist follows it and lands at the
 * foot of the rail, then the bands of order 1000 (none in the cloud). The
 * Community navigation is short, so the checklist sat mid-rail: there, a
 * spacer takes the free room and the Cloud card then the checklist close the
 * scrollable area, right above the fixed Settings block. The rail has no
 * « CybeDefend Cloud » entry: the editions page is reached
 * from the Get started page.
 * jsdom has no layout: the DOM order and the classes say it.
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
import { CLOUD_CARD_DISMISSED_KEY, resetCloudCardDismissalForTests } from '@/edition/upsell/cloudCardDismissal';

beforeAll(() => readySlots());
afterEach(() => {
  ed.edition = 'community';
  window.localStorage.clear();
  resetCloudCardDismissalForTests();
});

const renderSidebar = () => {
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
      <MemoryRouter initialEntries={['/appsec']}>
        <SidebarContent />
      </MemoryRouter>
    </Provider>,
  );
};

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('SidebarContent — « Getting started » placement', () => {
  it('in Community, closes the scrollable rail: nav, free room, the Cloud card, then the checklist', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation');
    const cloud = screen.getByRole('region', { name: 'Focus on security, not hosting.' });
    const checklist = screen.getByTestId('onboarding-progress');
    const spacer = document.querySelector('[data-rail-spacer]') as HTMLElement;
    const scroller = nav.closest('.overflow-y-auto') as HTMLElement;

    expect(spacer).not.toBeNull();
    expect(spacer).toHaveClass('grow');
    expect(follows(nav, spacer)).toBe(true);
    expect(follows(spacer, cloud)).toBe(true);
    expect(follows(cloud, checklist)).toBe(true);
    // No « CybeDefend Cloud » entry, and no rail link to the editions page.
    expect(screen.queryByRole('link', { name: 'CybeDefend Cloud' })).toBeNull();
    expect(document.querySelector('a[href="/editions"]')).toBeNull();
    // The checklist is the last thing of the scrollable area: nothing of it follows.
    const content = scroller.firstElementChild as HTMLElement;
    expect(content.lastElementChild).toContainElement(checklist);
    // The area fills the scroller, so its foot is the scroller's foot, right above Settings.
    expect(scroller).toHaveClass('flex', 'flex-col');
    expect(content).toHaveClass('grow', 'flex', 'flex-col');
    const settings = screen.getByRole('button', { name: /Settings/ });
    expect(scroller).not.toContainElement(settings);
    expect(follows(checklist, settings)).toBe(true);
    // Never lifted out of the flow, so it covers nothing.
    for (let el: HTMLElement | null = checklist; el && el !== scroller; el = el.parentElement) {
      expect(el.className).not.toMatch(/\b(absolute|fixed|bottom-full|z-\d+)\b/);
    }
  });

  it('in the cloud, keeps the checklist right after the navigation, with no spacer', () => {
    ed.edition = 'cloud';
    renderSidebar();
    const nav = screen.getByRole('navigation');
    const checklist = screen.getByTestId('onboarding-progress');
    const scroller = nav.closest('.overflow-y-auto') as HTMLElement;
    expect(document.querySelector('[data-rail-spacer]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'CybeDefend Cloud' })).toBeNull();
    expect(follows(nav, checklist)).toBe(true);
    expect(scroller).not.toHaveClass('flex');
    expect(scroller.firstElementChild).not.toHaveClass('grow');
  });
});

describe('SidebarContent — the « CybeDefend Cloud » card', () => {
  const card = () => screen.queryByRole('region', { name: 'Focus on security, not hosting.' });

  it('in Community, sits right above « Getting started », after the free room, in the flow', () => {
    renderSidebar();
    const spacer = document.querySelector('[data-rail-spacer]') as HTMLElement;
    const checklist = screen.getByTestId('onboarding-progress');
    const shown = card();
    expect(shown).not.toBeNull();
    expect(follows(spacer, shown as Node)).toBe(true);
    expect(follows(shown as Node, checklist)).toBe(true);
    // A section the rail fit can leave out, inside the scrollable area, covering nothing.
    expect(shown).toHaveAttribute('data-rail-section', 'cloud');
    const scroller = screen.getByRole('navigation').closest('.overflow-y-auto') as HTMLElement;
    expect(scroller).toContainElement(shown as HTMLElement);
  });

  it('once dismissed, is gone, and no « CybeDefend Cloud » entry takes its place', () => {
    window.localStorage.setItem(CLOUD_CARD_DISMISSED_KEY, '1');
    renderSidebar();
    expect(card()).toBeNull();
    expect(screen.queryByRole('link', { name: 'CybeDefend Cloud' })).toBeNull();
    // The checklist still closes the rail.
    expect(screen.getByTestId('onboarding-progress')).toBeInTheDocument();
  });

  it('in the cloud, is never shown', () => {
    ed.edition = 'cloud';
    renderSidebar();
    expect(card()).toBeNull();
    expect(document.querySelector('[data-rail-section="cloud"]')).toBeNull();
  });
});
