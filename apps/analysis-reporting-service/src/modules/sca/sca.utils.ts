// analysis-reporting-service/src/modules/sca/sca.utils.ts

import { Cvss3P1, Cvss4P0 } from 'ae-cvss-calculator';
import * as semver from 'semver';
import { VulnerabilityOsv } from 'src/entities/osv';

/**
 * Returns the semver-lowest version string from a list of OSV `fixed` events.
 *
 * Why this exists: OSV `affected.ranges.events.fixed` values are bare strings,
 * and the SCA list endpoint used to fold them with SQL `MIN()`. SQL `MIN()`
 * on strings is alphabetical, so it picks `'1.10.0' < '1.2.3'` (wrong: 10 < 2
 * lexicographically but 10 > 2 numerically). This helper does the comparison
 * via the `semver` package, coercing non-strict inputs (e.g. `'1.2'`, `'v3.0'`).
 *
 * Empty strings are dropped before comparison. The function returns:
 * - `null` if every candidate is empty / unparseable,
 * - the original input string of the lowest semver-comparable version otherwise.
 *
 * @param versions Array of candidate fixed-version strings.
 */
export function getMinFixedSemver(versions: string[]): string | null {
  if (!versions || versions.length === 0) return null;

  const nonEmpty = versions.filter((v) => v != null && v !== '');
  if (nonEmpty.length === 0) return null;

  // Pair each input with its coerced semver — fall back to a lexicographic
  // sort for inputs the coercer can't handle, so we never throw.
  let best: { raw: string; coerced: ReturnType<typeof semver.coerce> } | null =
    null;
  for (const raw of nonEmpty) {
    const coerced = semver.coerce(raw, { includePrerelease: true });
    if (best === null) {
      best = { raw, coerced };
      continue;
    }

    if (coerced && best.coerced) {
      // Use the original string when both are valid strict semvers (preserves
      // prerelease ordering, which `coerce` loses by stripping the suffix).
      if (semver.valid(raw) && semver.valid(best.raw)) {
        if (semver.lt(raw, best.raw)) {
          best = { raw, coerced };
        }
      } else if (semver.lt(coerced, best.coerced)) {
        best = { raw, coerced };
      }
    } else if (coerced && !best.coerced) {
      // The candidate is semver-comparable but the current best isn't —
      // prefer the comparable one.
      best = { raw, coerced };
    } else if (!coerced && best.coerced) {
      // Keep the comparable best.
      continue;
    } else if (raw < best.raw) {
      // Both uncomparable — fall back to lexicographic.
      best = { raw, coerced };
    }
  }

  return best ? best.raw : null;
}

/**
 * Returns the semver-lowest `fixed` version that is STRICTLY GREATER than the
 * installed version — i.e. the next real upgrade that actually fixes the
 * vulnerability for this install. Returns `null` when no fixed version is
 * above the installed one (the package is already patched / past the fix) or
 * when the installed version isn't semver-comparable.
 *
 * Why this exists: a CVE can list several `fixed` versions across branches; the
 * global minimum (getMinFixedSemver) can be BELOW the installed version, which
 * would surface a nonsensical "downgrade to fix" (e.g. installed 7.5.13, fix
 * 7.5.3). Versions are compared with semver (coerced), never as strings.
 */
export function getMinFixedAbove(
  versions: string[],
  installedVersion: string,
): string | null {
  const installed = semver.coerce(installedVersion, {
    includePrerelease: true,
  });
  if (!installed) return null;

  let best: { raw: string; coerced: semver.SemVer } | null = null;
  for (const raw of versions) {
    if (raw == null || raw === '') continue;
    const coerced = semver.coerce(raw, { includePrerelease: true });
    if (!coerced) continue;
    // Only consider fixes strictly above the installed version.
    if (!semver.gt(coerced, installed)) continue;
    if (best === null || semver.lt(coerced, best.coerced)) {
      best = { raw, coerced };
    }
  }
  return best ? best.raw : null;
}

/**
 * Returns the semver-highest comparable version from a list (e.g. the highest
 * installed version across a grouped vulnerability's occurrences), or
 * `undefined` when none is comparable. Used so a grouped "recommended fix" is
 * computed against the highest install and never downgrades any occurrence.
 */
export function getMaxComparableVersion(
  versions: string[],
): string | undefined {
  let best: { raw: string; coerced: semver.SemVer } | null = null;
  for (const raw of versions) {
    if (raw == null || raw === '') continue;
    const coerced = semver.coerce(raw, { includePrerelease: true });
    if (!coerced) continue;
    if (best === null || semver.gt(coerced, best.coerced)) {
      best = { raw, coerced };
    }
  }
  return best ? best.raw : undefined;
}

type SeverityItem = { type: string; score: string };

/**
 * Calculates a CVSS score from a generic array of severity objects.
 * It prioritizes CVSS v4, then v3.
 * @param severities An array of severity objects.
 * @returns A numeric CVSS score, or 0 if none can be calculated.
 */
export function calculateCvssScoreFromSeverityArray(
  severities: SeverityItem[] | null | undefined,
): number {
  if (!severities || severities.length === 0) {
    return 0;
  }

  const chosenSeverity =
    severities.find((s) => s.type === 'CVSS_V4') ||
    severities.find((s) => s.type === 'CVSS_V3');

  if (!chosenSeverity?.score) {
    return 0;
  }

  try {
    if (chosenSeverity.type === 'CVSS_V4') {
      const cvss = new Cvss4P0(chosenSeverity.score);
      return cvss.calculateScores(true).overall;
    }
    if (chosenSeverity.type === 'CVSS_V3') {
      const cvss = new Cvss3P1(chosenSeverity.score);
      return cvss.calculateScores(true).overall;
    }
  } catch {
    return 0;
  }

  return 0;
}

/**
 * Calculates the CVSS score for a top-level VulnerabilityOsv entity
 * by delegating to the generic array calculator.
 * @param osvEntity The OSV vulnerability entity.
 */
export function calculateOsvCvssScore(osvEntity: VulnerabilityOsv): number {
  return calculateCvssScoreFromSeverityArray(osvEntity.severities);
}

/**
 * This file centralizes the logic for normalizing data coming from scanners
 * to match the canonical names used in the OSV database.
 */

// A mapping from scanner ecosystem names to OSV canonical ecosystem names.
const ecosystemMap: { [key: string]: string } = {
  npm: 'npm',
  yarn: 'npm',
  pnpm: 'npm',
  bun: 'npm',
  deno: 'npm',
  maven: 'Maven',
  gradle: 'Maven',
  java: 'Maven',
  composer: 'Packagist',
  php: 'Packagist',
  pip: 'PyPI',
  python: 'PyPI',
  poetry: 'PyPI',
  pipenv: 'PyPI',
  // The PURL TYPE, not a scanner name — it arrives through `MCP_PACKAGE_TYPES`
  // (`mcp-advisory.service`, MCP servers started by `uvx`). Without this line
  // it came out as `'pypi'` and matched the `PyPI` column only thanks to the
  // `utf8mb4_0900_ai_ci` collation: a match held by the schema, not the code,
  // and one `isPyPiEcosystem` had to guess.
  pypi: 'PyPI',
  rubygems: 'RubyGems',
  ruby: 'RubyGems',
  bundler: 'RubyGems',
  rust: 'crates.io',
  cargo: 'crates.io',
  go: 'Go',
  golang: 'Go',
  pub: 'Pub',
  dart: 'Pub',
  flutter: 'Pub',
  nuget: 'NuGet',
  dotnet: 'NuGet',
  swift: 'SwiftURL',
  swifturl: 'SwiftURL',
  elixir: 'Hex',
  hex: 'Hex',
  scala: 'Maven',
  erlang: 'Hex',
  conan: 'ConanCenter',
  cpp: 'ConanCenter',
  c: 'ConanCenter',
  github_actions: 'GitHub Actions',
  github: 'GitHub Actions',
};

/**
 * Normalizes a scanner-provided ecosystem name to its OSV canonical equivalent.
 * If no mapping is found, it returns the original name in lowercase.
 *
 * @param scannerEcosystem The ecosystem name from the scanner (e.g., "pip").
 * @returns The canonical OSV ecosystem name (e.g., "PyPI").
 */
export function normalizeEcosystem(scannerEcosystem: string): string {
  if (!scannerEcosystem) {
    return '';
  }
  const lowerEcosystem = scannerEcosystem.toLowerCase();
  return ecosystemMap[lowerEcosystem] || lowerEcosystem;
}

/** One place in the scanned codebase where a package is imported. */
export interface ImportLocation {
  file: string;
  line: number;
  content?: string;
}

/**
 * Byte budget for the serialised `sca_detected_packages.importLocations`
 * payload.
 *
 * The column is MySQL `TEXT`, which holds 65535 **bytes** — not characters.
 * A package imported across many files can blow past that, and MySQL
 * rejects the whole row:
 *
 *   Error upserting package sequelize@6.37.8:
 *   Data too long for column 'importLocations' at row 1
 *
 * The upsert loop logs and continues, so the package was silently dropped from
 * the customer's SCA report — a missing result looks exactly like a clean one.
 * This budget leaves ~8% headroom for the JSON envelope and multi-byte paths.
 */
export const IMPORT_LOCATIONS_BUDGET_BYTES = 60_000;

function serialisedBytes(locations: ImportLocation[]): number {
  return Buffer.byteLength(JSON.stringify(locations), 'utf8');
}

/**
 * Bounds an `importLocations` payload so it always fits the column.
 *
 * Degrades in the order that costs the least information:
 *   1. under budget — returned untouched;
 *   2. over budget — `content` (the source line, shown in the UI) is dropped
 *      from every entry, since the file/line pairs also drive the reachability
 *      inheritance passes in `sca.service.ts` and matter more;
 *   3. still over — keeps the longest prefix of file/line pairs that fits.
 *
 * Losing some locations is bad; losing the entire package is far worse.
 *
 * @param locations Raw locations reported by the scanner.
 * @param budgetBytes Serialised-size ceiling in bytes.
 * @returns Locations whose JSON is guaranteed to be within `budgetBytes`.
 */
export function capImportLocations(
  locations: ImportLocation[] | null | undefined,
  budgetBytes: number = IMPORT_LOCATIONS_BUDGET_BYTES,
): ImportLocation[] {
  if (!locations || locations.length === 0) return [];
  if (serialisedBytes(locations) <= budgetBytes) return locations;

  const withoutContent = locations.map(({ file, line }) => ({ file, line }));
  if (serialisedBytes(withoutContent) <= budgetBytes) return withoutContent;

  // Binary search for the longest prefix that fits. Serialised size grows
  // monotonically with the prefix length, and a pathological package can carry
  // tens of thousands of locations — popping one at a time would be quadratic
  // on the hot ingestion path.
  let low = 0; // always fits ("[]")
  let high = withoutContent.length; // never fits, checked above
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (serialisedBytes(withoutContent.slice(0, mid)) <= budgetBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return withoutContent.slice(0, low);
}

/**
 * Is the canonical ecosystem PyPI? Case-insensitive on purpose: the table
 * above returns `'PyPI'`, but an unknown ecosystem comes out lower-cased, and
 * both forms must trigger the PEP 503 folding.
 */
export function isPyPiEcosystem(
  canonicalEcosystem: string | undefined,
): boolean {
  return (canonicalEcosystem ?? '').toLowerCase() === 'pypi';
}

/**
 * PyPI distribution name normalised per PEP 503: `[-_.]+` folded into a
 * single `-`, lower-cased.
 *
 * ⚠️ WHY THIS FUNCTION EXISTS, AND WHY IT IS NOT APPLIED AT INGESTION. OSV
 * applies this normalisation to its own PyPI entries (its PyPI names carry
 * `-`, never `_`), whereas the SCA scanner emits the RAW name of the
 * requirements line, without normalising it. The two forms must therefore
 * meet somewhere, and that is at the MATCH: normalising at ingestion would
 * rewrite the name SHOWN to the user, which must stay the one in their file.
 *
 * ⚠️ And STRICTLY PyPI. Elsewhere — npm, Hex, Pub, RubyGems — `foo_bar` and
 * `foo-bar` are two DIFFERENT packages, publishable by two different people:
 * folding separators there would create a false positive, not a match.
 */
export function normalizePyPiPackageName(name: string): string {
  return name.replace(/[-_.]+/g, '-').toLowerCase();
}
