import { describe, expect, it, vi } from 'vitest';

/**
 * The organisation roles offered per edition. Billing is the cloud's, so the
 * Community Edition offers no « Billing Manager » in the invitation or role
 * pickers. A member who already holds it keeps it: the
 * members table still names the role, and its role is shown read-only (no role
 * change offered), while the member can still be removed. The module reads
 * `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

const load = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  return {
    ...(await import('./invitableRoles')),
    ...(await import('./roleData')),
  };
};

describe('organisation roles per edition', () => {
  it('community: no inviter is offered the billing manager role', async () => {
    const { invitableOrganizationRoles } = await load('community');
    expect(invitableOrganizationRoles('creator').map((r) => r.value)).toEqual(['administrator', 'manager', 'member']);
    expect(invitableOrganizationRoles('administrator').map((r) => r.value)).toEqual(['manager', 'member']);
  }, 30_000);

  it('community: a billing manager keeps the role, shown read-only, and can still be removed', async () => {
    const { mayChangeOrganizationRole, mayGiveOrganizationRole, getOrganizationRoles } = await load('community');
    expect(mayChangeOrganizationRole('creator', 'billing_manager')).toBe(false);
    expect(mayChangeOrganizationRole('creator', 'manager')).toBe(true);
    expect(mayGiveOrganizationRole('creator', 'billing_manager')).toBe(true);
    // The members table still names the role.
    expect(getOrganizationRoles().map((r) => r.value)).toContain('billing_manager');
  }, 30_000);

  it('cloud: the billing manager role is offered and can be changed', async () => {
    const { invitableOrganizationRoles, mayChangeOrganizationRole } = await load('cloud');
    expect(invitableOrganizationRoles('creator').map((r) => r.value)).toEqual(['administrator', 'manager', 'billing_manager', 'member']);
    expect(mayChangeOrganizationRole('creator', 'billing_manager')).toBe(true);
  }, 30_000);
});
