import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * A role the edition no longer offers (the Community Edition's « Billing
 * Manager ») is kept by the member who holds it: the dialog
 * names it read-only instead of offering a role select. Without that label
 * (every role the cloud offers) the dialog renders as before.
 */
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-redux', () => ({ useSelector: () => [] }));
vi.mock('@/edition/active', async (importOriginal) => {
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  return { ...(await importOriginal<typeof import('@/edition/active')>()), ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS };
});

import ManageUserModal from './ManageUserModal';

const base = {
  userRole: 'billing_manager',
  onRoleChange: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
  onUpdate: vi.fn(),
  roles: [{ value: 'member', label: 'Member' }],
  canChangeRole: false,
  canRemove: true,
};

describe('ManageUserModal — a role kept read-only', () => {
  it('names the kept role, offers no role select, and still offers the removal', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ManageUserModal {...(base as any)} keptRoleLabel="Billing Manager" />);
    expect(screen.getByTestId('manage-user-kept-role')).toHaveTextContent('Billing Manager');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Delete User')).toBeInTheDocument();
  });

  it('without a kept role, names no role (as before)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ManageUserModal {...(base as any)} />);
    expect(screen.queryByTestId('manage-user-kept-role')).toBeNull();
  });
});
