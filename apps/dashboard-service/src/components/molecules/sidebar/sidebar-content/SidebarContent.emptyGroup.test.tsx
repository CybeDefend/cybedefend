import React, { useSyncExternalStore } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The rail's « Defend » group holds only entries a role may see: Reports
 * (creator, administrator), Policies (and manager) and, in the cloud, AutoFix
 * (and member). A role that sees none of them got the group's hairline and
 * title over nothing (a member of an Open Source organisation; a billing
 * manager in the cloud). The group shows only while it
 * holds an entry, decided from what it renders, since each entry carries its
 * own authorisation, including the closed areas' registrations.
 *
 * `AuthorizedContent` is stubbed on the role, not as a pass-through: a
 * pass-through cannot see a permission bug.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
const auth = vi.hoisted(() => {
  let role = 'member';
  const listeners = new Set<() => void>();
  return {
    get role() {
      return role;
    },
    setRole(next: string) {
      role = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

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
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: auth.role }] }),
  AuthorizedContent: ({ relationship, children }: { relationship: string | string[]; children: React.ReactNode }) => {
    const role = useSyncExternalStore(auth.subscribe, () => auth.role);
    const allowed = (Array.isArray(relationship) ? relationship : [relationship]).includes(role);
    return allowed ? <>{children}</> : null;
  },
}));
vi.mock('@/components/molecules/onboarding-progress/OnboardingProgress', () => ({
  OnboardingProgress: () => null,
}));
vi.mock('@/ee/billing/components/molecules/trial-status-widget/TrialStatusWidget', () => ({
  TrialStatusWidget: () => null,
}));
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));

import { SidebarContent } from './SidebarContent';
import { readySlots } from '@/edition/slots';

// The community rail entries, loaded before any render. (The cloud's
// preload lives with its cases in the closed tree.)
beforeAll(async () => {
  ed.edition = 'community';
  await readySlots();
});
afterEach(() => {
  ed.edition = 'community';
  auth.setRole('member');
  window.localStorage.clear();
});

const renderSidebar = (role: string) => {
  auth.setRole(role);
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: {
          id: 'org-1',
          name: 'Acme',
          myRole: role,
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

/** The « Defend » title and the hairline right above it, which parts it from Discover. */
const defendGroup = () => {
  const title = screen.getByText('Defend');
  const group = title.closest('[data-rail-group="defend"]') as HTMLElement | null;
  expect(group, 'the title sits in its group').not.toBeNull();
  const hairline = group!.querySelector('.h-px');
  expect(hairline, 'the hairline belongs to the group').not.toBeNull();
  return { title, group: group!, hairline: hairline as HTMLElement };
};

const expectHidden = () => {
  const { title, hairline } = defendGroup();
  expect(title).not.toBeVisible();
  expect(hairline).not.toBeVisible();
};

const expectShown = (entries: string[]) => {
  const { title, hairline, group } = defendGroup();
  expect(title).toBeVisible();
  expect(hairline).toBeVisible();
  const links = Array.from(group.querySelectorAll('a')).map((a) => a.textContent?.trim());
  expect(links).toEqual(entries);
};

/**
 * Lets what follows a render settle: an entry loaded on demand (the cloud's
 * AutoFix) and the group's observer, whose callback runs after the change.
 */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('SidebarContent — the « Defend » group shows only with an entry', () => {
  it('community: a member sees neither the hairline nor the title, and Discover stays', async () => {
    renderSidebar('member');
    await settle();
    expectHidden();
    expect(screen.getByText('Discover')).toBeVisible();
    expect(screen.getByRole('link', { name: /Manage Projects/ })).toBeVisible();
  });

  it('community: an administrator sees Reports and Policies under it', async () => {
    renderSidebar('administrator');
    await settle();
    expectShown(['Security Reports', 'Security Policies']);
  });

  it('community: a manager sees Policies under it', async () => {
    renderSidebar('manager');
    await settle();
    expectShown(['Security Policies']);
  });

  // « cloud: a member sees AutoFix under it » and « cloud: a billing
  // manager … sees no empty group » live in the closed tree: the exported tree's ee entry is the community blank — `eeSlots: []`
  // — so a cloud case of the rail never passes on it.

  it('shows the group when an entry is authorised after the first render, and hides it when it goes', async () => {
    renderSidebar('member');
    await settle();
    expectHidden();
    act(() => auth.setRole('administrator'));
    await settle();
    expectShown(['Security Reports', 'Security Policies']);
    act(() => auth.setRole('member'));
    await settle();
    expectHidden();
  });
});
