// ============================================================================
// ComplianceOverview - Stats cards for compliance status
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { ComplianceResult, ViolationStats } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import { Ban, ClipboardList, ExclamationTriangle, TimesCircle } from '@/components/atoms/icon/icons';
import { AS_COUNT_ZERO_VALUE, KPI_TEXT } from '@/components/atoms/appsec/styles';
import { AS_GLYPH } from '@/components/atoms/appsec/recipes';

interface ComplianceOverviewProps {
  complianceResult: ComplianceResult | null;
  stats: ViolationStats | null;
  loading: boolean;
  error: string | null;
}

const ComplianceOverview: React.FC<ComplianceOverviewProps> = ({
  complianceResult,
  stats,
  loading,
  error,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} variant="default" padding="md">
            <div className="animate-pulse">
              <div className="h-4 bg-zinc-200 dark:bg-as-raised rounded w-1/2 mb-3" />
              <div className="h-8 bg-zinc-200 dark:bg-as-raised rounded w-1/3" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const isCompliant = complianceResult?.result?.compliant ?? null;
  const blockingCount = stats?.blockedCount ?? complianceResult?.result?.blockingViolationsCount ?? 0;
  const warningCount = stats?.warnedCount ?? complianceResult?.result?.warningViolationsCount ?? 0;
  const totalViolations = stats?.totalViolations ?? 0;
  const policiesCount = stats?.applicablePoliciesCount ?? complianceResult?.result?.evaluatedPoliciesCount ?? 0;

  /*
    Colour is information: each KPI's
    colour moves from a tinted icon tile and a coloured figure to its label,
    written in that colour (no dot). The figure is in ink,
    a zero and its label a step quieter, and the glyph stays a quiet zinc glyph.
  */
  const statCards = [
    {
      label: t('pages.policies.violations.total'),
      count: totalViolations,
      icon: ClipboardList,
      tone: KPI_TEXT.neutral,
    },
    {
      label: t('pages.policies.violations.blocking'),
      count: blockingCount,
      icon: Ban,
      tone: KPI_TEXT.bad,
    },
    {
      label: t('pages.policies.violations.warning'),
      count: warningCount,
      icon: ExclamationTriangle,
      tone: KPI_TEXT.warning,
    },
    {
      label: t('pages.policies.policiesEvaluated'),
      count: policiesCount,
      icon: ClipboardList,
      tone: KPI_TEXT.info,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
      {statCards.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card variant="default" padding="none" hoverable className="p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center">
                <stat.icon className={AS_GLYPH} />
              </div>
              <div>
                {/* KPI labels are sentence case everywhere else in the product. */}
                <p className={cn('text-xs font-medium', stat.count === 0 ? AS_COUNT_ZERO_VALUE : stat.tone)}>{stat.label}</p>
                <p
                  className={cn(
                    'font-mono text-2xl font-medium tabular-nums tracking-[-0.03em]',
                    stat.count === 0 ? AS_COUNT_ZERO_VALUE : 'text-zinc-900 dark:text-zinc-50',
                  )}
                >
                  {stat.count.toString()}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
};

export default ComplianceOverview;
