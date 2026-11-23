/**
 * The refusal of a role the edition gives nobody: the Community Edition's
 * global-management refuses an invitation, an acceptance or a role change to
 * `billing_manager` with `ROLE_NOT_AVAILABLE`, which the
 * gateway answers as a 400 with `body.code`. Read as a fixed sentence, never
 * the server's text.
 */
export const ROLE_REFUSAL_KEY = 'components.organizationRoleRefusal.ROLE_NOT_AVAILABLE';

const CODE = 'ROLE_NOT_AVAILABLE';

/** `ROLE_NOT_AVAILABLE` when the HTTP error carries exactly that code, else null. */
export function roleRefusalOf(error: unknown): typeof CODE | null {
  const data = (error as { response?: { data?: { code?: unknown; message?: unknown } } } | null)?.response?.data;
  if (!data || typeof data !== 'object') return null;
  return data.code === CODE || data.message === CODE ? CODE : null;
}
