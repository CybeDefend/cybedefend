// ============================================================================
// ViolationBreakdownChart - Pie/Bar chart for violation breakdown by rule type
// ============================================================================

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';

import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { ViolationBreakdownItem } from '@/server/interfaces/OrganizationCompliance';
import { ChartBar } from '@/components/atoms/icon/icons';
import { AS_CHART, AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';

interface ViolationBreakdownChartProps {
  data: ViolationBreakdownItem[];
  loading: boolean;
}

/**
 * Truncate long rule type names
 */
const truncateLabel = (label: string, maxLength: number = 20): string => {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength) + '...';
};

/**
 * Status colors matching DA patterns
 */
const statusColors = {
  blocked: 'var(--color-critical-risk)',
  warned: 'var(--color-medium-risk)',
} as const;

/* No tinted fill behind a legend or a tooltip row: the 6 px dot carries the colour. */
const statusBgColors = {
  blocked: 'transparent',
  warned: 'transparent',
} as const;

/**
 * Custom tooltip component with glass-morphism style
 */
const CustomTooltip: React.FC<any> = ({ active, payload }) => {
  const { t } = useTranslation();

  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)] dark:border-as-line-strong dark:bg-as-raised dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)]">
      <p className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {data.ruleType}
      </p>
      <div className="space-y-2">
        <div
          className="flex items-center justify-between gap-4 py-0.5"
          style={{ backgroundColor: statusBgColors.blocked }}
        >
          <span className={`text-xs font-medium ${WORD_TONE.bad}`}>
            {t('pages.complianceOverview.charts.blocked')}
          </span>
          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {data.blockedCount}
          </span>
        </div>
        <div
          className="flex items-center justify-between gap-4 py-0.5"
          style={{ backgroundColor: statusBgColors.warned }}
        >
          <span className={`text-xs font-medium ${WORD_TONE.warning}`}>
            {t('pages.complianceOverview.charts.warned')}
          </span>
          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {data.warnedCount}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Skeleton loader for the chart
 */
const ChartSkeleton: React.FC = () => (
  <Skeleton type="block" height="300px" className="bg-zinc-100 dark:bg-as-raised rounded-2xl" />
);

/**
 * ViolationBreakdownChart - Displays violation breakdown by rule type
 */
const ViolationBreakdownChart: React.FC<ViolationBreakdownChartProps> = ({
  data,
  loading,
}) => {
  const { t } = useTranslation();

  // Sort data by count (descending) and limit to top 10
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        shortName: truncateLabel(item.ruleType),
      }));
  }, [data]);

  // Calculate colors based on blocked vs warned ratio
  const getBarColor = (blockedCount: number, warnedCount: number): string => {
    const total = blockedCount + warnedCount;
    if (total === 0) return '#a855f7'; // Purple for no data
    const blockedRatio = blockedCount / total;
    if (blockedRatio >= 0.5) return '#ef4444'; // Red for mostly blocked
    if (blockedRatio > 0) return '#f97316'; // Orange for mixed
    return '#eab308'; // Yellow for only warned
  };

  return (
    <div className="w-full h-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center">
            <ChartBar
              className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
             />
          </div>
          <div>
            <h3 className={AS_PANEL_TITLE}>
              {t('pages.complianceOverview.charts.breakdownTitle')}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('pages.complianceOverview.charts.breakdownDescription')}
            </p>
          </div>
        </div>
      </div>

      {/* Legend: each word in the colour of its bars, no dot */}
      <div className="mb-5 flex flex-wrap gap-2">
        <div
          className={`flex h-7 items-center text-xs font-medium ${WORD_TONE.bad}`}
        >
          {t('pages.complianceOverview.charts.blocked')}
        </div>
        <div
          className={`flex h-7 items-center text-xs font-medium ${WORD_TONE.warning}`}
        >
          {t('pages.complianceOverview.charts.warned')}
        </div>
      </div>

      {/* Chart */}
      <div>
          {loading ? (
            <ChartSkeleton />
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-zinc-500 dark:text-zinc-400 rounded-2xl bg-zinc-50 dark:bg-white/[0.03]">
              {t('pages.complianceOverview.charts.noViolations')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 10, right: 10, left: -15, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={AS_CHART.grid}
                  horizontal={true}
                  vertical={false}
                />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tickMargin={10}
                  tick={AS_CHART.tick}
                />
                <YAxis
                  type="category"
                  dataKey="shortName"
                  width={120}
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tick={AS_CHART.tick}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="blockedCount"
                  name={t('pages.complianceOverview.charts.blocked')}
                  stackId="a"
                  fill={statusColors.blocked}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="warnedCount"
                  name={t('pages.complianceOverview.charts.warned')}
                  stackId="a"
                  fill={statusColors.warned}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
    </div>
  );
};

export default ViolationBreakdownChart;
