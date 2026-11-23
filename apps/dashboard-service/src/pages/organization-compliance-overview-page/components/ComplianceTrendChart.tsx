// ============================================================================
// ComplianceTrendChart - Area chart for compliance trends over time
// Following OrganizationOverTimeOverview DA pattern
// Uses backend aggregation via timeframe parameter
// ============================================================================

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { ComplianceTrendData, TrendTimeframe } from '@/server/interfaces/OrganizationCompliance';
import { ChartLine } from '@/components/atoms/icon/icons';
import { AS_CHART, AS_PANEL_TITLE, AS_SEGMENT_ITEM, AS_SEGMENT_OFF, AS_SEGMENT_ON, AS_SEGMENT_TRACK, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';

interface ComplianceTrendChartProps {
  data: ComplianceTrendData[];
  loading: boolean;
  timeframe: TrendTimeframe;
  onTimeframeChange: (timeframe: TrendTimeframe) => void;
}

type ComplianceMetric = 'compliantCount' | 'nonCompliantCount' | 'pendingCount';

/**
 * Formats date for X-axis display based on timeframe
 */
const formatDateTick = (tickItem: string, timeframe: TrendTimeframe): string => {
  // Handle both date-only (YYYY-MM-DD) and full ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
  const date = new Date(tickItem);
  
  if (isNaN(date.getTime())) {
    return tickItem;
  }
  
  const options: Intl.DateTimeFormatOptions = {};

  switch (timeframe) {
    case 'day':
      options.month = 'short';
      options.day = 'numeric';
      break;
    case 'week':
      options.month = 'short';
      options.day = 'numeric';
      break;
    case 'month':
      options.month = 'short';
      options.year = 'numeric';
      break;
    default:
      return tickItem;
  }
  return date.toLocaleDateString(undefined, options);
};

/**
 * Compliance status color palette
 */
const complianceColors: Record<ComplianceMetric, string> = {
  compliantCount: '#10b981',
  nonCompliantCount: '#ef4444',
  pendingCount: '#eab308',
};

/**
 * Background colors with transparency for status badges
 */
/* No tinted fill behind a toggle or a tooltip row: the 6 px dot carries the colour. */
const complianceBgColors: Record<ComplianceMetric, string> = {
  compliantCount: 'transparent',
  nonCompliantCount: 'transparent',
  pendingCount: 'transparent',
};

const allMetrics: ComplianceMetric[] = ['compliantCount', 'nonCompliantCount', 'pendingCount'];

/** Each series' word in the colour of its line: the legend and the tooltip carry no dot. */
const complianceWordTone: Record<ComplianceMetric, string> = {
  compliantCount: WORD_TONE.good,
  nonCompliantCount: WORD_TONE.bad,
  pendingCount: WORD_TONE.warning,
};

/**
 * Skeleton loader for the chart
 */
const ChartSkeleton: React.FC = () => (
  <Skeleton type="block" height="320px" className="bg-zinc-100 dark:bg-as-raised rounded-2xl" />
);

/**
 * ComplianceTrendChart - Displays compliance trends over time
 * Uses backend aggregation via timeframe parameter
 */
const ComplianceTrendChart: React.FC<ComplianceTrendChartProps> = ({
  data,
  loading,
  timeframe,
  onTimeframeChange,
}) => {
  const { t } = useTranslation();
  const [visibleMetrics, setVisibleMetrics] = useState<ComplianceMetric[]>([
    'compliantCount',
    'nonCompliantCount',
    'pendingCount',
  ]);

  const metricLabels: Record<ComplianceMetric, string> = {
    compliantCount: t('pages.complianceOverview.status.compliant'),
    nonCompliantCount: t('pages.complianceOverview.status.nonCompliant'),
    pendingCount: t('pages.complianceOverview.status.pending'),
  };

  // Data is already aggregated by backend, just sort by date
  const processedData = useMemo(() => {
    return [...(data || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data]);

  const toggleMetric = (metric: ComplianceMetric) => {
    setVisibleMetrics((prev) =>
      prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric]
    );
  };

  /**
   * Enhanced tooltip with modern glass-morphism style
   */
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)] dark:border-as-line-strong dark:bg-as-raised dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)]">
          <p className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {formatDateTick(label, timeframe)}
          </p>
          <div className="space-y-2">
            {payload
              .filter((item: any) => visibleMetrics.includes(item.name as ComplianceMetric))
              .map((item: any) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between gap-4 py-0.5"
                  style={{ backgroundColor: complianceBgColors[item.name as ComplianceMetric] }}
                >
                  <span className={`text-xs font-medium ${complianceWordTone[item.name as ComplianceMetric]}`}>
                    {metricLabels[item.name as ComplianceMetric]}
                  </span>
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{item.value}</span>
                </div>
              ))}
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <ChartSkeleton />
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
      {/* Header with controls */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center">
            <ChartLine
              className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
             />
          </div>
          <div>
            <h3 className={AS_PANEL_TITLE}>
              {t('pages.complianceOverview.charts.trendTitle')}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {timeframe === 'day' ? t('common.daily') : t('common.dailyAverage')}
            </p>
          </div>
        </div>

        {/* Timeframe selector with refined styling */}
        <div className={AS_SEGMENT_TRACK}>
          {(['day', 'week', 'month'] as TrendTimeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`${AS_SEGMENT_ITEM} ${AS_TOUCH} ${timeframe === tf ? AS_SEGMENT_ON : AS_SEGMENT_OFF}`}
            >
              {t(`common.${tf}`, tf.charAt(0).toUpperCase() + tf.slice(1))}
            </button>
          ))}
        </div>
      </div>

      {/* Metric filter badges */}
      <div className="mb-5 flex flex-wrap gap-2">
        {allMetrics.map((metric) => {
          const isVisible = visibleMetrics.includes(metric);
          const color = complianceColors[metric];
          const bgColor = complianceBgColors[metric];

          return (
            <button
              key={metric}
              onClick={() => toggleMetric(metric)}
              aria-pressed={isVisible}
              className={`relative inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors duration-[120ms] ${AS_TOUCH} ${
                isVisible
                  ? complianceWordTone[metric]
                  : 'text-zinc-500 line-through decoration-zinc-400 hover:text-zinc-800 dark:text-zinc-400 dark:decoration-zinc-500 dark:hover:text-zinc-100'
              }`}
              style={{
                backgroundColor: isVisible ? bgColor : 'transparent',
              }}
            >
              {metricLabels[metric]}
            </button>
          );
        })}
      </div>

      {/* Chart container */}
      {processedData.length === 0 ? (
        <div className="flex items-center justify-center h-72 text-zinc-500 dark:text-zinc-400 rounded-2xl bg-zinc-50 dark:bg-white/[0.03]">
          {t('pages.complianceOverview.charts.noData')}
        </div>
      ) : (
        <div className="h-72 w-full md:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={processedData} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={AS_CHART.grid}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                fontSize={11}
                tickMargin={10}
                tickFormatter={(tick) => formatDateTick(tick, timeframe)}
                tick={AS_CHART.tick}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                fontSize={11}
                tickMargin={10}
                tick={AS_CHART.tick}
              />
              <Tooltip content={<CustomTooltip />} />
              {allMetrics
                .filter((metric) => visibleMetrics.includes(metric))
                .map((metric) => (
                  <Area
                    key={metric}
                    type="monotone"
                    dataKey={metric}
                    stroke={complianceColors[metric]}
                    strokeWidth={2}
                    fill={complianceColors[metric]}
                    fillOpacity={0.06}
                    dot={false}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: '#fff',
                      fill: complianceColors[metric],
                    }}
                    name={metric}
                    connectNulls={true}
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default ComplianceTrendChart;
