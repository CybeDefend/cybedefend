import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import fs from 'node:fs';
import path from 'node:path';

/**
 * « Not available » has one wording per language, the
 * interface's `common.notAvailable` (« Not available », « Indisponible »).
 * The Products column reuses it instead of a sentence of its own.
 *
 * The column exists in the cloud only (the Community Edition has no per-member
 * products, UserTable.community.test.tsx), so this file runs the cloud.
 */
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

// Here a key is its own text: the test reads which key the cell asks for.
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

describe('UserTable — « not available »', () => {
  it('says a member’s products are not available with the interface’s one wording', () => {
    const store = configureStore({
      reducer: {
        organization: () => ({ selectedOrganization: { id: 'org-1', subscription: {} } }),
        user: () => ({ id: 'me' }),
      },
    });
    const props = {
      users: [{ id: 'dev-1', firstName: 'Dan', lastName: 'D', email: 'd@x', role: 'member', picture: '' }],
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
    render(
      <Provider store={store}>
        <UserTable {...props} />
      </Provider>,
    );
    expect(screen.getByText('common.notAvailable')).toBeInTheDocument();
  });

  it('keeps no second « not available » sentence in the member products strings', () => {
    for (const lang of ['en', 'fr']) {
      const file = path.resolve(__dirname, `../../../../i18n/locales/${lang}/components/memberProducts.json`);
      const strings = JSON.parse(fs.readFileSync(file, 'utf8')).components.memberProducts;
      expect(strings.unknown).toBeUndefined();
    }
  });
});
