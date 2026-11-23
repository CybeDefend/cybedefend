// report-findings.ts
//
// Content rules shared by the reports: which findings count, how to group
// them, how to order package versions, how to date, and secret masking.

import * as semver from 'semver';

/**
 * States of a finding dismissed after triage: false positive (`ignored`),
 * fixed (`resolved`) or judged not exploitable (`not_exploitable`, a legacy
 * state). Same rule as the dashboard overview and the report e-mails
 * (report-mail/report-aggregation.service.ts): they do not count in a
 * report's figures.
 */
export const NON_REPORTABLE_STATES: ReadonlySet<string> = new Set([
  'ignored',
  'resolved',
  'not_exploitable',
]);

/** A finding still open (to verify, confirmed…) counts in the figures. */
export function isActiveState(state: string | null | undefined): boolean {
  return !NON_REPORTABLE_STATES.has(String(state ?? '').toLowerCase());
}

// « Withdrawn Advisory: … », « Duplicate Advisory: … », « Withdrawn: … ».
export const WITHDRAWN_TITLE_RE =
  /^\s*(?:withdrawn|duplicate)(?:\s+advisory)?\s*:\s*/i;
// A description that opens a line on the withdrawal (« ## Withdrawn
// Advisory », « **Withdrawn** », « Withdrawn, accidental duplicate
// publish. », « # WITHDRAWN »).
const WITHDRAWN_TEXT_RE =
  /^\s*(?:#{1,6}\s*|\*\*)?(?:withdrawn\b|duplicate advisory\b)|\bthis advisory has been withdrawn\b/im;
// A withdrawal that says the advisory repeats another one (« Duplicate
// Advisory: », « withdrawn because it is a duplicate of GHSA-… », « Withdrawn,
// accidental duplicate publish »).
const DUPLICATE_TEXT_RE =
  /^\s*(?:#{1,6}\s*)?duplicate advisory\b|\b(?:withdrawn|accidental)\b[^\n]*\bduplicate\b/im;

/**
 * Advisory withdrawn by its publisher, from its title or its text. It stays
 * counted, as on the dashboard; the reports flag it and never let it set the
 * fixed version.
 */
export function isWithdrawnAdvisory(
  title: string | null | undefined,
  description: string | null | undefined,
): boolean {
  return (
    WITHDRAWN_TITLE_RE.test(title ?? '') ||
    WITHDRAWN_TEXT_RE.test(description ?? '')
  );
}

/** Advisory withdrawn because it repeats another one. */
export function isDuplicateAdvisory(
  title: string | null | undefined,
  description: string | null | undefined,
): boolean {
  return (
    isWithdrawnAdvisory(title, description) &&
    (/^\s*duplicate\b/i.test(title ?? '') ||
      DUPLICATE_TEXT_RE.test(description ?? ''))
  );
}

/** Groups by key, keeping the order of first appearance. */
export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups, ([key, list]) => ({ key, items: list }));
}

// Epoch of a Debian or RPM version (`8:` in `8:6.9.11.60+dfsg-1.6ubuntu1.3`):
// `semver.coerce` reads it as a major version (8.0.0), `1:2.3.4-1` as
// 1.0.0.
const EPOCH_RE = /^(\d+):/;

// What only a distribution package's version carries, besides an epoch: a
// Debian or Ubuntu revision (`-1.6ubuntu1.3`, `+deb11u5`, `~deb12u1`,
// `+dfsg`, `~bpo11`, `+b1`), an RPM release (`.el8`, `.fc38`, `.amzn2023`) or
// an Alpine one (`-r0`).
const DISTRO_REVISION_RE =
  /ubuntu|deb\d|dfsg|~|\+b\d+$|\.(?:el|fc|amzn|cm|azl)\d|-r\d+$/i;

// A pre-release (`1.0.10rc1`, `2.0.0-beta.1`); in a distribution package,
// only after a `~` (`2.0~rc1-1`).
const PRERELEASE_RE =
  /(?:[-.]?(?:a|b|alpha|beta|rc|c|pre|preview|dev)\.?\d*)$/i;
const DISTRO_PRERELEASE_RE = /~(?:alpha|beta|rc|pre|dev)/i;

/**
 * Version of a distribution package (Debian, Ubuntu, RHEL, Alpine…). Its
 * revision carries the fixes the distribution backports, which an advisory's
 * upstream text ignores: it does not compare with the versions it quotes. An
 * upstream version stays upstream, whatever its suffix (`7.1.2-15`,
 * ImageMagick's patch level, `2.7.1-rc1`).
 */
export function isDistroVersion(version: string | null | undefined): boolean {
  const v = String(version ?? '').trim();
  return EPOCH_RE.test(v) || DISTRO_REVISION_RE.test(v);
}

/** A pre-release, never the revision of a distribution package (`+b1`). */
export function isPrereleaseVersion(
  version: string | null | undefined,
): boolean {
  const v = String(version ?? '').trim();
  if (isDistroVersion(v)) return DISTRO_PRERELEASE_RE.test(v);
  return /\d/.test(v) && PRERELEASE_RE.test(v);
}

/** The epoch of a version (0 without), and what follows it. */
const splitEpoch = (v: string): [number, string] => {
  const m = EPOCH_RE.exec(v);
  return m ? [Number(m[1]), v.slice(m[0].length)] : [0, v];
};

const isDigit = (s: string, i: number): boolean =>
  i < s.length && s[i] >= '0' && s[i] <= '9';

// Rank of a non-digit character for dpkg: `~` before everything, even the
// end of the string; letters before other signs.
const dpkgRank = (c: string | undefined): number => {
  if (c === undefined || (c >= '0' && c <= '9')) return 0;
  if (c === '~') return -1;
  return /[A-Za-z]/.test(c) ? c.charCodeAt(0) : c.charCodeAt(0) + 256;
};

/** Compares two parts of a version like dpkg (`verrevcmp`). */
function dpkgCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while (
      (i < a.length && !isDigit(a, i)) ||
      (j < b.length && !isDigit(b, j))
    ) {
      const diff = dpkgRank(a[i]) - dpkgRank(b[j]);
      if (diff) return diff;
      i += 1;
      j += 1;
    }
    while (a[i] === '0') i += 1;
    while (b[j] === '0') j += 1;
    let first = 0;
    while (isDigit(a, i) && isDigit(b, j)) {
      if (!first) first = a.charCodeAt(i) - b.charCodeAt(j);
      i += 1;
      j += 1;
    }
    if (isDigit(a, i)) return 1;
    if (isDigit(b, j)) return -1;
    if (first) return first;
  }
  return 0;
}

/** Upstream version, then revision (after the last `-`), like dpkg. */
function distroCompare(a: string, b: string): number {
  const split = (v: string): [string, string] => {
    const at = v.lastIndexOf('-');
    return at < 0 ? [v, ''] : [v.slice(0, at), v.slice(at + 1)];
  };
  const [upA, revA] = split(a);
  const [upB, revB] = split(b);
  return dpkgCompare(upA, upB) || dpkgCompare(revA, revB);
}

/**
 * Semver order of a language package version; on a tie (`1.0.10rc1` and
 * `1.0.10` read as 1.0.10, as do `2.13.4` and `2.13.4.2`), the final version
 * after the pre-release, then the numeric order of the text. A readable
 * version comes before an unreadable one (`latest`).
 */
function releaseCompare(a: string, b: string): number {
  const va = semver.coerce(a, { includePrerelease: true });
  const vb = semver.coerce(b, { includePrerelease: true });
  const byText = () => a.localeCompare(b, 'en', { numeric: true });
  if (!va || !vb) return Number(!!va) - Number(!!vb) || byText();
  return (
    semver.compare(va, vb) ||
    Number(isPrereleaseVersion(b)) - Number(isPrereleaseVersion(a)) ||
    byText()
  );
}

/**
 * Orders two versions of one package (negative when `a` comes before `b`).
 * The epoch of a Debian or RPM version is compared first, as dpkg does, never
 * as a major version; a distribution version is then compared like dpkg
 * (`…ubuntu1.3` before `…ubuntu1.4`, `-r9` before `-r10`), a language version
 * in semver order.
 */
export function comparePackageVersions(a: string, b: string): number {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  const [epochX, restX] = splitEpoch(x);
  const [epochY, restY] = splitEpoch(y);
  if (epochX !== epochY) return epochX - epochY;
  return isDistroVersion(x) || isDistroVersion(y)
    ? distroCompare(restX, restY)
    : releaseCompare(restX, restY);
}

/** Highest version of a list (see {@link comparePackageVersions}). */
export function highestPackageVersion(
  versions: readonly (string | null | undefined)[],
): string | undefined {
  let best: string | undefined;
  for (const v of versions) {
    if (v && (best === undefined || comparePackageVersions(v, best) > 0)) {
      best = v;
    }
  }
  return best;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `23 Sep 2026` (UTC). */
/** `CWE-79`, `cwe-79`, `79` → `CWE-79`; anything else → null. */
export function normalizeCweId(ref: unknown): string | null {
  if (typeof ref !== 'string' && typeof ref !== 'number') return null;
  const match = String(ref)
    .trim()
    .match(/^(?:CWE-)?(\d+)$/i);
  return match ? `CWE-${match[1]}` : null;
}

/**
 * CWE ids of an OSV advisory (`database_specific.cwe_ids`, GHSA / NVD),
 * normalised and deduplicated: how a dependency or container advisory is
 * mapped to the CWE Top 25, in the per-project and the organisation CWE
 * reports alike.
 */
export function advisoryCwes(databaseSpecific: unknown): string[] {
  const ids = (databaseSpecific as { cwe_ids?: unknown } | null | undefined)
    ?.cwe_ids;
  return Array.isArray(ids)
    ? Array.from(new Set(ids.map(normalizeCweId).filter(Boolean)))
    : [];
}

export function formatReportDay(
  value: string | Date | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `23 Sep 2026, 10:50 UTC`. */
export function formatReportDate(
  value: string | Date | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return '—';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatReportDay(d)}, ${hh}:${mm} UTC`;
}

// Known secret patterns: prefix kept, last 4 characters kept.
const SECRET_PATTERNS: RegExp[] = [
  /\b((?:sk|rk|pk)_(?:live|test)_)([A-Za-z0-9]{12,})/g, // Stripe
  /\b(AKIA|ASIA)([0-9A-Z]{16})\b/g, // AWS access key id
  /\b(gh[pousr]_)([A-Za-z0-9]{30,})/g, // GitHub tokens
  /\b(github_pat_)([A-Za-z0-9_]{30,})/g, // GitHub fine-grained PAT
  /\b(xox[abposr]-)([A-Za-z0-9-]{10,})/g, // Slack
  /\b(AIza)([0-9A-Za-z_-]{30,})/g, // Google API key
  /\b(glpat-)([A-Za-z0-9_-]{16,})/g, // GitLab PAT
];

/**
 * Masks recognisable secrets (Stripe, AWS, GitHub, Slack, Google, GitLab
 * keys, PEM private keys): a PDF report circulates by e-mail and is archived,
 * it must never redistribute a secret in clear.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text.replace(
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    '$1\n••••\n$2',
  );
  for (const re of SECRET_PATTERNS) {
    out = out.replace(
      re,
      (_m, prefix: string, body: string) => `${prefix}••••${body.slice(-4)}`,
    );
  }
  return out;
}

// Tokens and identifiers an agent analysis copies from the code it quotes:
// JWT, Bearer header, password of a connection URL, literal value assigned
// to a secret name (`cookieSecret: "…"`).
const JWT_RE =
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/g;
const URL_PASSWORD_RE = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;
const ASSIGNED_SECRET_RE =
  /(\b[\w.-]*(?:secret|passw(?:or)?d|pwd|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret|credential)[\w.-]*["'`]?\s*[:=]\s*)(["'`])([^"'`\n]{3,})\2/gi;

/**
 * `redactSecrets`, plus what a Cybe Analysis quotes: a JWT, a Bearer token,
 * the password of a URL and the literal value assigned to a secret name, even
 * a « demo » default. Idempotent: rendering masks a text already masked on
 * reading a second time, without changing anything.
 */
export function redactQuotedSecrets(text: string): string {
  if (!text) return text;
  return redactSecrets(text)
    .replace(JWT_RE, 'eyJ••••')
    .replace(BEARER_RE, '$1••••')
    .replace(URL_PASSWORD_RE, '$1••••$3')
    .replace(ASSIGNED_SECRET_RE, '$1$2••••$2');
}
