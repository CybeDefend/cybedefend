/**
 * Strip credential material from prose leaving the platform.
 *
 * Outbound prose (exports, issue comments) may quote credentials from the
 * vulnerability catalogue: for the secret-detection rules, a catalogue entry's
 * description can carry the credential that was found (a Stripe key, AWS
 * access keys, Slack tokens, PGP and PEM private key blocks). The catalogue is
 * shared between projects, so such prose must never be published as is.
 *
 * Excluding the COLUMN that stores a secret (`encryptedSecret` on the secret
 * family) is not enough on its own: prose describing a finding can carry the
 * credential while living in a column that has nothing to do with secrets.
 * Outbound text is therefore filtered on what it CONTAINS, by content.
 *
 * Several egress paths call it (an export, the dismissal reason printed in an
 * issue-tracker comment by vulnerability/issue-integration.service.ts), which
 * is why it lives in the core.
 *
 * Deliberately conservative: this redacts recognisable credential SHAPES. It is
 * a last line of defence at the egress boundary, not a reason to let generators
 * write secrets into the catalogue in the first place.
 */

/** Ordered: the PEM block must win over any token pattern inside it. */
const PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    // Whole armoured block, header to footer, across newlines.
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g,
    label: 'PRIVATE KEY',
  },
  { re: /\bsk_live_[A-Za-z0-9]{8,}/g, label: 'STRIPE KEY' },
  { re: /\bsk_test_[A-Za-z0-9]{8,}/g, label: 'STRIPE KEY' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS KEY' },
  { re: /\bASIA[0-9A-Z]{16}\b/g, label: 'AWS KEY' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GITHUB TOKEN' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'SLACK TOKEN' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'GOOGLE KEY' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g, label: 'GITLAB TOKEN' },
  // JWTs carry claims, and a signed one is a bearer credential in its own right.
  {
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    label: 'JWT',
  },
];

/**
 * Replace every recognised credential in `text` with a typed placeholder.
 *
 * The placeholder names the KIND rather than deleting the sentence: a reader
 * must still understand what the finding is about, and an auditor must see that
 * something was withheld rather than silently rewritten.
 */
export function redactSecrets(text: string | null): string | null {
  if (text === null || text === undefined) return text ?? null;
  if (text === '') return '';
  let out = text;
  for (const { re, label } of PATTERNS) {
    // Fresh lastIndex per call: these are module-level /g regexes.
    re.lastIndex = 0;
    out = out.replace(re, `[REDACTED ${label}]`);
  }
  return out;
}
