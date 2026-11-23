/**
 * The neutral marker of what an element renders on the customer's behalf.
 *
 * - `secret`: a secret or a credential (a revealed secret, a token shown once,
 *   MFA codes, a link that carries a token). Nothing of it may be recorded.
 * - `content`: the customer's own content (source code, a conversation). Its
 *   layout may be kept, its text may not.
 *
 * The marker does nothing by itself: code that observes the page reads it and
 * decides. Spread it on the element that wraps the content; its descendants
 * are covered with it.
 *
 *   <code {...sensitive('secret')}>{value}</code>
 */
export const SENSITIVE_ATTRIBUTE = 'data-sensitive' as const;

export type SensitiveKind = 'secret' | 'content';

export const sensitive = (kind: SensitiveKind): { 'data-sensitive': SensitiveKind } => ({
  [SENSITIVE_ATTRIBUTE]: kind,
});
