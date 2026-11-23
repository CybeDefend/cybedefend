// ============================================================================
// ComplianceHistory - Table showing compliance evaluation history
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { ComplianceHistoryResponse, ComplianceHistoryEntry } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import Pagination from '@/components/molecules/pagination/Pagination';
import { History, Sync } from '@/components/atoms/icon/icons';
import {
  AS_COUNT,
  AS_COUNT_VALUE,
  AS_COUNT_ZERO_VALUE,
  AS_DOT_WORD,
  AS_PANEL_TITLE,
  AS_TD,
  AS_TH,
  AS_WORD_TONE,
} from '@/components/atoms/appsec/styles';

interface ComplianceHistoryProps {
  history: ComplianceHistoryResponse | null;
  loading: boolean;
  error: string | null;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}

const ComplianceHistory: React.FC<ComplianceHistoryProps> = ({
  history,
  loading,
  error,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onRefresh,
}) => {
  const { t } = useTranslation();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Card variant="default" padding="none">
        <div className="animate-pulse p-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-8 w-8 bg-zinc-200 dark:bg-as-raised rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-zinc-200 dark:bg-as-raised rounded w-1/3 mb-2" />
                <div className="h-3 bg-zinc-200 dark:bg-as-raised rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="default" padding="lg" className="text-center">
        <p className="text-red-500">{error}</p>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="mt-4">
          <Sync className="h-4 w-4 mr-2"  />
          {t('common.retry')}
        </Button>
      </Card>
    );
  }

  if (!history || history.entries.length === 0) {
    return (
      <Card variant="default" padding="lg" className="text-center">
        <div className="py-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-as-raised">
            <History className="h-8 w-8 text-zinc-400 dark:text-zinc-500"  />
          </div>
          <h3 className={cn(AS_PANEL_TITLE, 'mb-2')}>
            {t('pages.projectCompliance.noHistory')}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('pages.projectCompliance.noHistoryDescription')}
          </p>
        </div>
      </Card>
    );
  }

  const totalPages = Math.ceil(history.total / pageSize);

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-as-line">
        <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
          {t('pages.policies.compliance.history')}
        </h3>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <Sync className="h-4 w-4"  />
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-as-line bg-zinc-50 dark:bg-white/[0.03]">
              <th className={AS_TH}>
                {t('pages.projectCompliance.evaluatedAt')}
              </th>
              <th className={AS_TH}>
                {t('pages.policies.compliance.status')}
              </th>
              <th className={AS_TH}>
                {t('pages.projectCompliance.breakingRules')}
              </th>
              <th className={AS_TH}>
                {t('pages.policies.violations.blocking')}
              </th>
              <th className={AS_TH}>
                {t('pages.policies.violations.warning')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
            {history.entries.map((entry) => (
              <motion.tr
                key={entry.evaluationId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="hover:bg-zinc-50 dark:hover:bg-white/[0.06] transition-colors"
              >
                <td className={cn(AS_TD, 'whitespace-nowrap')}>
                  {formatDate(entry.evaluatedAt)}
                </td>
                <td className={AS_TD}>
                  {/* The status word and the counts carry their colour themselves (no dot), zeros quiet. */}
                  <span className={cn(AS_DOT_WORD, entry.compliant ? AS_WORD_TONE.good : AS_WORD_TONE.bad)}>
                    {entry.compliant
                      ? t('pages.policies.compliance.compliant')
                      : t('pages.policies.compliance.nonCompliant')}
                  </span>
                </td>
                <td className={AS_TD}>
                  <span className={AS_COUNT}>
                    <span className={entry.breakingRulesCount === 0 ? AS_COUNT_ZERO_VALUE : AS_COUNT_VALUE}>{entry.breakingRulesCount}</span>
                  </span>
                </td>
                <td className={AS_TD}>
                  <span className={AS_COUNT}>
                    <span className={entry.blockingViolationsCount === 0 ? AS_COUNT_ZERO_VALUE : AS_WORD_TONE.bad}>{entry.blockingViolationsCount}</span>
                  </span>
                </td>
                <td className={AS_TD}>
                  <span className={AS_COUNT}>
                    <span className={entry.warningViolationsCount === 0 ? AS_COUNT_ZERO_VALUE : AS_WORD_TONE.warning}>{entry.warningViolationsCount}</span>
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-4 border-t border-zinc-200 dark:border-as-line">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={history?.total || 0}
            pageSize={pageSize}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            compact
          />
        </div>
      )}
    </Card>
  );
};

export default ComplianceHistory;
