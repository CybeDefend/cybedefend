import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Button from '@/components/atoms/button/Button';
import { cn } from '@/utils/function/utils';
import {
  AS_CHART,
  AS_SEGMENT_ITEM,
  AS_SEGMENT_OFF,
  AS_SEGMENT_ON,
  AS_SEGMENT_TRACK,
} from '@/components/atoms/appsec/styles';
import type { PeriodComparison, VulnerabilitiesOverTime } from '@/server/interfaces/Vulnerability';
import { useDocumentTheme } from '@/utils/theme/useDocumentTheme';
import PosturePanel from './PosturePanel';
import { deltaTone, useFigures } from './postureTokens';
import { trendFigures, trendSeries, type TrendPoint, type TrendTimeframe } from './trendSeries';

interface OpenTrendProps {
  data: VulnerabilitiesOverTime[];
  title?: string;
  /** What the series counts, in one quiet line. */
  meta?: React.ReactNode;
  /** The export buttons, or anything else the title row should carry. */
  actions?: React.ReactNode;
  /** The period against the one before, when the source gives it (the organisation's trends). */
  comparison?: PeriodComparison | null;
  testId?: string;
}

const TIMEFRAMES: TrendTimeframe[] = ['day', 'week', 'month'];

/*
  The chart's colours, as literal values of the theme the document shows: the
  PNG / PDF export copies the chart's SVG as it is, where a CSS variable
  resolves to nothing, so the lines and the axis figures came out black and
  the grid vanished. Same values as the tokens: ink zinc-900 / zinc-100, the
  Platform accent #7845FF / #A78BFA (\`--color-secondary-rgb\`,
  \`--color-secondary-light-rgb\`), \`--as-chart-tick\` and \`--as-chart-grid\`.
*/
const CHART_COLOURS = {
  light: { ink: '#18181b', accent: '#7845FF', tick: '#71717a', grid: '#e4e4e7' },
  dark: { ink: '#f4f4f5', accent: '#A78BFA', tick: '#a1a1aa', grid: 'rgba(255, 255, 255, 0.06)' },
} as const;

const tickOptions: Record<TrendTimeframe, Intl.DateTimeFormatOptions> = {
  day: { month: 'short', day: 'numeric' },
  week: { month: 'short', day: 'numeric' },
  month: { month: 'short', year: 'numeric' },
};

const formatTick = (day: string, timeframe: TrendTimeframe, lang: string): string => {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(lang, tickOptions[timeframe]);
};

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: TrendPoint }>;
  timeframe: TrendTimeframe;
}

const TrendTooltip: React.FC<TooltipProps> = ({ active, label, payload, timeframe }) => {
  const { t } = useTranslation();
  const { n, lang } = useFigures();
  if (!active || !payload?.length || !label) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)] dark:border-as-line-strong dark:bg-as-raised dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)]">
      <p className="mb-1.5 font-medium text-zinc-900 dark:text-zinc-100">{formatTick(label, timeframe, lang)}</p>
      <div className="space-y-1">
        <p className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{t('components.projectOverview.posture.trend.open')}</span>
          <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">{n(point.open)}</span>
        </p>
        <p className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300">
          <span className="font-medium text-secondary dark:text-secondary-light">{t('components.projectOverview.posture.trend.priority')}</span>
          <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">{n(point.priority)}</span>
        </p>
      </div>
    </div>
  );
};

/**
 * « Open findings over time »: the series the page already loads, drawn as
 * two lines, every open finding in ink and the critical or high ones in the
 * accent, with where each line stands today as two mono figures beside the
 * title. The four severity areas it replaces asked the reader to add them up.
 */
const OpenTrend: React.FC<OpenTrendProps> = ({ data, title, meta, actions, comparison, testId }) => {
  const { t } = useTranslation();
  const { n, pct, signed, lang } = useFigures();
  const [timeframe, setTimeframe] = useState<TrendTimeframe>('day');
  const colours = CHART_COLOURS[useDocumentTheme().isDark ? 'dark' : 'light'];
  /** The axis figures at 12 px: nothing on the page is smaller. */
  const tick = { ...AS_CHART.tick, fill: colours.tick, fontSize: 12 };

  const series = useMemo(() => trendSeries(data, timeframe), [data, timeframe]);
  const figures = trendFigures(series);

  const change = comparison ? comparison.changePercentage : null;

  const legend = figures && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="trend-figures">
      {/* Each series' word is written in its line's colour: ink for every open finding, the accent for critical or high (no dot). */}
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">{n(figures.open)}</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{t('components.projectOverview.posture.trend.open')}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">{n(figures.priority)}</span>
        <span className="font-medium text-secondary dark:text-secondary-light">{t('components.projectOverview.posture.trend.priority')}</span>
      </span>
      {change !== null && Number.isFinite(change) && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'font-mono tabular-nums',
              deltaTone(change, true),
            )}
          >
            {change > 0 ? '+' : ''}
            {pct(change / 100)}
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">{t('components.projectOverview.posture.trend.vsPrevious')}</span>
        </span>
      )}
      {series.length > 1 && figures.delta !== 0 && (
        <span className="hidden whitespace-nowrap text-[13px] text-zinc-500 sm:inline dark:text-zinc-400">
          {/* More open findings over the window is bad news: red; fewer is good news: mint. */}
          <span className={cn('font-mono tabular-nums', deltaTone(figures.delta, true))}>{signed(figures.delta)}</span>{' '}
          {t('components.projectOverview.posture.trend.inPeriod')}
        </span>
      )}
    </div>
  );

  const timeframeControl = (
    <div className={AS_SEGMENT_TRACK} role="group" aria-label={t('components.projectOverview.posture.trend.timeframe')}>
      {TIMEFRAMES.map((tf) => {
        const on = timeframe === tf;
        return (
          <Button
            key={tf}
            variant="ghost"
            size="xs"
            aria-pressed={on}
            onClick={() => setTimeframe(tf)}
            className={cn(
              AS_SEGMENT_ITEM,
              'border-0',
              on
                ? cn(AS_SEGMENT_ON, 'hover:bg-white hover:text-secondary dark:hover:bg-as-raised dark:hover:text-secondary-light')
                : cn(AS_SEGMENT_OFF, 'hover:bg-transparent dark:hover:bg-transparent'),
            )}
          >
            {t(`common.${tf}`)}
          </Button>
        );
      })}
    </div>
  );

  return (
    <PosturePanel
      title={title ?? t('components.projectOverview.posture.trend.title')}
      meta={meta}
      actions={
        <>
          {actions}
          {timeframeControl}
        </>
      }
      testId={testId}
    >
      {legend && <div className="mb-3">{legend}</div>}
      {series.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('components.projectOverview.posture.trend.empty')}
        </p>
      ) : (
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={colours.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={tick}
                tickMargin={10}
                minTickGap={28}
                tickFormatter={(tick: string) => formatTick(tick, timeframe, lang)}
              />
              <YAxis axisLine={false} tickLine={false} tick={tick} tickMargin={8} allowDecimals={false} width={36} />
              <Tooltip content={<TrendTooltip timeframe={timeframe} />} cursor={{ stroke: colours.grid }} />
              <Area
                type="monotone"
                dataKey="open"
                stroke={colours.ink}
                strokeWidth={2}
                fill={colours.ink}
                fillOpacity={0.05}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: colours.ink }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="priority"
                stroke={colours.accent}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: colours.accent }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </PosturePanel>
  );
};

export default OpenTrend;
