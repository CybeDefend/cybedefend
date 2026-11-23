import React from 'react';
import SeverityChip, { priorityChipLevel } from '@/components/atoms/badge/SeverityChip';
import { useTranslation } from 'react-i18next';
import { PriorityDecomposition } from '@/server/interfaces/Vulnerability';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { Slot } from '@/edition/slots';
import { DecompositionBarRow, type BarRowProps } from './DecompositionBarRow';

interface PriorityDecompositionChartProps {
  decomposition: PriorityDecomposition;
  /**
   * For a malicious package (malware) the CVSS and EPSS dimensions are
   * meaningless (no CVE, both forced to max), so their breakdown rows are hidden.
   * Display-only filter — the composite score / weights math is untouched.
   */
  isMalware?: boolean;
  /** The finding the decomposition is about, handed to the `finding.scoring` rows (placement `decomposition`). */
  vulnerability?: unknown;
}

/** The priority word in its level's colour (no dot). */
const priorityBadgeConfig: Record<string, { i18nKey: string; word: string }> = {
  critical_urgent: {
    i18nKey: 'pages.issuePage.scoring.decomposition.priority.criticalUrgent',
    word: AS_WORD_TONE.critical,
  },
  urgent: {
    i18nKey: 'pages.issuePage.scoring.decomposition.priority.urgent',
    word: AS_WORD_TONE.high,
  },
  normal: {
    i18nKey: 'pages.issuePage.scoring.decomposition.priority.normal',
    word: AS_WORD_TONE.medium,
  },
  low: {
    i18nKey: 'pages.issuePage.scoring.decomposition.priority.low',
    word: AS_WORD_TONE.low,
  },
  very_low: {
    i18nKey: 'pages.issuePage.scoring.decomposition.priority.veryLow',
    word: AS_WORD_TONE.neutral,
  },
};

// The row lives in its own module, which imports no edition code: the rows a
// slot adds (the cloud's EPSS row) draw it from there.
export { DecompositionBarRow };
export type { BarRowProps };

const BarRow = DecompositionBarRow;

const PriorityDecompositionChart: React.FC<PriorityDecompositionChartProps> = ({
  decomposition,
  isMalware = false,
  vulnerability,
}) => {
  const { t } = useTranslation();
  const compositeDisplay = (decomposition.compositeScore * 100).toFixed(1);
  const badge = priorityBadgeConfig[decomposition.priority] || priorityBadgeConfig.normal;

  return (
    <div className="bg-white dark:bg-as-surface rounded-2xl border border-zinc-200 dark:border-as-line p-4 sm:p-5 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
          <i className="fas fa-chart-pie text-secondary dark:text-secondary-light mr-2" />
          {t('pages.issuePage.scoring.decomposition.title')}
        </h4>
        <div className="flex items-center gap-2">
          {/* The priority in the soft chip of its level. */}
          <SeverityChip data-testid="priority-badge" level={priorityChipLevel(priorityBadgeConfig[decomposition.priority] ? decomposition.priority : 'normal')}>
            {t(badge.i18nKey)}
          </SeverityChip>
          <span className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
            {compositeDisplay}
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">/100</span>
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {!isMalware && (
          <BarRow
            label={t('pages.issuePage.scoring.decomposition.cvssEnv')}
            weight={decomposition.w1}
            contribution={decomposition.cvss4Contribution}
            barColor="bg-critical-risk/80"
            valueColor="text-zinc-700 dark:text-zinc-200"
          />
        )}

        {/* The rows the active edition adds between CVSS and exploitability
            (the cloud's EPSS row), never for malware, whose CVSS and EPSS
            dimensions are meaningless. */}
        {!isMalware && (
          <Slot
            name="finding.scoring"
            context={{ placement: 'decomposition', decomposition, vulnerability }}
          />
        )}

        <BarRow
          label={t('pages.issuePage.scoring.decomposition.exploitability')}
          weight={decomposition.w3}
          contribution={decomposition.exploitContribution}
          barColor="bg-critical-risk/80"
          valueColor="text-zinc-700 dark:text-zinc-200"
        />

        <BarRow
          label={t('pages.issuePage.scoring.decomposition.context')}
          weight={decomposition.w4}
          contribution={decomposition.contextContribution}
          barColor="bg-secondary/70"
          valueColor="text-zinc-700 dark:text-zinc-200"
        />
      </div>
    </div>
  );
};

export default PriorityDecompositionChart;
