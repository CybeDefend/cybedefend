import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_PANEL, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { useFigures } from '@/components/molecules/project-overview/posture/postureTokens';

interface LicenceRowProps {
  permissive: number;
  weakCopyleft: number;
  strongCopyleft: number;
  unknown: number;
  /** Every package the SCA scans know, licensed or not. */
  totalPackages?: number;
  testId?: string;
}

/**
 * « Licences », one compact row under the posture: a thin bar of the four
 * categories, then each share as a mono percentage and its word written in
 * the category's colour (no dot). Nothing is
 * rendered when no package is known: an empty licence card said « No data »
 * in a frame of its own.
 */
const LicenceRow: React.FC<LicenceRowProps> = ({ permissive, weakCopyleft, strongCopyleft, unknown, totalPackages, testId }) => {
  const { t } = useTranslation();
  const { n, pct } = useFigures();

  const total = permissive + weakCopyleft + strongCopyleft + unknown;
  if (total <= 0) return null;

  const categories = [
    { key: 'permissive', count: permissive, dot: 'bg-emerald-500', word: AS_WORD_TONE.good, label: t('pages.organizationOverview.glance.licences.permissive') },
    { key: 'weakCopyleft', count: weakCopyleft, dot: 'bg-amber-500', word: AS_WORD_TONE.warning, label: t('pages.organizationOverview.glance.licences.weakCopyleft') },
    { key: 'strongCopyleft', count: strongCopyleft, dot: 'bg-red-500', word: AS_WORD_TONE.bad, label: t('pages.organizationOverview.glance.licences.strongCopyleft') },
    { key: 'unknown', count: unknown, dot: 'bg-zinc-400 dark:bg-zinc-500', word: AS_WORD_TONE.neutral, label: t('pages.organizationOverview.glance.licences.unknown') },
  ];

  return (
    <div className={cn(AS_PANEL, 'flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-5')} data-testid={testId}>
      <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{t('pages.organizationOverview.glance.licences.label')}</span>
      <div
        role="img"
        aria-label={categories.map((c) => `${c.label} ${pct(c.count / total)}`).join(', ')}
        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-zinc-100 sm:w-40 dark:bg-white/[0.06]"
      >
        {categories
          .filter((c) => c.count > 0)
          .map((c) => (
            <span key={c.key} className={cn('h-full', c.dot)} style={{ width: `${(c.count / total) * 100}%` }} />
          ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zinc-600 dark:text-zinc-300">
        {categories.map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1.5">
            <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">{pct(c.count / total)}</span>
            <span className={c.count === 0 ? AS_WORD_TONE.neutral : c.word}>{c.label}</span>
          </li>
        ))}
      </ul>
      {typeof totalPackages === 'number' && totalPackages > 0 && (
        <span className="text-xs tabular-nums text-zinc-500 sm:ml-auto dark:text-zinc-400">
          {t('pages.organizationOverview.glance.licences.packages', { count: totalPackages, value: n(totalPackages) })}
        </span>
      )}
    </div>
  );
};

export default LicenceRow;
