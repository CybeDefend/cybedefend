import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

/**
 * The members table per edition: the Community Edition has no per-member
 * products, so every member would read « No product ». It shows no Products
 * column, header or cell; the cloud keeps it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
// Here a key is its own text: the test reads which key the table asks for.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [] }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import UserTable from './UserTable';

const renderIn = (edition: string, users: unknown[]) => {
  ed.edition = edition;
  const store = configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1', subscription: {} } }),
      user: () => ({ id: 'me' }),
    },
  });
  const props = {
    users,
    totalUsers: 2,
    totalItems: 2,
    currentPage: 1,
    totalPages: 1,
    pageSize: 10,
    showInvitationsButton: false,
    onManageInvitations: () => {},
    onSearchChange: () => {},
    onPageChange: () => {},
    onPageSizeChange: () => {},
    onManageUser: () => {},
    showProducts: true,
  } as unknown as React.ComponentProps<typeof UserTable>;
  return render(
    <Provider store={store}>
      <UserTable {...props} />
    </Provider>,
  );
};

const member = { id: 'dev-1', firstName: 'Dan', lastName: 'D', email: 'd@x', role: 'member', picture: '', products: [] };

describe('UserTable — Products column per edition', () => {
  it('community: no Products header and no product cell', () => {
    renderIn('community', [member]);
    expect(screen.queryByText('components.memberProducts.title')).not.toBeInTheDocument();
    expect(screen.queryByText('components.memberProducts.none')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getAllByRole('cell')).toHaveLength(5);
  });

  it('community: the empty row spans the five columns', () => {
    renderIn('community', []);
    expect(screen.getByRole('cell')).toHaveAttribute('colspan', '5');
  });

  it('cloud: keeps the Products column', () => {
    renderIn('cloud', [member]);
    expect(screen.getByText('components.memberProducts.title')).toBeInTheDocument();
    expect(screen.getByText('components.memberProducts.none')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
  });
});
