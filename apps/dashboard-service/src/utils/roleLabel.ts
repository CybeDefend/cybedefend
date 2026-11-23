/**
 * The organisation role as the shell prints it (the rail's organisation row,
 * the account menu). A closed list: each value `myRole` can take maps to its
 * label in `roles.*`, and anything else prints nothing rather than a raw key.
 */
const ROLE_KEYS: Readonly<Record<string, string>> = {
  creator: 'roles.creator',
  administrator: 'roles.administrator',
  manager: 'roles.manager',
  member: 'roles.member',
  billing_manager: 'roles.billingManager',
};

export function roleLabelKey(role: string | null | undefined): string | null {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_KEYS, role)) return null;
  return ROLE_KEYS[role];
}
