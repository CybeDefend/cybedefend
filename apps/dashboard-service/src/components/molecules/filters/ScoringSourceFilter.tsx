import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  scoringSourceOptions,
  ScoringSourceFilterValue,
} from '@/utils/data/resultsVulnData';
import { cn } from '@/utils/function/utils';
import { AS_SEGMENT_ITEM, AS_SEGMENT_OFF, AS_SEGMENT_ON, AS_SEGMENT_TRACK, AS_TOUCH } from '@/components/atoms/appsec/styles';

export interface ScoringSourceFilterProps {
  value: ScoringSourceFilterValue;
  onChange: (next: ScoringSourceFilterValue) => void;
  className?: string;
}

const ScoringSourceFilter: React.FC<ScoringSourceFilterProps> = ({
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {t('components.resultsTable.scoringSource')}
      </span>
      <div
        role="radiogroup"
        aria-label={t('components.resultsTable.scoringSource')}
        className={AS_SEGMENT_TRACK}
      >
        {scoringSourceOptions.map((option) => {
          const isActive = value === option.value;
          return (
            <label
              key={option.value}
              data-active={isActive}
              className={cn(
                AS_SEGMENT_ITEM,
                AS_TOUCH,
                'cursor-pointer select-none',
                isActive ? AS_SEGMENT_ON : AS_SEGMENT_OFF,
              )}
            >
              <input
                type="radio"
                name="scoring-source"
                className="sr-only"
                checked={isActive}
                onChange={() => onChange(option.value)}
                aria-label={t(option.labelKey)}
              />
              {t(option.labelKey)}
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default ScoringSourceFilter;
