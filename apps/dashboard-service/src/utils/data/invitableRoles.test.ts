import { describe, expect, it, vi } from 'vitest';

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by invitableRoles.community.test.ts.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

vi.mock('./roleData', () => ({
  getOrganizationRoles: () => [
    { value: 'administrator', label: 'Administrator' },
    { value: 'manager', label: 'Manager' },
    { value: 'billing_manager', label: 'Billing manager' },
    { value: 'member', label: 'Member' },
  ],
}));

import { invitableOrganizationRoles, mayGiveOrganizationRole } from './invitableRoles';

const values = (role: string | undefined) => invitableOrganizationRoles(role).map((r) => r.value);

describe('invitableOrganizationRoles — the roles an inviter may give (global-management INVITABLE_ORGANIZATION_ROLES)', () => {
  it('the creator may give every role but creator', () => {
    expect(values('creator')).toEqual(['administrator', 'manager', 'billing_manager', 'member']);
  });

  it('an administrator may not appoint an administrator', () => {
    expect(values('administrator')).toEqual(['manager', 'billing_manager', 'member']);
  });

  it('a manager may give member only: no administrator, manager or billing manager', () => {
    expect(values('manager')).toEqual(['member']);
  });

  it('anyone else, or an unknown role, may give nothing', () => {
    expect(values('billing_manager')).toEqual([]);
    expect(values('member')).toEqual([]);
    expect(values('')).toEqual([]);
    expect(values(undefined)).toEqual([]);
    expect(values('hasOwnProperty')).toEqual([]);
  });

  it('keeps the labels of the role list', () => {
    expect(invitableOrganizationRoles('administrator')).toEqual([
      { value: 'manager', label: 'Manager' },
      { value: 'billing_manager', label: 'Billing manager' },
      { value: 'member', label: 'Member' },
    ]);
  });
});

// A removal and a role change are ranked like
// an invitation, by global-management; the members page mirrors it.
describe('mayGiveOrganizationRole — what a member may remove or re-rank', () => {
  it('follows the invitation ladder', () => {
    expect(mayGiveOrganizationRole('creator', 'administrator')).toBe(true);
    expect(mayGiveOrganizationRole('administrator', 'administrator')).toBe(false);
    expect(mayGiveOrganizationRole('administrator', 'billing_manager')).toBe(true);
    expect(mayGiveOrganizationRole('manager', 'member')).toBe(true);
    expect(mayGiveOrganizationRole('manager', 'manager')).toBe(false);
    expect(mayGiveOrganizationRole('manager', 'billing_manager')).toBe(false);
  });

  it('never the creator, and nothing from or to an unknown role', () => {
    expect(mayGiveOrganizationRole('creator', 'creator')).toBe(false);
    expect(mayGiveOrganizationRole('member', 'member')).toBe(false);
    expect(mayGiveOrganizationRole(undefined, 'member')).toBe(false);
    expect(mayGiveOrganizationRole('creator', undefined)).toBe(false);
    expect(mayGiveOrganizationRole('hasOwnProperty', 'member')).toBe(false);
  });
});
