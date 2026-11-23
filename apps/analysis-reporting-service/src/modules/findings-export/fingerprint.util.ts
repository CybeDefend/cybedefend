import { createHash } from 'crypto';

/**
 * Stable finding identity, v1.
 *
 * The line number is deliberately NOT an input: the previous identity
 * (`vulnerability.id + path + language + startLine + endLine`) created a new
 * detection row on any line drift, which is why `finalizeOldScanVulnerabilities`
 * needed a nearest-line repair pass. Hashing the vulnerable code region instead
 * makes the identity a property of the finding rather than a repair.
 *
 * Known limitations, shared with GitHub code scanning and Semgrep and documented
 * in the public OpenAPI: a file rename, a variable rename inside the vulnerable
 * region, and the removal of one of N identical occurrences all change the id.
 */
export const FINGERPRINT_VERSION = 'v1';

export interface SnippetLine {
  line: number;
  content: string;
}

/**
 * Injective component framing: `<byte-length>:<utf8 bytes>` per component.
 *
 * The first cut joined components with a fixed separator (U+001F) and asserted
 * in a comment that the byte "cannot occur in a path, a package name or a
 * UUID". That is false — a POSIX path may contain any byte but '/' and NUL, and
 * a scanner-parsed manifest string may contain anything at all — and the
 * forgery it allows was demonstrated against the shipped module: two SCA inputs
 * differing only in where the packageName/packageVersion boundary falls hashed
 * to one value.
 *
 * With a length prefix no byte is forbidden inside a component and no boundary
 * between two adjacent components can shift, so the encoding is injective for
 * any component values whatsoever.
 */
export function encodeComponent(
  part: string | number | null | undefined,
): string {
  const s = String(part ?? '');
  return `${Buffer.byteLength(s, 'utf8')}:${s}`;
}

/**
 * A tie-break string for `assignOccurrenceIndexes` built from several
 * components, framed with the SAME length prefix the digest uses.
 *
 * Two findings that share a tie-break fall back to scanner output order — the
 * ordering the tie-break exists to replace — so the framing has to be injective
 * for the same reason the digest's does.
 *
 * An earlier comment here justified the framing with a collision that does not
 * exist: it claimed `${endLine} ${language}` gives '12 3java' for (12, '3java')
 * and '123 java' for (123, 'java'), i.e. one string. Run it — they differ, and a
 * two-component join whose first component is a LINE NUMBER really is injective,
 * because a decimal integer cannot contain a space so the first separator is
 * always the boundary.
 *
 * The framing is still the right call, for the honest reason: that argument is a
 * property of today's component list, not of the encoding. It dies as soon as a
 * caller passes three components ('a','b','c' vs 'a b c') or a component that
 * can contain the separator ('a b','c' vs 'a','b c' — both 'a b c'), and the
 * signature is `(string|number|null|undefined)[]`, so nothing stops either. The
 * length prefix makes injectivity unconditional and removes the side condition
 * from the audit surface. `fingerprint.util.spec.ts` pins exactly that: its case
 * FAILS for a raw join and passes here.
 */
export function occurrenceTieBreak(
  parts: (string | number | null | undefined)[],
): string {
  return parts.map(encodeComponent).join('');
}

/**
 * The single line coercion shared by `assignOccurrenceIndexes` and
 * `ScanQueueService.allocateOccurrenceIndexes`.
 *
 * The two MUST agree — the allocator's contract is that a finding's identity
 * does not depend on whether Redis answered — and they did not: the allocator
 * used `Number(e.line) || 0`, mapping a NaN to 0 so it sorted FIRST, while this
 * file mapped it to +Infinity so it sorted LAST. Nothing upstream rejects a
 * non-finite line (`SastIacService`'s `lineOf` is
 * `Number(v?.codeSnippet?.vulnerableStartLine ?? 0)`, which is NaN for any
 * non-numeric non-null value), so the coercion has to live in one place.
 *
 * +Infinity rather than 0: a garbage line is not line zero, and sorting it last
 * keeps every well-formed finding's rank unchanged. It is also idempotent, so
 * a caller may normalise before handing the value over.
 */
export function normalizeOccurrenceLine(line: unknown): number {
  const n = Number(line);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Total order for one occurrence bucket, shared with the Redis allocator.
 *
 * Explicit comparisons, never a subtraction: `Infinity - Infinity` is NaN,
 * which makes the comparator intransitive and hands the result to whatever
 * permutation V8's sort happens to produce for that array length.
 */
export function compareOccurrenceEntries(
  a: { line: number; tie: string; ordinal: number },
  b: { line: number; tie: string; ordinal: number },
): number {
  if (a.line !== b.line) return a.line < b.line ? -1 : 1;
  if (a.tie !== b.tie) return a.tie < b.tie ? -1 : 1;
  return a.ordinal - b.ordinal;
}

function digest(parts: (string | number | null | undefined)[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    const buf = Buffer.from(String(p ?? ''), 'utf8');
    h.update(String(buf.length));
    h.update(':');
    h.update(buf);
  }
  return h.digest('hex');
}

/**
 * Repo-relative, separator- and dot-segment-normalised path.
 *
 * Idempotent by construction: it decomposes into segments, drops '' and '.',
 * resolves '..' against the accumulated prefix, and re-joins — so a second pass
 * over its own output is a no-op. The first cut used anchored regexes, which
 * stripped only ONE leading './' ('././src/a.ts' needed a second pass) and left
 * every interior './' and '..' untouched, so two scanners spelling one file
 * differently produced two fingerprints.
 *
 * A leading '..' that has nothing to resolve against is KEPT rather than
 * silently dropped: dropping it would collapse '../a.ts' onto 'a.ts', which are
 * different files, and would break idempotency's whole point — agreeing with
 * itself is not enough, it has to agree with reality.
 */
export function normalizePath(path: string): string {
  const segments = (path ?? '').replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/**
 * The vulnerable region only, one line per row, whitespace-collapsed.
 * Context lines are excluded: they move for reasons unrelated to the finding.
 */
export function normalizeSnippet(
  lines: SnippetLine[],
  vulnerableStartLine: number,
  vulnerableEndLine: number,
): string {
  // The proto declares `repeated CodeStructure code`, but this function sits on
  // the ingestion hot path: a scanner (or a legacy caller) that sends a plain
  // string must yield an empty region, never crash the whole batch.
  if (!Array.isArray(lines)) return '';
  return lines
    .filter(
      (l) => l?.line >= vulnerableStartLine && l?.line <= vulnerableEndLine,
    )
    .sort((a, b) => a.line - b.line)
    .map((l) => (l.content ?? '').trim().replace(/\s+/g, ' '))
    .join('\n');
}

/**
 * Rank among items sharing the same key, ordered by ascending line. Without it,
 * two identical `eval()` calls in one file collide. GitHub and Semgrep both
 * carry the same counter, and inherit the same caveat: deleting one of N
 * occurrences shifts the index of every later one.
 *
 * The index is HASHED, so its stability is the finding's stability. Ranking a
 * line tie on array position — the scanner's output order — made two findings
 * at one line SWAP fingerprints between two scans of unchanged code, and every
 * per-fingerprint state (dismissal, status, first-seen) followed the wrong
 * finding. Same-line pairs are routine, not exotic: two rows differing only in
 * `vulnerableEndLine` or `language` are distinct rows that neither
 * `computeCodeFingerprint` nor `codeOccurrenceKey` separates, and any pair whose
 * vulnerable region normalises to '' (usual for secret and cicd) lands here too.
 *
 * `tieBreakOf` is therefore how a caller feeds in every stable property it has
 * that the digest does not already carry. `SastIacService.computeOccurrenceIndexes`
 * supplies `occurrenceTieBreak([endLine, language])` and forwards the same string
 * to the Redis allocator, so the LIVE ranking path and this one order alike over
 * one batch's worth of entries — see residue 2 for what that excludes.
 * Build the string with `occurrenceTieBreak` rather than by hand — see that
 * function for why the framing is unconditional and a raw join is not.
 *
 * TWO residues, both real, neither papered over:
 *
 * 1. WITHIN one call, two items identical in the key, the line AND every
 *    property `tieBreakOf` exposes still fall back to array order. This one is
 *    irreducible: if every hashed component is identical the pair is genuinely
 *    indistinguishable and no ordering rule can tell them apart.
 * 2. ACROSS calls — i.e. in production, where the ranking is the Redis
 *    allocator and one group's members can arrive in different BullMQ batches —
 *    the tie-break orders only the members that share a batch. See the residue
 *    section of `ScanQueueService.allocateOccurrenceIndexes`; it is NOT
 *    irreducible, it is a consequence of stamping the fingerprint during
 *    ingestion, and it is pinned by `scan-queue.occurrence-index.spec.ts`
 *    ("the cross-batch residue (known, unclosed)").
 *
 * A non-finite line (NaN from a missing/garbage `vulnerableStartLine`) is sorted
 * LAST rather than compared: `a.line - b.line` on a NaN yields NaN, which makes
 * the comparator intransitive and hands the result to whatever permutation V8's
 * sort happens to produce for that array length. The coercion is
 * `normalizeOccurrenceLine` and the order is `compareOccurrenceEntries` — both
 * SHARED with `ScanQueueService.allocateOccurrenceIndexes` rather than
 * reimplemented, because the two silently disagreed on a NaN (0 there, +Infinity
 * here) while the allocator's doc-comment promised they agree.
 *
 * This function is the batch-local reference the allocator is pinned against
 * (`scan-queue.occurrence-index.spec.ts`), not the production ranking path:
 * production goes through the cross-batch Redis allocator, because a batch
 * cannot rank a group it only partly contains.
 */
export function assignOccurrenceIndexes<T>(
  items: T[],
  keyOf: (item: T) => string,
  lineOf: (item: T) => number,
  tieBreakOf?: (item: T) => string,
): number[] {
  const byKey = new Map<
    string,
    { index: number; line: number; tie: string; ordinal: number }[]
  >();
  items.forEach((item, index) => {
    const key = keyOf(item);
    const bucket = byKey.get(key) ?? [];
    bucket.push({
      index,
      ordinal: index,
      line: normalizeOccurrenceLine(lineOf(item)),
      tie: tieBreakOf ? String(tieBreakOf(item) ?? '') : '',
    });
    byKey.set(key, bucket);
  });

  const out = new Array<number>(items.length).fill(0);
  for (const bucket of byKey.values()) {
    bucket.sort(compareOccurrenceEntries).forEach((entry, rank) => {
      out[entry.index] = rank;
    });
  }
  return out;
}

/**
 * Bucket key for `assignOccurrenceIndexes` over code-family findings.
 *
 * It MUST be built from the same components `computeCodeFingerprint` hashes —
 * the catalogue vulnerability id and the NORMALISED path/snippet — otherwise
 * the counter fails to disambiguate exactly the rows that would collide.
 * `correspondance_table` is many-to-one onto the catalogue id (one kics vuln
 * maps to dozens of ruleIds), so keying on the raw scanner `ruleId` puts two
 * findings that hash identically into two different buckets and hands them
 * both index 0.
 *
 * It is length-prefixed for the same reason the digest is: a bucket key that
 * can be forged by shifting a boundary splits two colliding findings into two
 * buckets and hands them both index 0 — the exact failure the counter exists to
 * prevent.
 */
export function codeOccurrenceKey(input: {
  catalogVulnId: string;
  path: string;
  snippetLines: SnippetLine[];
  vulnerableStartLine: number;
  vulnerableEndLine: number;
}): string {
  return [
    String(input.catalogVulnId ?? ''),
    normalizePath(input.path),
    normalizeSnippet(
      input.snippetLines,
      input.vulnerableStartLine,
      input.vulnerableEndLine,
    ),
  ]
    .map(encodeComponent)
    .join('');
}

export interface CodeFingerprintInput {
  projectId: string;
  branch: string | null;
  scannerType: string;
  catalogVulnId: string;
  path: string;
  snippetLines: SnippetLine[];
  vulnerableStartLine: number;
  vulnerableEndLine: number;
  occurrenceIndex: number;
}

/** sast, iac, cicd and secret. */
export function computeCodeFingerprint(input: CodeFingerprintInput): string {
  const snippetHash = createHash('sha256')
    .update(
      normalizeSnippet(
        input.snippetLines,
        input.vulnerableStartLine,
        input.vulnerableEndLine,
      ),
    )
    .digest('hex');

  return digest([
    FINGERPRINT_VERSION,
    input.projectId,
    input.branch,
    input.scannerType,
    input.catalogVulnId,
    normalizePath(input.path),
    snippetHash,
    input.occurrenceIndex,
  ]);
}

export interface SecretValueFingerprintInput {
  projectId: string;
  branch: string | null;
  scannerType: string;
  catalogVulnId: string;
  path: string;
  /** Keyed hash of the secret's value (`SecretEncryptionService.hashSecretValue`). */
  secretValueHash: string;
}

/**
 * Identity of a secret reported with its value: the code digest with the
 * keyed hash of the value in place of the snippet digest.
 *
 * A secret is one finding per value and file, whichever pass reported it and
 * at whatever line: the HEAD pass sends the current snippet, the history pass
 * none, and an incremental history pass would hand two values of one file the
 * same empty snippet and the same occurrence index 0. So neither the snippet
 * nor the occurrence index is hashed (the index is pinned to 0): every report
 * of one value shares this digest, and two values never do. The value hash is
 * keyed, and only reaches the output through this sha256.
 */
export function computeSecretValueFingerprint(
  input: SecretValueFingerprintInput,
): string {
  return digest([
    FINGERPRINT_VERSION,
    input.projectId,
    input.branch,
    input.scannerType,
    input.catalogVulnId,
    normalizePath(input.path),
    `secret-value:${input.secretValueHash}`,
    0,
  ]);
}

export interface ScaFingerprintInput {
  projectId: string;
  branch: string | null;
  ecosystem: string;
  packageName: string;
  packageVersion: string;
  osvId: string;
}

export function computeScaFingerprint(input: ScaFingerprintInput): string {
  return digest([
    FINGERPRINT_VERSION,
    input.projectId,
    input.branch,
    'sca',
    input.ecosystem,
    input.packageName,
    input.packageVersion,
    input.osvId,
  ]);
}

/**
 * The container detection row is identified by {vulnerability, detectedPackage,
 * projectId, branch} and its package row by {projectId, packageName,
 * packageVersion, target, class, arch} — see `upsertDetection` / `upsertPackage`
 * in container.service.ts. The fingerprint mirrors that identity EXACTLY, and
 * nothing else.
 *
 * `target`, `class` and `arch` are inputs because they are part of the package
 * lookup key: two legitimately distinct package rows (same name+version,
 * different Trivy target or class) must not collapse onto one digest, or the
 * planned UNIQUE (projectId, branch, fingerprint) breaks.
 *
 * The IMAGE is deliberately NOT an input, and this is the second time that has
 * been decided; the reasoning is recorded here so it is not undone a third
 * time.
 *
 * `container_detected_images` is UNIQUE on (projectId, artifactName, branch),
 * so it is tempting to read "two images in one project" as "two findings that
 * the digest must keep apart". It is not, because the image never reaches the
 * rows the digest identifies:
 *
 * - `upsertPackage` searches on {projectId, packageName, packageVersion,
 *   target, class, arch} — no image — and `processVulnsWithConcurrency` looks
 *   the package up on {projectId, packageName, target}, narrower still.
 * - `upsertDetection` searches on {vulnerability, detectedPackage, projectId,
 *   branch} — no image.
 *
 * So for `class='lang-pkgs'`, where `target` is a manifest path INSIDE the
 * image (`app/package-lock.json`, routinely identical across two images built
 * from one repo), two images already share ONE package row and ONE detection
 * row. There is one finding, not two, and no collision for the digest to fix.
 *
 * Hashing the image would instead make that single shared row's digest a
 * function of whichever scan last touched it: image A stamps f(A), image B
 * recomputes f(B), and every alternating scan logs a FINGERPRINT_MISMATCH on
 * unchanged code — turning the one divergence-evidence channel shadow mode has
 * into noise, and, after the matching switch-over, making a row's identity
 * oscillate. `det.detectedImage = image` re-points the row at the latest scan
 * on every ingestion, so even reading the image off the row would be reading a
 * mutable pointer.
 *
 * Two images DO get distinct fingerprints whenever they get distinct rows: for
 * OS packages Trivy's `target` embeds the image reference, so two images give
 * two package rows, two detection rows and two digests. The residue — two
 * images sharing a lang-pkgs manifest path — is a DATA-MODEL gap (the package
 * and detection tables are not scoped per image) that no digest can close, and
 * is tracked as such rather than papered over with a component that contradicts
 * the row it stamps.
 *
 * "Mirrors the row EXACTLY" is a statement about faithfulness, NOT about
 * stability, and the difference is the whole of what follows. `target` carries
 * the image reference INCLUDING its tag for class='os-pkgs'
 * (`registry/app:1.0.0 (debian 12.5)`) and `upsertPackage` keys on it, so a
 * re-tag that really does create a new package row also yields a new
 * fingerprint. In a per-commit-tag pipeline that is EVERY os-pkgs finding on
 * EVERY scan: first-seen and dismissal state cannot accumulate for that family.
 * That is the row churning, not the digest drifting — the digest has no freedom
 * to do better while it mirrors a key that contains the tag — but it is a real
 * reporting gap and it is the reason the two halves of the requirement "two
 * images in one project produce different fingerprints" land differently:
 *
 * - os-pkgs: two images -> two rows -> two fingerprints. Requirement MET, at
 *   the cost of a new identity per tag.
 * - lang-pkgs: two images -> ONE row -> ONE finding, attributed to whichever
 *   image scanned last. Requirement UNMET, and unmeetable here.
 *
 * Both are consequences of the package/detection tables not being scoped per
 * image. The fix is one decision — key those tables on a tag-stripped image
 * reference — which is a migration and a change to what users see as one
 * finding. It belongs to whoever flips fingerprints from shadow to
 * authoritative, and must be taken BEFORE that flip: afterwards the same change
 * also rewrites stored identities. Pinned in `container.fingerprint.spec.ts`.
 */
export interface ContainerFingerprintInput {
  projectId: string;
  branch: string | null;
  packageName: string;
  packageVersion: string;
  target: string | null;
  class: string | null;
  arch: string | null;
  vulnerabilityIdentifier: string;
}

export function computeContainerFingerprint(
  input: ContainerFingerprintInput,
): string {
  return digest([
    FINGERPRINT_VERSION,
    input.projectId,
    input.branch,
    'container',
    input.packageName,
    input.packageVersion,
    input.target,
    input.class,
    input.arch,
    input.vulnerabilityIdentifier,
  ]);
}
