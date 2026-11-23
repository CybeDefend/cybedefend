// ============================================================================
// PolicyList Component - Displays list of policies with actions
// ============================================================================

import React from 'react';
import { EmptyState } from '@/components/molecules/empty-state';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import { Policy } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import Pagination from '@/components/molecules/pagination/Pagination';

import PolicyCard from './PolicyCard';
import { Plus, ShieldAlt } from '@/components/atoms/icon/icons';

import { AS_DIVIDE } from '@/components/atoms/appsec/styles';
import { AS_NOTICE_BLOCK, AS_NOTICE_DOT_BLOCK, AS_NOTICE_TITLE, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
interface PolicyListProps {
  policies: Policy[];
  loading: boolean;
  error: string | null;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
  onExport: (policy: Policy) => void;
  onToggleEnabled: (policy: Policy) => void;
  exportingId: string | null;
  currentPage: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onCreateClick: () => void;
  /** The search and filters of the list, set at the top of its panel. */
  toolbar?: React.ReactNode;
}

/**
 * The policies as one panel: the filters at the top, a
 * one-line count of what the list holds, then one hairline row per policy and
 * the pager at the foot. The figures that sat in a separate panel under the
 * list now head it, as dot and mono count; the cards became rows.
 */
const PolicyList: React.FC<PolicyListProps> = ({
  policies,
  loading,
  error,
  onEdit,
  onDelete,
  onExport,
  onToggleEnabled,
  exportingId,
  currentPage,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onCreateClick,
  toolbar,
}) => {
  const { t } = useTranslation();

  const activeCount = policies.filter((p) => p.isEnabled).length;
  const inactiveCount = policies.filter((p) => !p.isEnabled).length;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <ul className={AS_DIVIDE} aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <li key={i} className="animate-pulse px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="mb-2 h-4 w-1/3 rounded bg-zinc-200 dark:bg-white/[0.06]" />
                <div className="mb-2 h-3.5 w-2/3 rounded bg-zinc-200 dark:bg-white/[0.06]" />
                <div className="h-3 w-1/4 rounded bg-zinc-200 dark:bg-white/[0.06]" />
              </div>
              <div className="flex gap-1">
                <div className="h-8 w-8 rounded-lg bg-zinc-200 dark:bg-white/[0.06]" />
                <div className="h-8 w-8 rounded-lg bg-zinc-200 dark:bg-white/[0.06]" />
                <div className="h-8 w-8 rounded-lg bg-zinc-200 dark:bg-white/[0.06]" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (error) {
    body = (
      <div className="p-4 sm:p-5">
        <div className={AS_NOTICE_BLOCK}>
          <div>
            <p className={cn(AS_NOTICE_TITLE, WORD_TONE.bad)}>{t('errors.generic.loadingFailed')}</p>
            <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{error}</p>
          </div>
        </div>
      </div>
    );
  } else if (policies.length === 0) {
    // One primary action per screen: when the list is empty the page header
    // hides its "Create a policy" button and this one carries it, instead of
    // the same button appearing twice on one view.
    body = (
      <div className="p-4 sm:p-6">
        <EmptyState
          size="lg"
          icon={<ShieldAlt className="h-1/2 w-1/2" />}
          title={t('pages.policies.noPolicies')}
          description={t('pages.policies.createFirst')}
          action={
            <Button
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={onCreateClick}
            >
              {t('pages.policies.addPolicy')}
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        {/* What the list holds, in one phrase (it was a separate panel under the list); « Active » carries its green itself. */}
        <p className="border-b border-zinc-100 px-4 py-2.5 text-[13px] text-zinc-600 dark:border-as-line dark:text-zinc-400 sm:px-5">
          <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{total}</span>{' '}
          {t('pages.policies.totalPolicies')},{' '}
          <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{activeCount}</span>{' '}
          <span className={WORD_TONE.good}>{t('pages.policies.activePolicies')}</span>,{' '}
          <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{inactiveCount}</span>{' '}
          {t('pages.policies.inactivePolicies')}
        </p>

        <ul className={AS_DIVIDE}>
          <AnimatePresence mode="popLayout" initial={false}>
            {policies.map((policy) => (
              <motion.li
                key={policy.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <PolicyCard
                  policy={policy}
                  onEdit={() => onEdit(policy)}
                  onDelete={() => onDelete(policy)}
                  onExport={() => onExport(policy)}
                  onToggleEnabled={() => onToggleEnabled(policy)}
                  isExporting={exportingId === policy.id}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-zinc-100 px-4 py-3 dark:border-as-line sm:px-5">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={() => {}}
              compact
            />
          </div>
        )}
      </>
    );
  }

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      {toolbar && (
        <div className="border-b border-zinc-200 p-3 dark:border-as-line sm:p-4">{toolbar}</div>
      )}
      {body}
    </Card>
  );
};

export default PolicyList;
