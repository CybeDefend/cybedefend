// ============================================================================
// ComplianceStatsCards - KPI cards for compliance overview
// Following the organization overview DA patterns
// ============================================================================

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/function/utils';
import { ComplianceTrendData, OrganizationComplianceStats } from '@/server/interfaces/OrganizationCompliance';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import KpiTile from '@/components/molecules/card/kpi/KpiTile';
import { deltaTone, seriesDelta } from '@/components/molecules/card/kpi/kpiTone';
import { CheckCircle, InfoCircle, Percent, ProjectDiagram, ShieldHalved, TimesCircle } from '@/components/atoms/icon/icons';
import { AS_KPI_STRIP } from '@/components/atoms/appsec/styles';
import type { WordTone } from '@/components/molecules/card/kpi/wordTone';

interface ComplianceStatsCardsProps {
  stats: OrganizationComplianceStats | null;
  loading: boolean;
  /**
   * The compliance trend the page already loads for its chart: each card that
   * has a series in it gets its sparkline and its move over the period
   *. No request of its own.
   */
  trend?: ComplianceTrendData[];
}

/** The pending projects behind the total, shown on hover of a small amber glyph (unchanged behaviour). */
const PendingBadge: React.FC<{ value: number; label: string }> = ({ value, label }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="mt-1 flex h-7 w-7 cursor-default items-center justify-center rounded-md">
        <InfoCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      </div>
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 min-w-[140px]"
          >
            <div className="rounded-md bg-zinc-900 px-2.5 py-1.5 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)] dark:border dark:border-as-line-strong dark:bg-as-raised">
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium tabular-nums text-amber-400">{value}</span>
                <span className="text-xs text-zinc-300 dark:text-zinc-200">{label}</span>
              </div>
            </div>
            <div className="absolute -top-1 right-3 h-2 w-2 rotate-45 bg-zinc-900 dark:bg-as-raised" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** The colour of a compliance rate, carried by its label: good from 80 %, a warning from 50 %, bad below. */
const rateTone = (rate: number): WordTone =>
  rate >= 80 ? 'good' : rate >= 50 ? 'warning' : 'bad';

/**
 * ComplianceStatsCards - the five compliance figures as one instrument strip
 *: each figure in ink after the dot of its own
 * colour, and, where the trend holds a series, its move over the period in
 * mint or red and a tiny zinc sparkline.
 */
const ComplianceStatsCards: React.FC<ComplianceStatsCardsProps> = ({
  stats,
  loading,
  trend = [],
}) => {
  const { t, i18n } = useTranslation();

  if (loading || !stats) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} type="card" className="bg-white dark:bg-as-surface rounded-2xl" />
        ))}
      </div>
    );
  }

  const compliantSeries = trend.map((d) => d.compliantCount);
  const nonCompliantSeries = trend.map((d) => d.nonCompliantCount);
  const rateSeries = trend.map((d) => d.complianceRate);

  const signed = (value: number, digits = 0): string => {
    const text = Math.abs(value).toLocaleString(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
  };

  const compliantMove = seriesDelta(compliantSeries);
  const nonCompliantMove = seriesDelta(nonCompliantSeries);
  const rateMove = seriesDelta(rateSeries);
  const overPeriod = t('pages.complianceOverview.stats.overPeriod');

  return (
    <motion.div
      className={cn(AS_KPI_STRIP, 'mb-6 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5')}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <KpiTile
        frame="cell"
        icon={ProjectDiagram}
        value={stats.totalProjects.toLocaleString()}
        label={t('pages.complianceOverview.stats.totalProjects')}
        accessory={
          stats.pendingProjects > 0 ? (
            <PendingBadge value={stats.pendingProjects} label={t('pages.complianceOverview.stats.pending')} />
          ) : undefined
        }
      />

      <KpiTile
        frame="cell"
        icon={CheckCircle}
        value={stats.compliantProjects.toLocaleString()}
        label={t('pages.complianceOverview.stats.compliant')}
        tone="good"
        delta={compliantMove === null ? undefined : signed(compliantMove)}
        deltaTone={deltaTone(compliantMove, 'moreIsGood')}
        note={compliantMove === null ? undefined : overPeriod}
        series={compliantSeries}
        seriesLabel={t('pages.complianceOverview.stats.trendCompliant')}
      />

      <KpiTile
        frame="cell"
        icon={TimesCircle}
        value={stats.nonCompliantProjects.toLocaleString()}
        label={t('pages.complianceOverview.stats.nonCompliant')}
        tone="bad"
        delta={nonCompliantMove === null ? undefined : signed(nonCompliantMove)}
        deltaTone={deltaTone(nonCompliantMove, 'moreIsBad')}
        note={nonCompliantMove === null ? undefined : overPeriod}
        series={nonCompliantSeries}
        seriesLabel={t('pages.complianceOverview.stats.trendNonCompliant')}
      />

      <KpiTile
        frame="cell"
        icon={Percent}
        value={`${stats.complianceRate.toFixed(1)}%`}
        label={t('pages.complianceOverview.stats.complianceRate')}
        tone={rateTone(stats.complianceRate)}
        delta={rateMove === null ? undefined : signed(rateMove, 1)}
        deltaTone={deltaTone(rateMove, 'moreIsGood')}
        note={rateMove === null ? undefined : t('pages.complianceOverview.stats.pointsOverPeriod')}
        series={rateSeries}
        seriesLabel={t('pages.complianceOverview.stats.trendRate')}
      />

      <KpiTile
        frame="cell"
        icon={ShieldHalved}
        value={stats.activePoliciesCount.toLocaleString()}
        label={t('pages.complianceOverview.stats.activePolicies')}
        className="col-span-2 xl:col-span-1"
      />
    </motion.div>
  );
};

export default ComplianceStatsCards;
