// Detection of FAKE / placeholder secrets.
//
// A "fake" secret is a value that is plainly not a real credential — a
// placeholder, an example, sequential/repeated filler, an environment-variable
// name, or a secret-manager reference. Such findings are dropped at ingestion
// so they never pollute the secret queue.
//
// HIGH PRECISION is the rule: a false negative (a fake slips through) is just
// noise, but a false positive (a real leaked secret silently dropped) is a
// security miss. Every rule below is therefore anchored or frequency-based so
// that a value which merely CONTAINS a placeholder-ish substring, or a genuine
// high-entropy credential that happens to include an incidental run/repeat, is
// never dropped. (Hardened against an adversarial real-secret corpus.)
//
// Detection is VALUE-ONLY: the file path is deliberately NOT a signal, because
// a real secret committed into a test file is still a real leaked secret.

// R1a — STRONG placeholder words: distinctive enough that a delimited suffix is
// still a placeholder (your_api_key, dummy-token, change-me, <your-token>).
const STRONG_PLACEHOLDER =
  /^(?:your|my[_-]?secret|change[_-]?me|changeit|placeholder|redacted|dummy|sample|example|fixme|todo|tbd|lorem(?:[_-]?ipsum)?|foobar|insert|replace|not[_-]?real)(?:[_-][\w@!-]*)?$/i;

// R1b — WEAK / common words: only flagged as a WHOLE value (optionally with
// trailing digits/!), never as a delimited prefix, so a real token that merely
// starts with e.g. "test_" is not dropped.
const WEAK_PLACEHOLDER =
  /^(?:test(?:ing)?|secret|passw[o0]rd|p[@a]ssw[0o]rd|passwd|pwd|admin|fake|foo|bar|baz|letmein|hunter2|welcome|qwerty)(?:[\d!]*)?$/i;

// R1c — distinctive substrings safe to match even when embedded, because they
// do not occur inside real high-entropy credentials: secret-manager / env
// references and unambiguous multi-token placeholders.
const REFERENCE_SUBSTRING =
  /infisical|vault:|secretsmanager|process\.env|os\.environ|import\.meta\.env|getenv\(|your[_-](?:api|secret|token|key|client)|replace[_-]with|insert[_-]your/i;

// R3a — the WHOLE value is a template / env reference: ${VAR} or $VAR.
const TEMPLATE_REF = /^\$\{?[A-Za-z_]\w*\}?$/;

// R3b — SCREAMING_SNAKE_CASE env-var NAME, but only when one of its segments is
// a secret-ish keyword. A real all-caps recovery/license code without such a
// word (e.g. V5RL_MK2B_Q9XZ) is therefore NOT dropped.
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const SECRET_KEYWORDS = new Set([
  'KEY',
  'KEYS',
  'SECRET',
  'SECRETS',
  'TOKEN',
  'TOKENS',
  'PASSWORD',
  'PASS',
  'PWD',
  'PRIVATE',
  'PUBLIC',
  'API',
  'APIKEY',
  'AUTH',
  'CREDENTIAL',
  'CREDENTIALS',
  'CRED',
  'ENV',
  'CONFIG',
  'JWT',
  'CERT',
  'PEM',
  'ACCESS',
  'CLIENT',
  'OAUTH',
  'BEARER',
  'SIGNING',
  'ENCRYPTION',
  'SSH',
  'GPG',
  'PGP',
]);

// Ascending/descending sequence space: digits then lowercase letters, so that
// "9" → "a" reads as consecutive (covers hex placeholders like 0123456789ab).
const SEQ = '0123456789abcdefghijklmnopqrstuvwxyz';

function seqIndex(ch: string): number {
  return SEQ.indexOf(ch.toLowerCase());
}

// Fraction of characters that belong to an ascending or descending run of
// length >= 3. Random secrets score near 0; sequential filler scores near 1.
function sequentialCoverage(s: string): number {
  if (s.length < 3) return 0;
  const inRun = new Array<boolean>(s.length).fill(false);
  const idx = [...s].map(seqIndex);
  for (let i = 0; i + 2 < s.length; i++) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    if (a < 0 || b < 0 || c < 0) continue;
    const ascending = b - a === 1 && c - b === 1;
    const descending = a - b === 1 && b - c === 1;
    if (ascending || descending) {
      inRun[i] = true;
      inRun[i + 1] = true;
      inRun[i + 2] = true;
    }
  }
  return inRun.filter(Boolean).length / s.length;
}

// Fraction of the string taken up by its most frequent character.
function maxCharFraction(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let max = 0;
  for (const count of freq.values()) if (count > max) max = count;
  return max / s.length;
}

export function isFakeSecret(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;

  // Placeholder / reference (all anchored or distinctive).
  if (STRONG_PLACEHOLDER.test(v)) return true;
  if (WEAK_PLACEHOLDER.test(v)) return true;
  if (REFERENCE_SUBSTRING.test(v)) return true;

  // Template / env-var reference or name.
  if (TEMPLATE_REF.test(v)) return true;
  if (
    SCREAMING_SNAKE.test(v) &&
    v.split('_').some((segment) => SECRET_KEYWORDS.has(segment))
  ) {
    return true;
  }

  // A single character dominates the value (masks / fillers like
  // "xxxxxxxx" or "AKIAXXXXXXXX"). Frequency-based, NOT a consecutive-run
  // regex, so a real key with an incidental "aaaaa" or a PEM body full of
  // base64 "AAAA" is not dropped.
  if (v.length >= 5 && maxCharFraction(v) >= 0.7) return true;

  // Sequential filler: most of the value is ascending/descending runs.
  // Computed on the whole value (no prefix stripping) and gated at 0.7 so a
  // real token with a short incidental run stays well under the threshold.
  if (v.length >= 8 && sequentialCoverage(v) >= 0.7) return true;

  return false;
}
