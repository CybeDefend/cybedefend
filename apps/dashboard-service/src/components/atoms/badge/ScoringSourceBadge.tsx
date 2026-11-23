import React from 'react';
import { Brain, Calculator } from '@/components/atoms/icon/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_CHIP, AS_TOOLTIP } from '@/components/atoms/appsec/styles';

export type ScoringSource = 'static' | 'agent' | string | null | undefined;
export type CvssVersion = 'v4' | 'v3' | 'legacy';

export interface ScoringSourceBadgeProps {
  scoringSource?: ScoringSource;
  cvssVersion: CvssVersion;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  showTooltip?: boolean;
  tooltipPlacement?: 'top' | 'right';
  className?: string;
}

const versionKey: Record<CvssVersion, string> = {
  v4: 'pages.issuePage.scoring.cvss.scoreV4',
  v3: 'pages.issuePage.scoring.cvss.scoreV3',
  legacy: 'pages.issuePage.scoring.cvss.legacyLabel',
};

const ScoringSourceBadge: React.FC<ScoringSourceBadgeProps> = ({
  scoringSource,
  cvssVersion,
  size = 'sm',
  iconOnly = false,
  showTooltip = true,
  tooltipPlacement = 'top',
  className,
}) => {
  const { t } = useTranslation();

  if (!scoringSource) return null;

  const isAgent = scoringSource === 'agent';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const compactPadding = size === 'sm' ? 'p-1' : 'p-1.5';
  // An icon alone is a small square; with its word it is a 20 px chip (24 px in a detail panel).
  const shape = iconOnly
    ? cn('inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap', compactPadding)
    : cn(AS_CHIP, size === 'md' && 'h-6 px-2');
  const label = isAgent
    ? t('pages.issuePage.scoring.cvss.iaAnalysis')
    : t(versionKey[cvssVersion]);
  const tooltipPosition =
    tooltipPlacement === 'right'
      ? 'left-full top-1/2 ml-2 -translate-y-1/2'
      : 'bottom-full left-1/2 mb-2 -translate-x-1/2';

  if (isAgent) {
    return (
      <span
        className={cn(
          'group relative',
          shape,
          textSize,
          'bg-purple-100 dark:bg-purple-900/30',
          'border border-purple-500/20 dark:border-purple-500/30',
          'text-purple-600 dark:text-purple-400',
          className,
        )}
        title={label}
        aria-label={label}
      >
        <Brain className={iconSize} />
        {!iconOnly && label}
        {iconOnly && showTooltip && (
          <span
            className={cn(
              'absolute whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
              AS_TOOLTIP,
              tooltipPosition,
            )}
          >
            {label}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'group relative',
        shape,
        textSize,
        'bg-gray-100 dark:bg-white/[0.06]',
        'border border-gray-200 dark:border-as-line',
        'text-zinc-600 dark:text-zinc-300',
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Calculator className={iconSize} />
      {!iconOnly && label}
      {iconOnly && showTooltip && (
        <span
          className={cn(
            'absolute whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
              AS_TOOLTIP,
            tooltipPosition,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
};

export default ScoringSourceBadge;
