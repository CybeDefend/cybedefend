import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * ProfileWrapper (the « My account » pages, `/profile/*`) in the Community
 * Edition: the build registers no closed space, so nothing is registered on
 * `settings.profile.tabs` and the account offers the core tabs alone —
 * [general, pat]. The account's security page is closed code
 * (in the closed tree): with no slot its tab is gone
 * and its route with it.
 *
 * The active edition is forced to community, as in `App.community.test.tsx`:
 * the `ACTIVE_*` constants and the `active*` functions answer what a private
 * build with `VITE_EDITION=community` computes, even though the closed tree's
 * entry may still export real arrays.
 */

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  const { COMMUNITY_SLOTS } = await import('@/edition/community-slots');
  return {
    ...actual,
    activeSlots: () => COMMUNITY_SLOTS,
    activeEeRoutes: () => [],
    activeEeAuthClient: () => null,
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_EE_ROUTES: [],
    ACTIVE_EE_SLOTS: [],
    ACTIVE_EE_AUTH_CLIENT: null,
    ACTIVE_SLOTS: COMMUNITY_SLOTS,
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});

import ProfileTemplateWrapper from './ProfileWrapper';

const USER = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.test',
  picture: '',
};

beforeEach(() => {
  localStorage.clear();
});

const renderWrapper = (selectedTab = 'general') =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfileTemplateWrapper user={USER} selectedTab={selectedTab}>
        <p data-testid="profile-page-body">Account information</p>
      </ProfileTemplateWrapper>
    </MemoryRouter>,
  );

/** The labels of the tab row, in order. */
const tabLabels = () =>
  within(screen.getByRole('navigation'))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('ProfileWrapper in the Community Edition', () => {
  it('with no slot, the profile tabs are exactly [general, pat]', () => {
    renderWrapper();
    expect(tabLabels()).toEqual(['General', 'Access Tokens']);
    expect(screen.queryByText('Security')).toBeNull();
  });
});
