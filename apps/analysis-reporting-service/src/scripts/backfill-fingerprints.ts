/**
 * One-time backfill: stamp `fingerprint` on every detection row that predates
 * the column, for all six detection families.
 *
 * Usage:
 *   cd analysis-reporting-service
 *   pnpm exec ts-node src/scripts/backfill-fingerprints.ts            # backfill + collision report
 *   pnpm exec ts-node src/scripts/backfill-fingerprints.ts --report   # collision report only
 *   pnpm exec ts-node src/scripts/backfill-fingerprints.ts --dry-run  # compute + check, write nothing
 *   pnpm exec ts-node src/scripts/backfill-fingerprints.ts --table=sast
 *
 * `--dry-run` runs every SELECT, the ranking and the duplicate check, and
 * reports what it WOULD write without issuing a single UPDATE. It is the safe
 * way to obtain the per-table `backfilled / refused` numbers on a customer
 * database before deciding whether the UNIQUE index can be created. Two things
 * it reports differently from a real run, both by construction:
 *   - `backfilled` counts INTENDED writes, not observed `affectedRows`, so it
 *     is an upper bound (a concurrent stamp can take one away).
 *   - the collision report describes the table AS IT IS NOW — nothing was
 *     written — so it is a statement about the existing digests, not about the
 *     post-backfill state. The refusal counters carry that signal instead.
 * Cross-chunk duplicates ARE detected in a dry run: the claims a chunk would
 * make are carried forward in memory, standing in for the UPDATE that a real
 * run's next chunk would have seen.
 *
 * WHAT GATES THE UNIQUE INDEX: `0 colliding groups`. NOT `0 refusals` — a
 * naturally part-stamped table produces refusals BY DESIGN (that is what a
 * refusal is for), so gating on zero of them is unsatisfiable. Read the refusal
 * counts as the size of the hole being accepted; every refused row stays NULL
 * and is stamped correctly by its next scan.
 *
 * `FINGERPRINT_BACKFILL_PAGE_SIZE` (default 2000) overrides the page size. It
 * exists so the group-boundary paging can be EXERCISED — every local table fits
 * in one default page, which is exactly the condition under which the mid-group
 * cut this script guards against stays invisible. It is also the knob for a
 * large customer table: the code-family SELECT deliberately reads stamped rows
 * too, so the page count scales with the TOTAL row count, and each page is a
 * scan + filesort (every ordering column is `COLLATE utf8mb4_bin`, which no
 * index provides). Raise it there rather than lower it.
 *
 * Safe to re-run: a write is only ever issued for a row whose `fingerprint` is
 * NULL, and only when the digest is not already held by another row, so a
 * stored digest is never overwritten (overwriting one would hide the very drift
 * shadow mode exists to measure). NOTE that the code-family SELECT reads the
 * whole table, stamped rows included — see `backfillCodeTable`; that is what
 * makes the ranking correct, and it is not a re-write of anything.
 *
 * WHY IT DOES NOT BOOT NEST: the application context loads its secrets through
 * the edition's secrets source and every module with them, so a one-off has to
 * construct its own connection. This mirrors `src/core/config/data-source.ts`.
 *
 * WHY IT IMPORTS THE DIGEST RATHER THAN REIMPLEMENTING IT: the value written
 * here must be byte-identical to the one the ingestion path stamps for the same
 * row, or the next scan logs a FINGERPRINT_MISMATCH on unchanged code. Every
 * hashing and ordering primitive comes from
 * `../modules/findings-export/fingerprint.util`; nothing is re-derived.
 */
import { DataSource } from 'typeorm';
import { requiredEnv } from './required-env';
import {
  assignOccurrenceIndexes,
  codeOccurrenceKey,
  computeCodeFingerprint,
  computeContainerFingerprint,
  computeScaFingerprint,
  encodeComponent,
  normalizeOccurrenceLine,
  normalizePath,
  occurrenceTieBreak,
  SnippetLine,
} from '../modules/findings-export/fingerprint.util';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a DB — see backfill-fingerprints.spec.ts)
// ---------------------------------------------------------------------------

export interface GroupKeyed {
  projectId: string;
  branch: string | null;
  path: string;
}

/**
 * Index of the first row of the trailing partial group, or rows.length when the
 * page is the last one (nothing can extend the tail group any more).
 *
 * Cutting mid-group would restart the occurrence counter at 0 for the second
 * half and mint duplicate fingerprints — the exact collisions the UNIQUE index
 * forbids.
 *
 * The key is length-prefixed with `encodeComponent`, like every other key in
 * this feature. A raw `${projectId}${branch}${path}` concatenation lets the
 * boundary between two components shift, so ('p', '1', 'a.ts') and
 * ('p1', '', 'a.ts') — two different groups — spell one key. That does not
 * merely cost a page growth: it makes the function report a tail group that is
 * not one, and the caller then cuts the page in a place that restarts the
 * occurrence counter mid-group.
 */
export function lastCompleteGroupBoundary(
  rows: GroupKeyed[],
  hasMorePages: boolean,
): number {
  if (!hasMorePages || rows.length === 0) return rows.length;
  const key = (r: GroupKeyed) =>
    encodeComponent(r.projectId) +
    encodeComponent(r.branch ?? '') +
    encodeComponent(r.path);
  const tail = key(rows[rows.length - 1]);
  let i = rows.length;
  while (i > 0 && key(rows[i - 1]) === tail) i--;
  return i;
}

export interface CodeDetectionRow {
  id: string;
  projectId: string;
  branch: string | null;
  scannerType: string;
  catalogVulnId: string;
  path: string;
  language?: string | null;
  vulnerableStartLine: number;
  vulnerableEndLine: number;
  snippetJson: unknown;
  /** The digest already stored on the row, or NULL/absent when unstamped. */
  fingerprint?: string | null;
  /** The scan that last SAW this row (`vulnerability_detection_history`). */
  lastScanId?: string | null;
  /** When that scan saw it; used only to order two sighting cohorts. */
  lastSeenAt?: Date | string | null;
  /**
   * DELIBERATELY NOT SELECTED AND NOT READ. It is here so the rule survives the
   * next reader: `currentState = 'resolved'` is NOT evidence that a scan
   * stopped seeing a row — on `vulnerability_detections_secret` it can only
   * ever mean a person closed it — and treating it as a sighting signal
   * re-creates the duplicate-digest Critical. See `sightingCohortOf`.
   */
  currentState?: string | null;
}

export interface FingerprintAssignment {
  id: string;
  fingerprint: string;
}

/**
 * The page size, validated. It is interpolated straight into `LIMIT ${n}` — no
 * driver placeholder accepts a LIMIT — so it has to be an integer, not merely
 * a number: `2.5`, `1e3`, `Infinity` and `NaN` all survive `Number()` and would
 * reach MySQL as text.
 */
export function parsePageSize(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const s = String(raw).trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `FINGERPRINT_BACKFILL_PAGE_SIZE must be a positive integer (it is ` +
        `interpolated into LIMIT, where no placeholder is accepted); got '${s}'`,
    );
  }
  return n;
}

/**
 * Drop every assignment whose digest is not free.
 *
 * Ranking the whole bucket (see `buildCodeFingerprintRows`) removes the CAUSE
 * of a duplicate digest. This refuses the EFFECT wherever it survives the
 * cause: a stored digest that is itself mis-stamped (production logs those as
 * `FINGERPRINT_COLLISION`), a bucket the input genuinely cannot separate, a
 * sighting cohort that lost the ranking. A refused row keeps its NULL — a hole
 * self-heals on the next scan, a duplicate identity never does.
 *
 * Two assignments carrying ONE digest refuse each OTHER: there is no ground on
 * which to prefer either, and writing one would make the choice depend on page
 * order.
 *
 * @param claimedBy - digest -> the id of the row already holding it. A digest
 *   claimed by the row itself is not a conflict; that is what makes a re-run a
 *   no-op rather than a mass refusal.
 */
export function refuseClaimedFingerprints(
  assignments: FingerprintAssignment[],
  claimedBy: ReadonlyMap<string, string>,
): { write: FingerprintAssignment[]; refused: FingerprintAssignment[] } {
  const occurrences = new Map<string, number>();
  for (const a of assignments) {
    occurrences.set(a.fingerprint, (occurrences.get(a.fingerprint) ?? 0) + 1);
  }

  const write: FingerprintAssignment[] = [];
  const refused: FingerprintAssignment[] = [];
  for (const a of assignments) {
    const holder = claimedBy.get(a.fingerprint);
    const conflict =
      (occurrences.get(a.fingerprint) ?? 0) > 1 ||
      (holder !== undefined && holder !== a.id);
    (conflict ? refused : write).push(a);
  }
  return { write, refused };
}

/**
 * `code_snippet.code` is a JSON column holding `JSON.stringify(dto.code)` (see
 * `SastIacUtilsService.addCodeSnippetToDetection`), i.e. a JSON *string* whose
 * content is the array. The driver therefore hands back a JS string that has to
 * be parsed a second time. Anything that does not end in an array — a legacy
 * plain string, a truncated value, NULL — yields an empty region rather than
 * throwing: one unparseable snippet must not abort a 3 000-row backfill.
 */
export function parseSnippetLines(raw: unknown): SnippetLine[] {
  let value: unknown = raw;
  for (let i = 0; i < 3 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as SnippetLine[]) : [];
}

/**
 * The bucket a code-family row is ranked in.
 *
 * `codeOccurrenceKey` carries (catalogue vuln id, normalised path, normalised
 * snippet) — the digest components that vary WITHIN one scan. The scope prefix
 * adds the three the digest also hashes but a live scan holds constant:
 * projectId and branch (a scan is one project on one branch) and scannerType
 * (the Redis allocator is scoped per scan AND scanner).
 *
 * Deliberately not the coarser key
 * `projectId + branch + catalogVulnId + path + snippet` — it omits
 * `scannerType`. That omission is collision-safe (a coarser bucket still
 * separates every pair that would collide) but it is NOT faithful: two rows
 * differing only in scanner would be ranked 0 and 1 here while a re-scan ranks
 * both 0, so the second row's backfilled digest is one no scan reproduces and
 * every later scan logs a FINGERPRINT_MISMATCH against it. The dispatch
 * guidance — "byte-identical fingerprints to what the ingestion path stamps" —
 * takes precedence, so the scope mirrors the allocator's exactly.
 */
function codeBucketKey(row: CodeDetectionRow, lines: SnippetLine[]): string {
  return (
    encodeComponent(row.projectId) +
    encodeComponent(row.branch ?? '') +
    encodeComponent(row.scannerType) +
    codeOccurrenceKey({
      catalogVulnId: row.catalogVulnId,
      path: row.path,
      snippetLines: lines,
      vulnerableStartLine: row.vulnerableStartLine,
      vulnerableEndLine: row.vulnerableEndLine,
    })
  );
}

/** The cohort of every row with no `vulnerability_detection_history` row. */
const UNTRAILED = 'untrailed';

/**
 * The sighting cohort a row belongs to — the set of rows a single scan saw.
 *
 * The live counter is `ScanQueueService.allocateOccurrenceIndexes`, a Redis
 * `hincrby` keyed on (queueType, scanId, scannerName, group). It restarts at 0
 * for every scan, so a scan ranks EXACTLY the findings it saw and nothing else.
 * Reproducing an index therefore means reproducing that population, not the
 * table's.
 *
 * `vulnerability_detection_history` is the sighting trail, and it is the ONLY
 * evidence this script accepts. It is written for sast and iac; cicd has only
 * just started writing it and secret NEVER does —
 * `addVulnerabilityDetectionHistory` has no `SecretVulnerabilityDetections`
 * branch. A row with no trail gets the single `untrailed` cohort, and
 * `buildCodeFingerprintRows` refuses to rank an untrailed bucket that has more
 * than one member.
 *
 * `currentState` IS NOT EVIDENCE, and the earlier cut of this function that
 * treated `resolved` as "a re-scan stopped seeing it" was not merely weak — on
 * the one family it was written for it is uncorrelated with the signal it
 * stands in for, and it re-created the Critical this script exists to fix:
 *
 *   `vulnerability_detections_secret` has NO auto-resolve-on-disappearance.
 *   `markResolved`'s parameter union is Sast|Iac|Cicd, and the only two writers
 *   of `resolved` on that table are `rotateSecret` and `handleUpdateSecret` —
 *   both human decisions. So `resolved` there means "a person closed it", never
 *   "the scanner stopped seeing it": the last scan ranked that row together
 *   with its twins. Dropping it from the population re-ranks the survivors from
 *   0 and writes the closed row's exact digest onto a live one (the digest does
 *   not hash the line number, so for secret and cicd — whose vulnerable region
 *   normalises to '' — the occurrence index is the only thing separating two
 *   twins). On the all-NULL corpus this backfill exists for, nothing yet claims
 *   that digest, so no guard catches it and the theft is permanent.
 *
 * A hole self-heals on the next scan; a stolen identity does not. So where the
 * population is not derivable the rows are left NULL — the rule, and
 * the reason `cicd`/`secret` multi-member buckets are refused wholesale.
 */
function sightingCohortOf(row: CodeDetectionRow): string {
  return row.lastScanId ? `scan:${row.lastScanId}` : UNTRAILED;
}

/** -Infinity when unknown, so a cohort with no clock always loses on time. */
function sightingTimeOf(row: CodeDetectionRow): number {
  const t = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Evidence beats no evidence, on the one path where the clock cannot decide.
 * `detectedAt` is NOT NULL, so a named scan always carries a time and this only
 * arbitrates a named scan against `untrailed` (whose time is -Infinity by
 * construction) — never one named scan against another.
 */
function cohortPreference(cohort: string): number {
  return cohort === UNTRAILED ? 0 : 1;
}

interface CohortCandidate {
  cohort: string;
  seenAt: number;
  preference: number;
}

/**
 * TIME FIRST, and the order of these three lines is load-bearing. Scan ids are
 * UUIDs, so the lexical last resort is uncorrelated with time: dropping the
 * `seenAt` comparison would let an OLDER scan's cohort win roughly half the
 * mixed-cohort buckets, stamping rows no scan will ever rank again and leaving
 * the live ones NULL. Pinned by 'picks the most recent scan by time, not by
 * scan id order', whose ids sort the opposite way to their timestamps.
 */
function betterCohort(a: CohortCandidate, b: CohortCandidate): boolean {
  if (a.seenAt !== b.seenAt) return a.seenAt > b.seenAt;
  if (a.preference !== b.preference) return a.preference > b.preference;
  return a.cohort > b.cohort; // total order, so the choice cannot depend on page order
}

/**
 * One fingerprint per UNSTAMPED row, with the occurrence index allocated over
 * the population a live scan would have ranked.
 *
 * TWO properties, and the whole task rests on both being simultaneously true.
 *
 * 1. THE WHOLE BUCKET IS RANKED, STAMPED ROWS INCLUDED. The caller must pass
 *    every row of a bucket, not only the NULL ones — see
 *    `lastCompleteGroupBoundary` for the paging rule that guarantees it, and
 *    the SELECT in `backfillCodeTable`, which deliberately does NOT filter on
 *    `fingerprint IS NULL`. A bucket in production is routinely PART stamped:
 *    a post-deploy scan re-detects the twin at line 10 and stamps it index 0,
 *    while the twin at line 400 is `resolved` and stays NULL. Ranking only the
 *    NULL half restarts the counter at 0 and writes line 10's exact digest onto
 *    line 400 — one identity on two rows, which `AND fingerprint IS NULL` on
 *    the UPDATE does nothing to prevent because it only protects the row that
 *    already had the value.
 *
 * 2. THE POPULATION IS RESTRICTED TO ONE SIGHTING COHORT. Ranking the whole
 *    TABLE is equally wrong in the other direction: bucket {A last seen by
 *    scan 1, B by scan 2} ranks A=0 and B=1, while scan 2 saw only B and ranked
 *    it 0 — so B's stored digest is one no scan can reproduce, a permanent
 *    FINGERPRINT_MISMATCH on unchanged code. Only the cohort the most recent
 *    scan saw is ranked; every other member is left NULL and reported as
 *    refused. See `sightingCohortOf` for what counts as evidence — the trail,
 *    and nothing else.
 *
 *    WHERE THERE IS NO TRAIL THE BUCKET IS REFUSED, not guessed at. A bucket of
 *    one is still stamped: any scan that saw that row ranked it 0 and no other
 *    member can shift it. But a multi-member untrailed bucket has no evidence
 *    of which rows the last scan saw, and every way of inventing some — the
 *    `currentState` proxy the previous cut used above all — writes an identity
 *    the ingestion path may never reproduce. That costs coverage on cicd and
 *    secret (the two families with no trail); the rows stay NULL until their
 *    next scan stamps them correctly, which is a hole deliberately
 *    preferred to a wrong value.
 *
 * The ordering inside a cohort (`normalizeOccurrenceLine` for the line,
 * `occurrenceTieBreak` over [endLine, language] for the tie) is byte-for-byte
 * the one `SastIacService.computeOccurrenceIndexes` feeds the allocator.
 *
 * @returns assignments for the unstamped rows of the winning cohort only. A row
 *   this function omits is a row it refuses to guess at; the caller counts the
 *   difference (`rows with a NULL fingerprint` minus `assignments`) and reports
 *   it. Never treat an omission as index 0.
 */
export function buildCodeFingerprintRows(
  rows: CodeDetectionRow[],
): FingerprintAssignment[] {
  const lines = rows.map((r) => parseSnippetLines(r.snippetJson));
  // Paired up front rather than looked up by `indexOf` inside the key function:
  // two rows can be the SAME object reference (a caller passing one row twice),
  // and `indexOf` would then hand both the first row's snippet.
  const entries = rows.map((row, i) => ({
    row,
    lines: lines[i],
    bucket: codeBucketKey(row, lines[i]),
    cohort: sightingCohortOf(row),
  }));

  const winner = new Map<string, CohortCandidate>();
  for (const e of entries) {
    const candidate: CohortCandidate = {
      cohort: e.cohort,
      seenAt: sightingTimeOf(e.row),
      preference: cohortPreference(e.cohort),
    };
    const current = winner.get(e.bucket);
    if (!current || betterCohort(candidate, current)) {
      winner.set(e.bucket, candidate);
    }
  }

  const inWinningCohort = entries.filter(
    (e) => e.cohort === winner.get(e.bucket)?.cohort,
  );
  // A bucket with no sighting trail and more than one member: the population is
  // not derivable, so the whole bucket is refused rather than ranked on a guess.
  const untrailedBucketSize = new Map<string, number>();
  for (const e of inWinningCohort) {
    if (e.cohort !== UNTRAILED) continue;
    untrailedBucketSize.set(
      e.bucket,
      (untrailedBucketSize.get(e.bucket) ?? 0) + 1,
    );
  }
  const rankable = inWinningCohort.filter(
    (e) => e.cohort !== UNTRAILED || untrailedBucketSize.get(e.bucket) === 1,
  );

  const indexes = assignOccurrenceIndexes(
    rankable,
    (e) => e.bucket,
    (e) => normalizeOccurrenceLine(e.row.vulnerableStartLine ?? 0),
    (e) =>
      occurrenceTieBreak([e.row.vulnerableEndLine ?? '', e.row.language ?? '']),
  );

  const out: FingerprintAssignment[] = [];
  rankable.forEach((e, i) => {
    // A stamped row is ranked — that is the whole point of property 1 — but
    // never rewritten: overwriting a stored digest would erase the divergence
    // evidence shadow mode exists to collect.
    if (e.row.fingerprint) return;
    out.push({
      id: e.row.id,
      fingerprint: computeCodeFingerprint({
        projectId: e.row.projectId,
        branch: e.row.branch ?? null,
        scannerType: e.row.scannerType,
        catalogVulnId: e.row.catalogVulnId,
        path: e.row.path,
        snippetLines: e.lines,
        vulnerableStartLine: e.row.vulnerableStartLine,
        vulnerableEndLine: e.row.vulnerableEndLine,
        occurrenceIndex: indexes[i],
      }),
    });
  });
  return out;
}

export interface ScaDetectionRow {
  id: string;
  projectId: string;
  branch: string | null;
  ecosystem: string;
  packageName: string;
  packageVersion: string;
  osvId: string;
}

export function buildScaFingerprintRows(
  rows: ScaDetectionRow[],
): FingerprintAssignment[] {
  return rows.map((r) => ({
    id: r.id,
    fingerprint: computeScaFingerprint({
      projectId: r.projectId,
      branch: r.branch ?? null,
      ecosystem: r.ecosystem,
      packageName: r.packageName,
      packageVersion: r.packageVersion,
      osvId: r.osvId,
    }),
  }));
}

export interface ContainerDetectionRow {
  id: string;
  projectId: string;
  branch: string | null;
  packageName: string;
  packageVersion: string;
  target: string | null;
  packageClass: string | null;
  arch: string | null;
  vulnerabilityIdentifier: string;
}

export function buildContainerFingerprintRows(
  rows: ContainerDetectionRow[],
): FingerprintAssignment[] {
  return rows.map((r) => ({
    id: r.id,
    fingerprint: computeContainerFingerprint({
      projectId: r.projectId,
      // The branch component comes from the DETECTION ROW, never from the image
      // — `ContainerService.upsertDetection` computes it as `det.branch ?? null`
      // and `vulnerability_detections_container` has its own `branch` column.
      // (The branch is NOT joined from `container_detected_images`: this table
      // has its own, and joining the image would contradict the row the digest
      // stamps.)
      branch: r.branch ?? null,
      packageName: r.packageName,
      packageVersion: r.packageVersion,
      target: r.target ?? null,
      class: r.packageClass ?? null,
      arch: r.arch ?? null,
      vulnerabilityIdentifier: r.vulnerabilityIdentifier,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const CODE_TABLES = {
  sast: {
    table: 'vulnerability_detections_sast',
    snippetFk: 'sastVulnerabilityDetectionId',
    historyFk: 'sastVulnerabilityDetectionId',
  },
  iac: {
    table: 'vulnerability_detections_iac',
    snippetFk: 'iacVulnerabilityDetectionId',
    historyFk: 'iacVulnerabilityDetectionId',
  },
  cicd: {
    table: 'vulnerability_detections_cicd',
    snippetFk: 'cicdVulnerabilityDetectionId',
    historyFk: 'cicdVulnerabilityDetectionId',
  },
  secret: {
    table: 'vulnerability_detections_secret',
    snippetFk: 'secretVulnerabilityDetectionId',
    historyFk: 'secretVulnerabilityDetectionId',
  },
} as const;

const SCA_TABLE = 'vulnerability_detections_sca';
const CONTAINER_TABLE = 'vulnerability_detections_container';

const DEFAULT_PAGE_SIZE = 2000;
const MAX_PAGE_SIZE = 512_000;
const UPDATE_CHUNK = 500;

interface TableOutcome {
  table: string;
  backfilled: number;
  /** Rows the ranking population could not be established for. */
  refusedPopulation: number;
  /** Rows whose digest is already held by a different row of the project. */
  refusedDuplicate: number;
  skipped: number;
  skipReason: string;
  collidingGroups: number;
  collisionSamples: string[];
}

interface WriteOutcome {
  written: number;
  refusedDuplicate: number;
  samples: string[];
}

function buildDataSource(): DataSource {
  return new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3308),
    username: process.env.DB_USERNAME ?? 'user',
    password: requiredEnv('DB_PASSWORD'),
    database: process.env.DB_DATABASE ?? 'cybedefend_analysis_and_reporting',
    entities: [],
    migrations: [],
    synchronize: false,
  });
}

/** `?, ?, ?` for n parameters. */
const placeholders = (n: number) => new Array(n).fill('?').join(', ');

/**
 * Write the assignments whose digest is still free.
 *
 * The claim check is a real query against the table, not an in-memory belief:
 * `AND fingerprint IS NULL` on the UPDATE protects the row that already HOLDS a
 * digest, and does nothing at all to stop a second row being given the same
 * one. That is the whole of the Critical this script was rewritten for, and it
 * is the reason the check lives here rather than only in the ranking — the
 * ranking removes the cause, this refuses whatever survives it. It mirrors
 * `SastIacUtilsService.fingerprintClaimedElsewhere`, which does exactly this on
 * the ingestion path and logs `FINGERPRINT_COLLISION`.
 *
 * @param simulated - claims made by earlier chunks of a `--dry-run`. A real run
 *   needs none: chunk n's UPDATE has landed by the time chunk n+1 queries, so a
 *   digest duplicated ACROSS chunks is caught by the table itself. A dry run
 *   writes nothing, so without this it can only see duplicates inside one
 *   500-row chunk — and `--dry-run` is precisely the mode the pre-flight on a
 *   customer database runs in, so its refusal count has to mean the same thing
 *   as a real run's.
 */
export async function applyFingerprints(
  ds: DataSource,
  table: string,
  assignments: FingerprintAssignment[],
  dryRun: boolean,
  simulated: Map<string, string> = new Map(),
): Promise<WriteOutcome> {
  const out: WriteOutcome = { written: 0, refusedDuplicate: 0, samples: [] };

  for (let i = 0; i < assignments.length; i += UPDATE_CHUNK) {
    const chunk = assignments.slice(i, i + UPDATE_CHUNK);

    const holders: Array<{ id: string; fingerprint: string }> = await ds.query(
      `SELECT id, fingerprint FROM \`${table}\`
        WHERE fingerprint IN (${placeholders(chunk.length)})`,
      chunk.map((a) => a.fingerprint),
    );
    const claimedBy = new Map(holders.map((h) => [h.fingerprint, h.id]));
    for (const [digest, id] of simulated) {
      if (!claimedBy.has(digest)) claimedBy.set(digest, id);
    }

    const { write, refused } = refuseClaimedFingerprints(chunk, claimedBy);
    out.refusedDuplicate += refused.length;
    for (const r of refused.slice(0, Math.max(0, 10 - out.samples.length))) {
      out.samples.push(
        `det=${r.id} digest=${r.fingerprint} heldBy=${claimedBy.get(r.fingerprint) ?? 'another row of this batch'}`,
      );
    }
    if (write.length === 0) continue;
    if (dryRun) {
      // `written` is an INTENDED write here, not an observed `affectedRows`:
      // a real run can lose one to a concurrent stamp, so the dry-run figure is
      // an upper bound.
      for (const a of write) simulated.set(a.fingerprint, a.id);
      out.written += write.length;
      continue;
    }

    const cases = write.map(() => 'WHEN ? THEN ?').join(' ');
    const params: string[] = [];
    for (const a of write) params.push(a.id, a.fingerprint);
    for (const a of write) params.push(a.id);
    // `AND fingerprint IS NULL` keeps the script re-runnable and makes it
    // impossible to overwrite a digest an ingestion already stamped.
    const result = await ds.query(
      `UPDATE \`${table}\` SET fingerprint = CASE id ${cases} END
        WHERE id IN (${placeholders(write.length)}) AND fingerprint IS NULL`,
      params,
    );
    out.written += Number(result?.affectedRows ?? write.length);
  }
  return out;
}

/**
 * The page cut keys on the RAW path (that is what the SQL ORDER BY can sort on)
 * while the digest bucket keys on the NORMALISED one. The two agree unless one
 * (project, branch, scanner) spells a single file two ways ('./a.ts' and
 * 'a.ts'), in which case one digest group is spread over two non-adjacent runs
 * and a page cut could split it.
 *
 * That is cheap to EXCLUDE rather than hand-wave: the distinct path set is tiny
 * next to the row count. If any ambiguity exists the table is refused outright,
 * because minting a possible duplicate is worse than not running.
 */
async function assertNormalizedPathsUnambiguous(
  ds: DataSource,
  table: string,
): Promise<void> {
  const rows: Array<{
    projectId: string;
    branch: string | null;
    scannerType: string;
    path: string;
  }> = await ds.query(
    // Every row, not only the unstamped ones: the page now carries the whole
    // bucket (see `backfillCodeTable`), so a split could separate an unstamped
    // row from the stamped twin it must be ranked against. Catalogue-less rows
    // ARE excluded, because the paged SELECT excludes them too — refusing a
    // whole table over an ambiguity confined to rows the backfill never reads
    // would be a false alarm.
    `SELECT DISTINCT projectId, branch, scannerType, path FROM \`${table}\`
      WHERE vulnerabilityId IS NOT NULL`,
  );
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const r of rows) {
    const key = `${r.projectId}|${r.branch ?? ''}|${r.scannerType}|${normalizePath(r.path)}`;
    const previous = seen.get(key);
    if (previous !== undefined && previous !== r.path) {
      clashes.push(`${key} <- '${previous}' and '${r.path}'`);
    } else {
      seen.set(key, r.path);
    }
  }
  if (clashes.length > 0) {
    throw new Error(
      `${table}: ${clashes.length} raw paths normalise onto another path in the ` +
        `same (project, branch, scanner). The group-boundary page cut keys on the ` +
        `raw path, so a digest group could be split. Refusing to backfill this ` +
        `table.\n  ${clashes.slice(0, 10).join('\n  ')}`,
    );
  }
}

/**
 * Attach the scan that last SAW each row of one page, from
 * `vulnerability_detection_history`.
 *
 * Scoped to the page's ids and served by the FK index the table already carries
 * (`FK_…(<family>VulnerabilityDetectionId)`), so the trail costs one indexed
 * lookup per page instead of one full aggregation of the history table per page
 * — which is what an uncorrelated derived table joined into the paged SELECT
 * costs, on the very databases where the pre-flight has to run.
 *
 * MAX over `CONCAT(detectedAt, '|', scanId)` rather than a correlated subquery
 * on MAX(detectedAt): `detectedAt` is a fixed-width DATETIME so the
 * concatenation orders on the date first, and it returns exactly ONE row per
 * detection even when two scans share a second — a subquery would return both
 * and duplicate the detection in the page. RESIDUE: `detectedAt` has precision
 * 0, so for two scans within one second the winner is decided by the scan id,
 * i.e. arbitrarily. It costs a cohort choice between two scans that touched one
 * detection in the same second, never a wrong digest for a whole bucket.
 */
async function attachSightings(
  ds: DataSource,
  historyFk: string,
  rows: CodeDetectionRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const stamps: Array<{ detId: string; stamp: string }> = await ds.query(
    `SELECT \`${historyFk}\` AS detId,
            MAX(CONCAT(detectedAt, '|', scanId)) AS stamp
       FROM vulnerability_detection_history
      WHERE \`${historyFk}\` IN (${placeholders(rows.length)})
      GROUP BY \`${historyFk}\``,
    rows.map((r) => r.id),
  );
  const byId = new Map(stamps.map((s) => [s.detId, s.stamp]));
  for (const r of rows) {
    const stamp = byId.get(r.id);
    if (!stamp) continue;
    // The separator is the FIRST '|': `detectedAt` cannot contain one, so this
    // is `SUBSTRING_INDEX(stamp, '|', 1)` for the date and everything after it
    // for the id — which is safe even for a scanId that contains a '|'.
    const cut = stamp.indexOf('|');
    r.lastSeenAt = stamp.slice(0, cut);
    r.lastScanId = stamp.slice(cut + 1);
  }
}

export async function backfillCodeTable(
  ds: DataSource,
  key: keyof typeof CODE_TABLES,
  dryRun: boolean,
  initialPageSize: number,
): Promise<{
  backfilled: number;
  refusedPopulation: number;
  refusedDuplicate: number;
  skipped: number;
  samples: string[];
}> {
  const { table, snippetFk, historyFk } = CODE_TABLES[key];
  await assertNormalizedPathsUnambiguous(ds, table);

  const [{ n: skipped }] = await ds.query(
    `SELECT COUNT(*) n FROM \`${table}\` WHERE fingerprint IS NULL AND vulnerabilityId IS NULL`,
  );

  let pageSize = initialPageSize;
  let cursor: [string, string, string, string] = ['', '', '', ''];
  let backfilled = 0;
  let refusedPopulation = 0;
  let refusedDuplicate = 0;
  const samples: string[] = [];
  // Carries a `--dry-run`'s own claims from one page (and one chunk) to the
  // next; empty and unused in a real run, where the table itself carries them.
  const simulatedClaims = new Map<string, string>();

  for (;;) {
    // MySQL 8 row-value comparison. Every ordering column is collated
    // utf8mb4_bin: the default utf8mb4_0900_ai_ci treats 'a.ts' and 'A.ts' (or
    // 'cafe.ts' and 'café.ts') as EQUAL, so it may interleave two distinct
    // paths and break the contiguity `lastCompleteGroupBoundary` depends on.
    //
    // THERE IS DELIBERATELY NO `d.fingerprint IS NULL` PREDICATE HERE, and it
    // is the single most important line of this file. Filtering it out returns
    // only the unstamped half of a part-stamped bucket, which
    // `buildCodeFingerprintRows` then ranks from 0 — re-minting the digest the
    // stamped half already holds. The whole bucket is read; the UPDATE's own
    // `AND fingerprint IS NULL` is what keeps stored digests untouched.
    //
    // The sighting trail is fetched SEPARATELY, per page (see `attachSightings`
    // below), not joined in here. An uncorrelated derived table
    // (`GROUP BY <fk>` over the whole history table) is re-materialised on
    // every page query, so the cost of the trail was one full aggregation of
    // `vulnerability_detection_history` PER PAGE — and since this SELECT
    // deliberately reads stamped rows too, the page count now scales with the
    // total row count, not the unstamped one. The two multiply.
    const page: CodeDetectionRow[] = await ds.query(
      `SELECT d.id, d.projectId, d.branch, d.scannerType,
              d.vulnerabilityId AS catalogVulnId, d.path, d.language,
              d.vulnerableStartLine, d.vulnerableEndLine, d.fingerprint,
              s.code AS snippetJson
         FROM \`${table}\` d
         LEFT JOIN code_snippet s ON s.\`${snippetFk}\` = d.id
        WHERE d.vulnerabilityId IS NOT NULL
          AND (d.projectId COLLATE utf8mb4_bin,
               COALESCE(d.branch, '') COLLATE utf8mb4_bin,
               d.path COLLATE utf8mb4_bin,
               d.id COLLATE utf8mb4_bin) > (?, ?, ?, ?)
        ORDER BY d.projectId COLLATE utf8mb4_bin,
                 COALESCE(d.branch, '') COLLATE utf8mb4_bin,
                 d.path COLLATE utf8mb4_bin,
                 d.id COLLATE utf8mb4_bin
        LIMIT ${pageSize}`,
      cursor,
    );
    if (page.length === 0) break;

    const cut = lastCompleteGroupBoundary(page, page.length === pageSize);
    if (cut === 0) {
      // The whole page is one (project, branch, path) run. Slicing it would
      // restart the occurrence counter mid-group, so grow the window instead of
      // making zero progress forever.
      if (pageSize >= MAX_PAGE_SIZE) {
        throw new Error(
          `${table}: a single (projectId, branch, path) group exceeds ${MAX_PAGE_SIZE} ` +
            `rows; refusing to page it, as any cut would duplicate occurrence indexes.`,
        );
      }
      pageSize *= 2;
      console.log(
        `  ${table}: page was one group, growing page to ${pageSize}`,
      );
      continue;
    }

    const slice = page.slice(0, cut);
    await attachSightings(ds, historyFk, slice);
    const assignments = buildCodeFingerprintRows(slice);
    // Every unstamped row of the slice that got no assignment is one whose
    // ranking population could not be established. It stays NULL on purpose —
    // and it is NAMED, not merely counted: on a naturally part-stamped table
    // this is the counter an operator EXPECTS to see move, so a bare number
    // gives them nothing to inspect before they decide on the unique index.
    const assigned = new Set(assignments.map((a) => a.id));
    for (const r of slice) {
      if (r.fingerprint || assigned.has(r.id)) continue;
      refusedPopulation++;
      if (samples.length < 10) {
        samples.push(
          `det=${r.id} left NULL: ranking population not derivable ` +
            `(no sighting trail, and its occurrence bucket has twins)`,
        );
      }
    }

    const outcome = await applyFingerprints(
      ds,
      table,
      assignments,
      dryRun,
      simulatedClaims,
    );
    backfilled += outcome.written;
    refusedDuplicate += outcome.refusedDuplicate;
    for (const s of outcome.samples) {
      if (samples.length < 10) samples.push(s);
    }

    const last = slice[slice.length - 1];
    cursor = [last.projectId, last.branch ?? '', last.path, last.id];
  }

  return {
    backfilled,
    refusedPopulation,
    refusedDuplicate,
    skipped: Number(skipped),
    samples,
  };
}

/**
 * sca and container. Their digests carry NO occurrence index — the package
 * coordinates plus the advisory already are the identity — so there is no
 * bucket to rank and the SELECT may safely read only the unstamped rows. They
 * still go through the duplicate guard: two rows sharing a digest here means
 * the underlying identity is genuinely duplicated in the table, which the
 * planned UNIQUE index would reject.
 */
async function backfillSimpleTable<T extends { id: string }>(
  ds: DataSource,
  table: string,
  select: (cursor: string, limit: number) => Promise<T[]>,
  build: (rows: T[]) => FingerprintAssignment[],
  dryRun: boolean,
  pageSize: number,
): Promise<{
  backfilled: number;
  refusedDuplicate: number;
  samples: string[];
}> {
  let cursor = '';
  let backfilled = 0;
  let refusedDuplicate = 0;
  const samples: string[] = [];
  const simulatedClaims = new Map<string, string>();
  for (;;) {
    const page = await select(cursor, pageSize);
    if (page.length === 0) break;
    const outcome = await applyFingerprints(
      ds,
      table,
      build(page),
      dryRun,
      simulatedClaims,
    );
    backfilled += outcome.written;
    refusedDuplicate += outcome.refusedDuplicate;
    for (const s of outcome.samples) {
      if (samples.length < 10) samples.push(s);
    }
    cursor = page[page.length - 1].id;
  }
  return { backfilled, refusedDuplicate, samples };
}

/**
 * The gate for an IRREVERSIBLE unique index, so the COUNT is its own uncapped
 * query. Reading `rows.length` off the sampled query — which is capped at 50 so
 * the printout stays readable — reports 50 for a database with 5 000 colliding
 * groups, and the summary line then prints that finite-sounding number as if it
 * were the whole story.
 */
export async function collisionReport(
  ds: DataSource,
  table: string,
  groupByBranch: boolean,
): Promise<{ collidingGroups: number; samples: string[] }> {
  const cols = groupByBranch
    ? 'projectId, branch, fingerprint'
    : 'projectId, fingerprint';
  const [{ n: collidingGroups }] = await ds.query(
    `SELECT COUNT(*) n FROM (
        SELECT ${cols} FROM \`${table}\` WHERE fingerprint IS NOT NULL
         GROUP BY ${cols} HAVING COUNT(*) > 1
     ) g`,
  );
  const rows: Array<{
    projectId: string;
    branch?: string | null;
    fingerprint: string;
    n: number;
  }> = await ds.query(
    `SELECT ${cols}, COUNT(*) n
       FROM \`${table}\` WHERE fingerprint IS NOT NULL
      GROUP BY ${cols} HAVING n > 1
      ORDER BY n DESC LIMIT 50`,
  );
  return {
    collidingGroups: Number(collidingGroups),
    samples: rows.map(
      (r) =>
        `projectId=${r.projectId}` +
        (groupByBranch ? ` branch=${r.branch ?? 'NULL'}` : '') +
        ` fingerprint=${r.fingerprint} n=${r.n}`,
    ),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const reportOnly = argv.includes('--report');
  const only = argv.find((a) => a.startsWith('--table='))?.split('=')[1];
  const wanted = (name: string) => !only || only === name;
  const pageSize = parsePageSize(
    process.env.FINGERPRINT_BACKFILL_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
  );

  const ds = buildDataSource();
  await ds.initialize();
  const outcomes: TableOutcome[] = [];

  try {
    for (const key of Object.keys(
      CODE_TABLES,
    ) as (keyof typeof CODE_TABLES)[]) {
      if (!wanted(key)) continue;
      const { table } = CODE_TABLES[key];
      let backfilled = 0;
      let refusedPopulation = 0;
      let refusedDuplicate = 0;
      let skipped = 0;
      if (!reportOnly) {
        const r = await backfillCodeTable(ds, key, dryRun, pageSize);
        backfilled = r.backfilled;
        refusedPopulation = r.refusedPopulation;
        refusedDuplicate = r.refusedDuplicate;
        skipped = r.skipped;
        for (const s of r.samples) console.log(`  REFUSED ${table}: ${s}`);
      }
      const c = await collisionReport(ds, table, true);
      outcomes.push({
        table,
        backfilled,
        refusedPopulation,
        refusedDuplicate,
        skipped,
        skipReason: 'no catalogue vulnerabilityId',
        collidingGroups: c.collidingGroups,
        collisionSamples: c.samples,
      });
      console.log(
        `${table}: backfilled ${backfilled}, refused ${refusedPopulation} ` +
          `(population) + ${refusedDuplicate} (duplicate), skipped ${skipped}`,
      );
    }

    if (wanted('sca')) {
      let backfilled = 0;
      let refusedDuplicate = 0;
      // Rows whose package row is gone cannot be fingerprinted: their
      // ecosystem/name/version components would all be empty, producing a digest
      // no scan reproduces AND one that two such rows sharing an advisory would
      // share. They stay NULL, exactly like the rest of the pre-column corpus.
      const [{ n: skipped }] = await ds.query(
        `SELECT COUNT(*) n FROM \`${SCA_TABLE}\` d
           LEFT JOIN sca_detected_packages p ON p.id = d.scaDetectedPackageId
          WHERE d.fingerprint IS NULL AND p.id IS NULL`,
      );
      if (!reportOnly) {
        const r = await backfillSimpleTable<ScaDetectionRow>(
          ds,
          SCA_TABLE,
          (cursor, limit) =>
            ds.query(
              `SELECT d.id, d.projectId, d.branch, p.ecosystem, p.packageName,
                      p.packageVersion, d.vulnerabilityId AS osvId
                 FROM \`${SCA_TABLE}\` d
                 JOIN sca_detected_packages p ON p.id = d.scaDetectedPackageId
                WHERE d.fingerprint IS NULL AND d.id > ?
                ORDER BY d.id LIMIT ${limit}`,
              [cursor],
            ),
          buildScaFingerprintRows,
          dryRun,
          pageSize,
        );
        backfilled = r.backfilled;
        refusedDuplicate = r.refusedDuplicate;
        for (const s of r.samples) console.log(`  REFUSED ${SCA_TABLE}: ${s}`);
      }
      const c = await collisionReport(ds, SCA_TABLE, true);
      outcomes.push({
        table: SCA_TABLE,
        backfilled,
        refusedPopulation: 0,
        refusedDuplicate,
        skipped: Number(skipped),
        skipReason: 'no sca_detected_packages row',
        collidingGroups: c.collidingGroups,
        collisionSamples: c.samples,
      });
      console.log(
        `${SCA_TABLE}: backfilled ${backfilled}, refused ${refusedDuplicate} ` +
          `(duplicate), skipped ${skipped}`,
      );
    }

    if (wanted('container')) {
      let backfilled = 0;
      let refusedDuplicate = 0;
      const [{ n: skipped }] = await ds.query(
        `SELECT COUNT(*) n FROM \`${CONTAINER_TABLE}\` d
           LEFT JOIN container_detected_packages p ON p.id = d.detectedPackageId
          WHERE d.fingerprint IS NULL AND p.id IS NULL`,
      );
      if (!reportOnly) {
        const r = await backfillSimpleTable<ContainerDetectionRow>(
          ds,
          CONTAINER_TABLE,
          (cursor, limit) =>
            ds.query(
              `SELECT d.id, d.projectId, d.branch, p.packageName, p.packageVersion,
                      p.target, p.\`class\` AS packageClass, p.arch,
                      d.vulnerabilityIdentifier
                 FROM \`${CONTAINER_TABLE}\` d
                 JOIN container_detected_packages p ON p.id = d.detectedPackageId
                WHERE d.fingerprint IS NULL AND d.id > ?
                ORDER BY d.id LIMIT ${limit}`,
              [cursor],
            ),
          buildContainerFingerprintRows,
          dryRun,
          pageSize,
        );
        backfilled = r.backfilled;
        refusedDuplicate = r.refusedDuplicate;
        for (const s of r.samples) {
          console.log(`  REFUSED ${CONTAINER_TABLE}: ${s}`);
        }
      }
      // Reported BOTH ways: (projectId, branch, fingerprint) is what the planned
      // UNIQUE index enforces; (projectId, fingerprint) is the coarser
      // cut. They can only differ if one project carries the same
      // digest on two branches, which the index permits by design.
      const byBranch = await collisionReport(ds, CONTAINER_TABLE, true);
      const byProject = await collisionReport(ds, CONTAINER_TABLE, false);
      outcomes.push({
        table: CONTAINER_TABLE,
        backfilled,
        refusedPopulation: 0,
        refusedDuplicate,
        skipped: Number(skipped),
        skipReason: 'no container_detected_packages row',
        collidingGroups: byBranch.collidingGroups,
        collisionSamples: byBranch.samples,
      });
      console.log(
        `${CONTAINER_TABLE}: backfilled ${backfilled}, refused ${refusedDuplicate} ` +
          `(duplicate), skipped ${skipped}, ` +
          `collisions by (projectId, fingerprint) = ${byProject.collidingGroups}`,
      );
    }

    console.log('\n=== COLLISION REPORT (projectId, branch, fingerprint) ===');
    for (const o of outcomes) {
      console.log(
        `${o.table}: ${o.backfilled} rows backfilled, ` +
          `${o.refusedPopulation} refused (population), ` +
          `${o.refusedDuplicate} refused (duplicate), ` +
          `${o.collidingGroups} colliding groups` +
          (o.skipped ? ` (${o.skipped} skipped — ${o.skipReason})` : ''),
      );
      for (const s of o.collisionSamples) console.log(`    ${s}`);
    }
    const total = outcomes.reduce((a, o) => a + o.collidingGroups, 0);
    const refused = outcomes.reduce(
      (a, o) => a + o.refusedPopulation + o.refusedDuplicate,
      0,
    );
    console.log(
      total === 0
        ? '\nNo collisions. UNIQUE (projectId, branch, fingerprint) is clear on this dataset.'
        : `\n${total} colliding groups — do NOT create the UNIQUE index.`,
    );
    if (dryRun) {
      console.log(
        'DRY RUN: nothing was written, so the collision report above describes ' +
          'the table as it is NOW, not as this run would leave it.',
      );
    }
    if (refused > 0) {
      console.log(
        `${refused} rows were refused and stay NULL. That is the accepted hole, ` +
          `not a failure: a refusal is how this script avoids minting a digest ` +
          `no scan reproduces, and the next scan of each row stamps it correctly. ` +
          `The index is gated on the colliding-group count, never on this one.`,
      );
    }
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
