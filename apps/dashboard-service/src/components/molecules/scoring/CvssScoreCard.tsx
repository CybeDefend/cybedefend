import React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/function/utils';
import { getSeverityLabel } from './scoringUtils';
import type {
  SastVulnerabilityResult,
  IacVulnerabilityResult,
  CicdVulnerabilityResult,
  SecretVulnerabilityResult,
} from '@/server/interfaces/Vulnerability';
import { ShieldAlt } from '@/components/atoms/icon/icons';

type SupportedVulnerability =
  | SastVulnerabilityResult
  | IacVulnerabilityResult
  | CicdVulnerabilityResult
  | SecretVulnerabilityResult;

interface CvssScoreCardProps {
  vulnerability: SupportedVulnerability;
}

/**
 * Shows CVSS 4.0 when available (prefers environmental score over base score),
 * falls back to CVSS 3.1, renders null if neither is present.
 */
const CvssScoreCard: React.FC<CvssScoreCardProps> = ({ vulnerability }) => {
  const { t } = useTranslation();
  const hasCvss4 =
    vulnerability.cvss4BaseScore != null || vulnerability.cvss4Vector != null;
  const cvss3 = (vulnerability as SastVulnerabilityResult).vulnerability?.cvss3;

  if (!hasCvss4 && !cvss3) {
    return null;
  }

  if (hasCvss4) {
    const displayScore =
      vulnerability.cvss4EnvironmentalScore ?? vulnerability.cvss4BaseScore;
    // FE-H2: color must follow the actual severity band (not a hardcoded red).
    // `getSeverityLabel` mirrors the CVSS v3.1/v4.0 qualitative ratings used
    // in ScoringExploitabilityTab — a 3.1 score renders low-risk, not red.
    const severityClass =
      displayScore != null
        ? getSeverityLabel(displayScore).colorClass
        : 'text-zinc-400';

    return (
      <div
        className={cn(
          'rounded-2xl p-4',
          'bg-white dark:bg-as-surface',
          'border border-zinc-200 dark:border-as-line',
        )}
      >
        <h4
          className={cn(
            'font-medium text-zinc-800 dark:text-zinc-200 mb-2 text-sm flex items-center',
          )}
        >
          <ShieldAlt
            className={cn('mr-2 text-secondary dark:text-secondary-light')}
           />
          CVSS 4.0 Score
        </h4>
        <div className="flex justify-between items-center">
          {/* A score that could not be read is a word in the UI font, never a dash. */}
          {displayScore != null ? (
            <span className={cn('text-3xl font-medium', severityClass)}>{displayScore}</span>
          ) : (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('pages.issuePage.scoring.unavailable')}</span>
          )}
          {vulnerability.cvss4Vector && (
            <span
              className={cn(
                'text-xs font-mono text-zinc-600 dark:text-zinc-400',
                'bg-zinc-100 dark:bg-as-raised px-2 py-1 rounded-lg',
              )}
            >
              {vulnerability.cvss4Vector}
            </span>
          )}
        </div>
      </div>
    );
  }

  // FE-H2: CVSS 3.1 legacy score is stored as a string — parse before picking
  // the severity colour class. Falls back to low-risk if parseFloat returns NaN
  // (shouldn't happen in practice because the vuln enrichment normalizes this).
  const cvss3BaseScore = parseFloat(cvss3!.baseScore as unknown as string);
  const cvss3SeverityClass = Number.isFinite(cvss3BaseScore)
    ? getSeverityLabel(cvss3BaseScore).colorClass
    : 'text-zinc-400';

  return (
    <div
      className={cn(
        'rounded-2xl p-4',
        'bg-white dark:bg-as-surface',
        'border border-zinc-200 dark:border-as-line',
      )}
    >
      <h4
        className={cn(
          'font-medium text-zinc-800 dark:text-zinc-200 mb-2 text-sm flex items-center',
        )}
      >
        <ShieldAlt
          className={cn('mr-2 text-secondary dark:text-secondary-light')}
         />
        CVSS 3.1 Score
      </h4>
      <div className="flex justify-between items-center">
        <span className={cn('text-3xl font-medium', cvss3SeverityClass)}>
          {cvss3!.baseScore}
        </span>
        <span
          className={cn(
            'text-xs font-mono text-zinc-600 dark:text-zinc-400',
            'bg-zinc-100 dark:bg-as-raised px-2 py-1 rounded-lg',
          )}
        >
          {cvss3!.vector}
        </span>
      </div>
    </div>
  );
};

export default CvssScoreCard;
