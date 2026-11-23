import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import { cn } from '@/utils/function/utils';
import type { StateType, TotalByState } from '@/server/interfaces/Vulnerability';
import Meter from './Meter';
import PosturePanel from './PosturePanel';
import { CLOSED_STATES, STATES, STATE_DOT, STATE_LABEL, sumCounts, useFigures } from './postureTokens';

interface StateRowsProps {
  data: TotalByState[];
  /** Given, each row opens the findings in that state. */
  onStateClick?: (state: StateType) => void;
  /** What each state means, shown as the row's tooltip (the organisation's State tab gave its chart one). */
  descriptions?: Partial<Record<string, string>>;
  title?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}

const ROW_CLASS = 'flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 text-left max-md:min-h-11';

/** A state's label: translated when known, the raw value with its underscores opened otherwise. */
const stateLabel = (t: (key: string) => string, state: string): string =>
  STATE_LABEL[state] ? t(STATE_LABEL[state]) : state.replace(/_/g, ' ');

/**
 * « By state »: one row per state in the order a reader works them (triage,
 * fix, review, then what is closed), each a dot in the status colour, the
 * word, a hairline meter and the mono count with its share; under them, how
 * much is closed. The bar chart it replaces drew five coloured columns for
 * five numbers.
 */
const StateRows: React.FC<StateRowsProps> = ({ data, onStateClick, descriptions, title, meta, actions, testId }) => {
  const { t } = useTranslation();
  const { n, pct } = useFigures();

  const rows = useMemo(() => {
    const known = STATES.filter((state) => data.some((item) => item.state === state)).map((state) => ({
      state,
      count: data.filter((item) => item.state === state).reduce((acc, item) => acc + item.count, 0),
    }));
    const unknown = data
      .filter((item) => !(STATES as readonly string[]).includes(item.state))
      .map((item) => ({ state: item.state, count: item.count }));
    return [...known, ...unknown];
  }, [data]);

  const total = sumCounts(rows);
  const max = rows.reduce((acc, row) => Math.max(acc, row.count), 0);
  const closed = rows.filter((row) => CLOSED_STATES.includes(row.state)).reduce((acc, row) => acc + row.count, 0);

  return (
    <PosturePanel
      title={title ?? t('components.projectOverview.posture.states.title')}
      meta={meta ?? t('components.projectOverview.posture.states.meta', { count: total, value: n(total) })}
      actions={actions}
      testId={testId}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('components.projectOverview.posture.states.empty')}
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((row) => {
            const label = stateLabel(t, row.state);
            const content = (
              <>
                <span className="flex min-w-0 flex-1 items-center sm:w-44 sm:flex-none">
                  <span className="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{label}</span>
                </span>
                {/* The meter in the state's own colour carries it (no dot): the length is the count, the colour the state. */}
                <Meter
                  ratio={max > 0 ? row.count / max : 0}
                  fillClassName={STATE_DOT[row.state] ?? STATE_DOT.ignored}
                  className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1"
                />
                <span className="w-10 shrink-0 text-right font-mono text-[13px] tabular-nums text-zinc-900 dark:text-zinc-50">
                  {n(row.count)}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {pct(total > 0 ? row.count / total : 0)}
                </span>
              </>
            );
            return (
              <li key={row.state}>
                {onStateClick ? (
                  <Button
                    variant="row"
                    size="xs"
                    onClick={() => onStateClick(row.state as StateType)}
                    aria-label={`${label}: ${n(row.count)}`}
                    title={descriptions?.[row.state]}
                    className={cn(ROW_CLASS, 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]')}
                  >
                    {content}
                  </Button>
                ) : (
                  <div className={ROW_CLASS} title={descriptions?.[row.state]}>
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        // The foot sits at the bottom of the panel, so it lines up with the block beside it.
        <div className="mt-auto pt-4">
          <div className="border-t border-zinc-100 pt-4 dark:border-as-line" data-testid="closed-share">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-zinc-700 dark:text-zinc-200">{t('components.projectOverview.posture.states.closed')}</span>
              <span className="font-mono text-[13px] tabular-nums text-zinc-900 dark:text-zinc-50">
                {n(closed)} <span className="text-zinc-500 dark:text-zinc-450">/ {n(total)}</span>
              </span>
            </div>
            {/* Mint: what is closed is the good news of this block. */}
            <Meter ratio={closed / total} fillClassName="bg-emerald-500 dark:bg-emerald-400" className="mt-2" />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono tabular-nums">{pct(closed / total)}</span> {t('components.projectOverview.posture.states.closedMeta')}
            </p>
          </div>
        </div>
      )}
    </PosturePanel>
  );
};

export default StateRows;
