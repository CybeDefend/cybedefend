// ============================================================================
// ProjectsComplianceTable - Main table for displaying project compliance data
// ============================================================================

import React from 'react';
import { EmptyState as SharedEmptyState } from '@/components/molecules/empty-state';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { motion } from 'framer-motion';
import { formatRelativeTime } from '@/utils/relativeTime';
import { cn } from '@/utils/function/utils';
import { projectPath } from '@/utils/product';
import Card from '@/components/atoms/card/Card';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import Button from '@/components/atoms/button/Button';
import Pagination from '@/components/molecules/pagination/Pagination';
import { ProjectComplianceData } from '@/server/interfaces/OrganizationCompliance';
import ComplianceStatusBadge from './ComplianceStatusBadge';
import { ClipboardList, ExternalLinkAlt } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE, AS_TD, AS_TH } from '@/components/atoms/appsec/styles';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';

interface ProjectsComplianceTableProps {
  projects: ProjectComplianceData[];
  loading: boolean;
  error: string | null;
  
  // Pagination
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** The search and filters of the list, set in the table's own header. */
  toolbar?: React.ReactNode;
}

/**
 * Table row skeleton loader
 */
const TableRowSkeleton: React.FC = () => (
  <tr>
    <td className={AS_TD}>
      <Skeleton className="h-4 w-3/4" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-6 w-24" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-4 w-12 mx-auto" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-4 w-12 mx-auto" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-4 w-12 mx-auto" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-4 w-20" />
    </td>
    <td className={AS_TD}>
      <Skeleton className="h-8 w-20 ml-auto" />
    </td>
  </tr>
);

/** The shared molecule, given this table's icon. */
const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <SharedEmptyState title={message} icon={<ClipboardList className="h-1/2 w-1/2" />} />
);

/**
 * ProjectsComplianceTable - Displays project compliance data in a table
 */
const ProjectsComplianceTable: React.FC<ProjectsComplianceTableProps> = ({
  projects,
  loading,
  error,
  currentPage,
  pageSize,
  totalPages,
  totalItems,
  onPageChange,
  onPageSizeChange,
  toolbar,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const handleViewProject = (projectId: string) => {
    navigate(projectPath('appsec', projectId, 'compliance'));
  };

  const formatLastEvaluated = (dateStr?: string): string => {
    if (!dateStr) return t('pages.complianceOverview.table.never');
    // « 2 hours ago » / « il y a 2 heures »: in the interface's language.
    return formatRelativeTime(dateStr, i18n.language) ?? dateStr;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
    >
      <Card className={cn('!p-0 rounded-2xl dark:bg-as-surface dark:border-as-line overflow-hidden')}>
        {/* Table Header */}
        {/* The title, then the list's own search and filters: one header, no icon tile. */}
        <div className="space-y-4 border-b border-zinc-200 px-4 py-4 dark:border-as-line sm:px-5">
          <div>
            <h3 className={AS_PANEL_TITLE}>
              {t('pages.complianceOverview.table.title')}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('pages.complianceOverview.table.description')}
            </p>
          </div>
          {toolbar}
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50/70 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-as-line">
              <tr>
                <th className={AS_TH}>
                  {t('pages.complianceOverview.table.projectName')}
                </th>
                <th className={AS_TH}>
                  {t('pages.complianceOverview.table.status')}
                </th>
                <th className={cn(AS_TH, 'text-center')}>
                  {t('pages.complianceOverview.table.blocked')}
                </th>
                <th className={cn(AS_TH, 'text-center')}>
                  {t('pages.complianceOverview.table.warnings')}
                </th>
                <th className={cn(AS_TH, 'text-center')}>
                  {t('pages.complianceOverview.table.totalViolations')}
                </th>
                <th className={AS_TH}>
                  {t('pages.complianceOverview.table.lastEvaluated')}
                </th>
                <th className={cn(AS_TH, 'text-right')}>
                  {t('pages.complianceOverview.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
              {loading ? (
                // Skeleton loaders
                Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} />)
              ) : projects.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      message={t('pages.complianceOverview.table.noProjects')}
                    />
                  </td>
                </tr>
              ) : (
                // Data rows
                projects.map((project, index) => (
                  <motion.tr
                    key={project.projectId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                    className="cursor-pointer transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                    onClick={() => handleViewProject(project.projectId)}
                  >
                    <td className={AS_TD}>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {project.projectName}
                      </span>
                    </td>
                    <td className={AS_TD}>
                      <ComplianceStatusBadge status={project.complianceStatus} />
                    </td>
                    <td className={cn(AS_TD, 'text-center')}>
                      <span
                        className={cn(
                          'font-mono font-medium tabular-nums',
                          project.blockedCount > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        )}
                      >
                        {project.blockedCount}
                      </span>
                    </td>
                    <td className={cn(AS_TD, 'text-center')}>
                      <span
                        className={cn(
                          'font-mono font-medium tabular-nums',
                          project.warnedCount > 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        )}
                      >
                        {project.warnedCount}
                      </span>
                    </td>
                    <td className={cn(AS_TD, 'text-center')}>
                      <span className="font-mono font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                        {project.totalViolations}
                      </span>
                    </td>
                    <td className={AS_TD}>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {formatLastEvaluated(project.lastEvaluatedAt)}
                      </span>
                    </td>
                    <td className={cn(AS_TD, 'text-right')} onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewProject(project.projectId)}
                        icon={<ExternalLinkAlt className="h-4 w-4"  />}
                      >
                        {t('pages.complianceOverview.table.view')}
                      </Button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-as-line">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      </Card>
    </motion.div>
  );
};

export default ProjectsComplianceTable;
