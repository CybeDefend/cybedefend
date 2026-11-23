// The app's default i18next instance (initialised by src/i18n at boot): importing
// '@/i18n' here would pull react-i18next's init into every test that mocks it.
import i18n from 'i18next';

/**
 * An option of the results lists' filter and sort menus. Its label is read
 * from the locales in the current language each time a menu shows it (the
 * property is a getter), so the menus speak the page's language without each
 * results table translating them.
 */
const option = (value: string, labelKey: string) => ({
  value,
  get label(): string {
    return i18n.t(labelKey);
  },
});

export const severityOptions = [
  option("critical", "common.severity.critical"),
  option("high", "common.severity.high"),
  option("medium", "common.severity.medium"),
  option("low", "common.severity.low"),
];

export const statusOptions = [
  option("to_verify", "components.analyseWrapper.status.labels.to_verify"),
  option("resolved", "components.analyseWrapper.status.labels.resolved"),
  option("confirmed", "components.analyseWrapper.status.labels.confirmed"),
  option("ignored", "components.analyseWrapper.status.labels.ignored"),
];

export const priorityOptions = [
  option("critical_urgent", "pages.issuePage.scoring.decomposition.priority.criticalUrgent"),
  option("urgent", "pages.issuePage.scoring.decomposition.priority.urgent"),
  option("normal", "pages.issuePage.scoring.decomposition.priority.normal"),
  option("low", "pages.issuePage.scoring.decomposition.priority.low"),
  option("very_low", "pages.issuePage.scoring.decomposition.priority.veryLow"),
];

export const orderOptions = [
  option("currentSeverity", "components.resultsTable.severity"),
  option("currentState", "components.resultsTable.status"),
  option("currentPriority", "components.resultsTable.priority"),
  option("createdAt", "components.resultsTable.firstDetection"),
];

export const orderDirectionOptions = [
  option("asc", "components.resultsTable.ascending"),
  option("desc", "components.resultsTable.descending"),
];

export const severityDefaultValues = ["critical", "high", "medium", "low"];

// Active triage states — keep in sync with backend ACTIVE_VULN_STATES so the
// default list view and its totals exclude resolved / not_exploitable /
// proposed_not_exploitable / ignored and never diverge from the overview
// counters. `proposed_not_exploitable` was retired from the status
// dimension (migration 1803 remapped it to to_verify).
export const statusDefaultValues = ["to_verify", "confirmed"];

export const priorityDefaultValues = [
  "critical_urgent",
  "urgent",
  "normal",
  "low",
  "very_low",
];

/**
 * Exploitability verdict filter options.
 *
 * Label keys point at dashboard-service/src/i18n/locales/{en,fr}/components/resultsTable.json.
 * Values match the backend enum (see libs/protos/analysis-reporting/result.proto
 * and analysis-reporting-service/src/modules/cvss/static-exploitability.ts).
 *
 * "not_evaluated" is the frontend-only sentinel for detections whose
 * exploitability has not yet been computed (exploitabilityVerdict === null).
 */
export const exploitabilityOptions = [
  { label: "Active", value: "actively_exploited" },
  { label: "Proven", value: "proven" },
  { label: "Theoretical", value: "theoretical" },
  { label: "Not Exploitable", value: "not_exploitable" },
  { label: "Not Evaluated", value: "not_evaluated" },
];

/**
 * Canonical default selection for the exploitability filter: every verdict is
 * selected, so nothing is hidden on first load.
 *
 * Exploitability is an audit-assistance field, not a triage filter like status
 * — the user must see `not_exploitable` (and every other verdict) by default
 * and only narrows the view explicitly via the dropdown ("All" is the base
 * state). Also used by the filter dropdown's "Show all" / batch select.
 */
export const exploitabilityDefaultValues = [
  "actively_exploited",
  "proven",
  "theoretical",
  "not_exploitable",
  "not_evaluated",
];

/**
 * Three-state selector for the scoring source filter. Labels are
 * resolved from i18n keys under `components.resultsTable.scoringSource*` so
 * consumers can render localized chips without hard-coding copy.
 *
 * - `all`    → no filter applied, the query param is omitted from the API call.
 * - `static` → only detections whose CVSS v4 / priority was produced by the
 *   deterministic static scorer.
 * - `agent`  → only detections enriched by the Cybe.
 */
export type ScoringSourceFilterValue = 'all' | 'static' | 'agent';

export const scoringSourceOptions: {
  value: ScoringSourceFilterValue;
  labelKey: string;
}[] = [
  { value: 'all', labelKey: 'components.resultsTable.scoringSourceAll' },
  { value: 'static', labelKey: 'components.resultsTable.scoringSourceStatic' },
  { value: 'agent', labelKey: 'components.resultsTable.scoringSourceAgent' },
];

/**
 * Serializes the scoring-source filter to the backend query parameter the
 * `useResults*` hooks consume. Returns `undefined` when the filter is off so
 * callers can safely spread the result into a params object without emitting
 * `scoringSource=all`.
 */
export const scoringSourceToQueryParam = (
  value: ScoringSourceFilterValue | null | undefined,
): string | undefined => {
  if (!value || value === 'all') return undefined;
  return value;
};

/**
 * Picks the CVSS score and label version to display in a table row
 * based on what the backend actually produced for this detection. Mirrors the
 * logic in ScoringExploitabilityTab so the table badge and the detail card
 * never disagree:
 *
 * - When the backend computed a CVSS 4.0 score (static scorer or agent), we
 *   surface `cvss4EnvironmentalScore ?? cvss4BaseScore` with the `v4` badge —
 *   irrespective of the scan type.
 * - Otherwise we fall back to the per-type legacy score: `cvssScore` for SCA
 *   (OSV/GHSA-provided v3), the best CVSS entry for Container, or
 *   `vulnerability.cvss3.baseScore` for SAST/IAC scans that predate the
 *   CVSS 4.0 enrichment. Without this fallback, every old SAST/IAC vuln shows
 *   a "—" in the list and an "N/A" in the Scoring tab even though the detail
 *   card still renders the original CVSS 3.1 number.
 *
 * `legacyLabel` is reserved for SCA-only legacy scores because that's the
 * only place the detail view uses it too; Container keeps the `v3` chip.
 */
export interface TableCvssDisplay {
  score: number | null;
  version: 'v4' | 'v3' | 'legacy';
}

export const pickCvssForTable = (input: {
  cvss4BaseScore?: number | null;
  cvss4EnvironmentalScore?: number | null;
  legacyScore?: number | null;
  cvss3BaseScore?: string | number | null;
  legacyLabel?: 'v3' | 'legacy';
}): TableCvssDisplay => {
  const v4 = input.cvss4EnvironmentalScore ?? input.cvss4BaseScore ?? null;
  if (v4 != null) {
    return { score: v4, version: 'v4' };
  }
  if (input.legacyScore != null && input.legacyScore > 0) {
    return {
      score: input.legacyScore,
      version: input.legacyLabel ?? 'v3',
    };
  }
  if (input.cvss3BaseScore != null && input.cvss3BaseScore !== '') {
    const parsed =
      typeof input.cvss3BaseScore === 'number'
        ? input.cvss3BaseScore
        : parseFloat(input.cvss3BaseScore);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { score: parsed, version: 'v3' };
    }
  }
  return {
    score: input.legacyScore ?? null,
    version: input.legacyLabel ?? 'v3',
  };
};
