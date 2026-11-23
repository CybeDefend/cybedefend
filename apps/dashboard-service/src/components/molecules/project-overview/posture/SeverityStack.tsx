import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { cn } from '@/utils/function/utils';
import { AS_COUNT_ZERO_VALUE } from '@/components/atoms/appsec/styles';
import type { SeverityType, TotalBySeverity } from '@/server/interfaces/Vulnerability';
import PosturePanel from './PosturePanel';
import { OTHER_DOT, OTHER_WORD, SEVERITIES, SEVERITY_DOT, SEVERITY_LABEL, SEVERITY_WORD, isRatedSeverity, sumCounts, useFigures } from './postureTokens';

interface SeverityStackProps {
  data: TotalBySeverity[];
  /** Given, each figure opens the findings of that severity. */
  onSeverityClick?: (severity: SeverityType) => void;
  title?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}

interface Segment {
  key: string;
  label: string;
  count: number;
  dot: string;
  /** The word's colour (the dot is gone). */
  word: string;
  rated: SeverityType | null;
}

/** A severity with no open finding: a zinc outline, no tint, the word quiet (as `SeverityCount`'s zero). */
const ZERO_CHIP = 'border-zinc-200 bg-transparent text-zinc-500 dark:border-white/[0.08] dark:text-zinc-450';

const CELL_CLASS = 'flex w-full flex-col items-start gap-1 rounded-lg px-2 py-2 text-left max-md:min-h-11';

/**
 * « Open findings by severity »: one stacked bar, critical to low in the risk
 * tokens, then the four figures under it, each with its word in the soft
 * chip of its severity and its share, and at the foot the share that is critical or
 * high. The bar carries the proportions, the figures the counts. Shared by
 * the project and the organisation overviews, so the two pages read the same.
 */
const SeverityStack: React.FC<SeverityStackProps> = ({ data, onSeverityClick, title, meta, actions, testId }) => {
  const { t } = useTranslation();
  const { n, pct } = useFigures();

  const segments = useMemo<Segment[]>(() => {
    const rated: Segment[] = SEVERITIES.map((severity) => ({
      key: severity,
      label: t(SEVERITY_LABEL[severity]),
      count: data
        .filter((item) => item.severity.toUpperCase() === severity)
        .reduce((acc, item) => acc + item.count, 0),
      dot: SEVERITY_DOT[severity],
      word: SEVERITY_WORD[severity],
      rated: severity,
    }));
    // What the page does not rate (UNKNOWN, INFO, none) keeps its count, in zinc, after the rated ones.
    const others: Segment[] = data
      .filter((item) => !isRatedSeverity(item.severity) && item.count > 0)
      .map((item) => ({
        key: item.severity,
        label: t('components.projectOverview.posture.severity.other'),
        count: item.count,
        dot: OTHER_DOT,
        word: OTHER_WORD,
        rated: null,
      }));
    return [...rated, ...others];
  }, [data, t]);

  const total = sumCounts(segments);
  const critical = segments.find((s) => s.rated === 'CRITICAL')?.count ?? 0;
  const high = segments.find((s) => s.rated === 'HIGH')?.count ?? 0;
  const priority = critical + high;

  return (
    <PosturePanel
      title={title ?? t('components.projectOverview.posture.severity.title')}
      meta={meta ?? t('components.projectOverview.posture.severity.meta', { count: total, value: n(total) })}
      actions={actions}
      testId={testId}
    >
      {/* The bar: every open finding is a slice; a 2 px gap of the track separates the severities. */}
      <div
        role="img"
        aria-label={segments
          .filter((s) => s.count > 0)
          .map((s) => `${s.label} ${n(s.count)}`)
          .join(', ')}
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]"
      >
        {total > 0 &&
          segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <span key={s.key} className={cn('h-full shrink-0', s.dot)} style={{ width: `${(s.count / total) * 100}%` }} />
            ))}
      </div>

      <ul className="-mx-2 mt-5 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:max-xl:grid-cols-2">
        {segments.map((s) => {
          const zero = s.count === 0;
          const content = (
            <>
              {/* The word in its soft chip; a zero keeps a quiet outline, as a zero count does. */}
              <SeverityChip
                level={s.rated ? s.rated.toLowerCase() : 'none'}
                className={cn('max-w-full', zero && ZERO_CHIP)}
              >
                <span className="truncate">{s.label}</span>
              </SeverityChip>
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'font-mono text-[28px] font-medium leading-9 tracking-[-0.03em] tabular-nums',
                    zero ? AS_COUNT_ZERO_VALUE : 'text-zinc-900 dark:text-zinc-50',
                  )}
                >
                  {n(s.count)}
                </span>
                <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {pct(total > 0 ? s.count / total : 0)}
                </span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {onSeverityClick && s.rated ? (
                <Button
                  variant="row"
                  size="xs"
                  onClick={() => onSeverityClick(s.rated as SeverityType)}
                  aria-label={`${s.label}: ${n(s.count)}`}
                  className={cn(CELL_CLASS, 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]')}
                >
                  {content}
                </Button>
              ) : (
                <div className={CELL_CLASS}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* The foot: how much of it is critical or high, the work that comes first. */}
      {total > 0 && (
        <div className="mt-auto pt-4">
          <div className="border-t border-zinc-100 pt-4 dark:border-as-line" data-testid="priority-share">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-zinc-700 dark:text-zinc-200">
                {t('components.projectOverview.posture.severity.priority')}
              </span>
              <span className="font-mono text-[13px] tabular-nums text-zinc-900 dark:text-zinc-50">
                {n(priority)} <span className="text-zinc-500 dark:text-zinc-450">/ {n(total)}</span>
              </span>
            </div>
            <div aria-hidden="true" className="mt-2 flex h-1 w-full gap-px overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]">
              {critical > 0 && <span className="h-full shrink-0 bg-critical-risk" style={{ width: `${(critical / total) * 100}%` }} />}
              {high > 0 && <span className="h-full shrink-0 bg-high-risk" style={{ width: `${(high / total) * 100}%` }} />}
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono tabular-nums">{pct(priority / total)}</span>{' '}
              {t('components.projectOverview.posture.severity.priorityMeta')}
            </p>
          </div>
        </div>
      )}
    </PosturePanel>
  );
};

export default SeverityStack;
