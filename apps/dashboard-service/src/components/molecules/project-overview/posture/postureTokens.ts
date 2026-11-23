import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import type { SeverityType, StateType } from '@/server/interfaces/Vulnerability';

/**
 * What the two overview pages (project, organisation) share to read as one
 * posture briefing: the severity order and dots,
 * the state order and dots, the scanner labels and where each one leads, and
 * the figure formatters. Colour is information here, never decoration: a
 * severity or a state is a bar segment, or its word written in its colour
 * (no dot, anywhere).
 */

export const SEVERITIES: readonly SeverityType[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** The risk tokens, as backgrounds: the dot and the bar segment of a severity. */
export const SEVERITY_DOT: Record<SeverityType, string> = {
  CRITICAL: 'bg-critical-risk',
  HIGH: 'bg-high-risk',
  MEDIUM: 'bg-medium-risk',
  LOW: 'bg-low-risk',
};

export const SEVERITY_LABEL: Record<SeverityType, string> = {
  CRITICAL: 'common.severity.critical',
  HIGH: 'common.severity.high',
  MEDIUM: 'common.severity.medium',
  LOW: 'common.severity.low',
};

/** The word colour of a severity, where its dot used to be. */
export const SEVERITY_WORD: Record<SeverityType, string> = {
  CRITICAL: AS_WORD_TONE.critical,
  HIGH: AS_WORD_TONE.high,
  MEDIUM: AS_WORD_TONE.medium,
  LOW: AS_WORD_TONE.low,
};

/** A severity the page does not rate (UNKNOWN, INFO, none): zinc. */
export const OTHER_DOT = 'bg-zinc-300 dark:bg-zinc-600';
export const OTHER_WORD = AS_WORD_TONE.neutral;

export const isRatedSeverity = (severity: string): severity is SeverityType =>
  (SEVERITIES as readonly string[]).includes(severity.toUpperCase());

/** The states in the order a reader works them: triage, fix, review, then what is closed. */
export const STATES: readonly StateType[] = [
  'to_verify',
  'confirmed',
  'proposed_not_exploitable',
  'not_exploitable',
  'resolved',
];

/** The status colours, on the dot only; the proposed state takes the accent, as a review the product asks for. */
export const STATE_DOT: Record<string, string> = {
  to_verify: 'bg-amber-500',
  confirmed: 'bg-red-500',
  proposed_not_exploitable: 'bg-secondary dark:bg-secondary-light',
  not_exploitable: 'bg-blue-500',
  resolved: 'bg-emerald-500',
  ignored: 'bg-zinc-400 dark:bg-zinc-500',
};

/** The word colour of a state, where its dot used to be: the same meanings, as text shades. */
export const STATE_WORD: Record<string, string> = {
  to_verify: AS_WORD_TONE.warning,
  confirmed: AS_WORD_TONE.bad,
  proposed_not_exploitable: AS_WORD_TONE.accent,
  not_exploitable: AS_WORD_TONE.info,
  resolved: AS_WORD_TONE.good,
  ignored: AS_WORD_TONE.neutral,
};

export const STATE_LABEL: Record<string, string> = {
  to_verify: 'components.projectOverview.posture.states.toVerify',
  confirmed: 'components.projectOverview.posture.states.confirmed',
  proposed_not_exploitable: 'components.projectOverview.posture.states.proposedNotExploitable',
  not_exploitable: 'components.projectOverview.posture.states.notExploitable',
  resolved: 'components.projectOverview.posture.states.resolved',
  ignored: 'components.projectOverview.posture.states.ignored',
};

/** A state that closes a finding: nobody has to act on it any more. */
export const CLOSED_STATES: readonly string[] = ['resolved', 'not_exploitable', 'ignored'];

/** The scanner key of an analysis type as the API spells it (`AI_BOM`, `AI-BOM`, `aibom` all read `AIBOM`). */
export const scannerKey = (analysisType: string): string => analysisType.toUpperCase().replace(/[^A-Z]/g, '');

/**
 * The project results tab of a scanner, as a `projectPath` segment. The core
 * scanner families are here; a closed tree registers its own (the AI-BOM row)
 * with `registerScannerToken` at boot.
 */
export const SCANNER_SEGMENT: Record<string, string> = {
  SAST: 'sast',
  IAC: 'iac',
  SCA: 'sca',
  SECRET: 'secret',
  CICD: 'cicd',
  CONTAINER: 'container',
};

export const SCANNER_LABEL: Record<string, string> = {
  SAST: 'components.projectOverview.posture.scanners.sast',
  IAC: 'components.projectOverview.posture.scanners.iac',
  SCA: 'components.projectOverview.posture.scanners.sca',
  SECRET: 'components.projectOverview.posture.scanners.secret',
  CICD: 'components.projectOverview.posture.scanners.cicd',
  CONTAINER: 'components.projectOverview.posture.scanners.container',
};

/**
 * Registers a closed scanner's row of the posture ranking (its `scannerKey`,
 * results-tab segment and label key). Called by the closed tree's slot
 * registrations when they load (`readySlots`), never by the core.
 */
export const registerScannerToken = (key: string, segment: string, labelKey: string): void => {
  SCANNER_SEGMENT[key] = segment;
  SCANNER_LABEL[key] = labelKey;
};

export const sumCounts = (items: ReadonlyArray<{ count: number }>): number =>
  items.reduce((acc, item) => acc + (Number.isFinite(item.count) ? item.count : 0), 0);

/** The count of one key in a list of buckets, 0 when absent. */
export const countOf = <K extends string>(items: ReadonlyArray<Record<K, string> & { count: number }>, field: K, key: string): number =>
  items.find((item) => item[field].toLowerCase() === key.toLowerCase())?.count ?? 0;

/**
 * Figures in the interface's language (« 12 345 » and « 83 % » in French),
 * never the browser's. `pct` takes a ratio (0.83), `signed` writes the sign
 * of a delta (« +12 », « −3 », « 0 »).
 */
export function useFigures() {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const n = useCallback((value: number) => value.toLocaleString(lang), [lang]);
  const pct = useCallback(
    (ratio: number) =>
      new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(
        Number.isFinite(ratio) ? ratio : 0,
      ),
    [lang],
  );
  const signed = useCallback(
    (value: number) => (value > 0 ? `+${value.toLocaleString(lang)}` : value < 0 ? `−${Math.abs(value).toLocaleString(lang)}` : '0'),
    [lang],
  );
  return { n, pct, signed, lang };
}

/**
 * The tone of a delta, a word: red when the move is bad news, mint when it is
 * good, zinc when nothing moved. The light shades are the ones that pass
 * 4.5:1 on white (red-600 4.8:1, emerald-700 5.5:1; emerald-600 reads 3.8:1).
 */
export const DELTA_BAD = 'text-red-600 dark:text-red-400';
export const DELTA_GOOD = 'text-emerald-700 dark:text-emerald-400';
export const DELTA_FLAT = 'text-zinc-500 dark:text-zinc-400';

/** `moreIsBad`: on a count of open findings a rise is bad news; on a count of resolved ones it is good news. */
export const deltaTone = (value: number, moreIsBad: boolean): string => {
  if (!Number.isFinite(value) || value === 0) return DELTA_FLAT;
  return (moreIsBad ? value > 0 : value < 0) ? DELTA_BAD : DELTA_GOOD;
};

/** The small label that names a band of the briefing (« Posture now », « What to do next »). */
export const EYEBROW_CLASS = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';
