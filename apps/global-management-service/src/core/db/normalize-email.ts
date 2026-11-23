/**
 * The one e-mail normalisation of global-management, used on every write and
 * every lookup (the local-auth stores, the e-mail comparisons):
 * trimmed and lower-cased, on both engines, so the `user.email` unique and
 * the e-mail lookups behave the same on PostgreSQL (case-sensitive) as on
 * MySQL (utf8mb4_0900_ai_ci).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
