import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_CHIP, AS_DOT_WORD, AS_WORD_TONE } from '@/components/atoms/appsec/styles';

type LicenseCategory = 'PERMISSIVE' | 'WEAK_COPYLEFT' | 'STRONG_COPYLEFT' | 'UNKNOWN';

interface LicenseCategoryBadgeProps {
  category: LicenseCategory;
  /**
   * `pill` (default): the tinted chip. `dot`: the word alone, written in the
   * category's colour, no fill and no dot (a licence category is information, read like every other status).
   */
  appearance?: 'pill' | 'dot';
  className?: string;
}

const categoryConfig: Record<LicenseCategory, { label: string; classes: string; dot: string; word: string }> = {
  PERMISSIVE: {
    label: 'Permissive',
    classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
    dot: 'bg-green-500 dark:bg-green-400',
    word: AS_WORD_TONE.good,
  },
  WEAK_COPYLEFT: {
    label: 'Weak Copyleft',
    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    dot: 'bg-amber-500 dark:bg-amber-400',
    word: AS_WORD_TONE.warning,
  },
  STRONG_COPYLEFT: {
    label: 'Strong Copyleft',
    classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    dot: 'bg-red-500 dark:bg-red-400',
    word: AS_WORD_TONE.bad,
  },
  UNKNOWN: {
    label: 'Unknown',
    classes: 'bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400 border-zinc-200 dark:border-as-line-strong',
    dot: 'bg-zinc-400 dark:bg-zinc-500',
    word: AS_WORD_TONE.neutral,
  },
};

const LicenseCategoryBadge: React.FC<LicenseCategoryBadgeProps> = ({ category, appearance = 'pill', className }) => {
  const config = categoryConfig[category] || categoryConfig.UNKNOWN;
  if (appearance === 'dot') {
    return (
      <span className={cn(AS_DOT_WORD, config.word, className)} data-appearance="dot">
        {config.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        AS_CHIP,
        'border',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  );
};

export default LicenseCategoryBadge;
