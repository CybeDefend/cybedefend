import React from 'react';
import { useTranslation } from 'react-i18next';
import { ContainerImage } from '@/server/interfaces/Packages';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/utils/function/utils';
import SeverityCount from '@/components/atoms/badge/SeverityCount';
import Button from '@/components/atoms/button/Button';
import { Trash2 } from '@/components/atoms/icon/icons';
import { ViewModeToggle, ViewMode } from '@/components/molecules/view-mode-toggle/ViewModeToggle';
import EolOsBanner from '@/components/molecules/banners/EolOsBanner';
import { AS_SECTION_TITLE, AS_TD, AS_TH, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

/** A SARIF import never fills the image's OS: its end-of-life banner is not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

/** A cell of a row stacked below `md`: no padding of its own, the row carries it. */
const PHONE_CELL = 'max-md:p-0 max-md:first:pl-0 max-md:last:pr-0';

interface ResultsContainerImagesTableProps {
  images: ContainerImage[];
  onImageSelect: (image: ContainerImage) => void;
  /** Left out for a member who may not delete images: no delete action is shown. */
  onDeleteClick?: (image: ContainerImage) => void;
  loading: boolean;
  /** The images request failed: say so instead of "no image". */
  error?: string | null;
  // Pagination props
  totalImages: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  // View mode props
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

const ResultsContainerImagesTable: React.FC<ResultsContainerImagesTableProps> = ({
  images,
  onImageSelect,
  onDeleteClick,
  loading,
  error = null,
  totalImages,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  viewMode,
  onViewModeChange,
}) => {
  const { t, i18n } = useTranslation();

  const convertDate = (dateString: string) => {
    if (!dateString) return t('common.unknown');
    return format(new Date(dateString), 'PP', {
      locale: i18n.language === 'fr' ? fr : undefined,
    });
  };

  const severities: {
    level: 'critical' | 'high' | 'medium' | 'low';
    labelKey: string;
    defaultLabel: string;
  }[] = [
      {
        level: 'critical',
        labelKey: 'common.severity.critical',
        defaultLabel: 'Critical',
      },
      { level: 'high', labelKey: 'common.severity.high', defaultLabel: 'High' },
      { level: 'medium', labelKey: 'common.severity.medium', defaultLabel: 'Medium' },
      { level: 'low', labelKey: 'common.severity.low', defaultLabel: 'Low' },
    ];

  /**
   * Handles the delete button click and prevents the row's onClick event from firing.
   * @param e The mouse event.
   * @param image The image to delete.
   */
  const handleDelete = (e: React.MouseEvent, image: ContainerImage) => {
    e.stopPropagation();
    onDeleteClick?.(image);
  };

  return (
    <div className="min-h-[calc(100vh-420px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <div className="px-4 sm:px-5 py-3 border-b border-zinc-200 dark:border-as-line">
          <div className="flex items-center justify-between">
            <div>
              <h2 className={AS_SECTION_TITLE}>
                {t('components.resultsContainerTable.scannedImage')}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t('components.resultsContainerTable.description')}
              </p>
            </div>
            {viewMode && onViewModeChange && (
              <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading ? (
            <div className="p-4">
              <Skeleton type="table" rows={5} columns={4} />
            </div>
          ) : images.length > 0 ? (
            /* Below `md` the rows stack (name, then the counts, branch, date and
               delete wrapped) instead of scrolling sideways. */
            <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line max-md:block">
              <thead className="bg-zinc-50/70 dark:bg-white/[0.02] max-md:hidden">
                <tr>
                  <th className={AS_TH}>
                    {t('components.resultsContainerTable.imageName')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaTemplate.vulnerabilities')}
                  </th>
                  <th className={AS_TH}>
                    {t('common.branch')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.analysisSubTable.lastScan')}
                  </th>
                  <th className={cn(AS_TH, 'text-right')}>
                    {t('common.delete')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-as-line max-md:block">
                {images.map(image => (
                  <tr
                    key={image.id}
                    onClick={() => onImageSelect(image)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-[120ms] max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-3"
                  >
                    <td className={cn(AS_TD, PHONE_CELL, 'max-md:basis-full')}>
                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {image.artifactName}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {image.osFamily} - {image.osName || ''}
                      </div>
                      {!SCANNER_ONLY_HIDDEN && image.osEosl && <EolOsBanner variant="inline" className="mt-1" />}
                    </td>
                    <td className={cn(AS_TD, PHONE_CELL, 'max-md:basis-full')}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {severities.map(({ level, labelKey, defaultLabel }) => {
                          const count = image.vulnCounts?.[level] || 0;
                          const label = t(labelKey, defaultLabel);
                          return (
                            <SeverityCount
                              key={level}
                              severity={level}
                              count={count}
                              label={label}
                              title={`${count} ${label}`}
                              aria-label={`${count} ${label}`}
                            />
                          );
                        })}
                      </div>
                    </td>
                    <td className={cn(AS_TD, PHONE_CELL)}>
                      {image.branch ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md font-mono text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-as-raised dark:text-zinc-300">
                          {image.branch}
                        </span>
                      ) : null /* no branch: an empty cell, no dash */}
                    </td>
                    <td className={cn(AS_TD, PHONE_CELL, 'tabular-nums')}>
                      {convertDate(image.updatedAt)}
                    </td>
                    <td className={cn(AS_TD, 'text-right', PHONE_CELL, 'max-md:ml-auto')}>
                      {onDeleteClick && (
                        <Button
                          variant="ghost"
                          onClick={e => handleDelete(e, image)}
                          // Icon-only: a square 44 px reach on a phone, not the atom's height-only one.
                          className={cn('w-8 px-0', AS_TOUCH_SQUARE)}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 size={16} className="text-red-600" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : error ? (
            // The request failed: the list is unknown, not empty. The server's
            // message is not shown (it is technical, and logged by the hook).
            <div className="p-4" role="alert">
              <NotFoundElement
                title={t('container.images.loadErrorTitle')}
                description={t('container.images.loadErrorDescription')}
              />
            </div>
          ) : (
            <div className="p-4">
              <NotFoundElement
                title={t('container.images.noneFound')}
                description={t(SCANNER_ONLY_HIDDEN ? 'container.images.importScan' : 'container.images.startScan')}
              />
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && images.length > 0 && (
          <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:justify-between md:items-center border-t border-zinc-200 dark:border-as-line bg-white dark:bg-as-surface">
            <div className="flex-grow flex justify-center">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalImages}
                pageSize={pageSize}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
                pageSizeOptions={[5, 10, 20, 50]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsContainerImagesTable;