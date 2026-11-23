import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupedContainerImage, ContainerImage, ContainerImageTag } from '@/server/interfaces/Packages';
import { buildImageReference } from '@/utils/function/containerImageReference';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/utils/function/utils';
import SeverityCount from '@/components/atoms/badge/SeverityCount';
import { ChevronDown, ChevronRight, Tag, Layers, Trash2 } from '@/components/atoms/icon/icons';
import { motion, AnimatePresence } from 'framer-motion';
import ViewModeToggle, { ViewMode } from '@/components/molecules/view-mode-toggle/ViewModeToggle';
import EolOsBanner from '@/components/molecules/banners/EolOsBanner';
import { AS_SECTION_TITLE, AS_TD, AS_TH } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

/** A SARIF import never fills the image's OS: its end-of-life banner is not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

interface ResultsContainerGroupedImagesTableProps {
    groupedImages: GroupedContainerImage[];
    onImageSelect: (image: ContainerImage) => void;
    onDeleteClick?: (image: ContainerImage) => void;
    loading: boolean;
    /** The grouped images request failed: say so instead of "no image". */
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

const ResultsContainerGroupedImagesTable: React.FC<ResultsContainerGroupedImagesTableProps> = ({
    groupedImages,
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
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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

    const toggleRow = (repositoryName: string) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(repositoryName)) {
                newSet.delete(repositoryName);
            } else {
                newSet.add(repositoryName);
            }
            return newSet;
        });
    };

    /**
     * Rebuilds the exact `artifactName` the backend split apart.
     * A row with no tag was scanned BY DIGEST, and a digest only attaches with
     * '@': concatenating ':' would address `repo:latest`, a different manifest,
     * and would render every digest of a repository as the same "latest" row.
     */
    const buildArtifactName = (groupedImage: GroupedContainerImage, tag: ContainerImageTag) =>
        buildImageReference(groupedImage.repositoryName, {
            name: tag.tag,
            digest: tag.digest,
            isDigest: !tag.tag && Boolean(tag.digest),
        });

    /** Row label: the tag, or a readable head of the digest when untagged. */
    const tagLabel = (tag: ContainerImageTag) => {
        if (tag.tag) return tag.tag;
        const digest = tag.digest?.trim() ?? '';
        if (!digest) return 'latest';
        const separatorIndex = digest.indexOf(':');
        return separatorIndex === -1
            ? digest.slice(0, 12)
            : `${digest.slice(0, separatorIndex + 1)}${digest.slice(separatorIndex + 1, separatorIndex + 13)}`;
    };

    const toContainerImage = (
        groupedImage: GroupedContainerImage,
        tag: ContainerImageTag,
    ): ContainerImage => ({
        id: tag.id,
        projectId: groupedImage.projectId,
        artifactName: buildArtifactName(groupedImage, tag),
        osFamily: groupedImage.osFamily,
        osName: groupedImage.osName,
        osEosl: tag.osEosl,
        createdAt: tag.createdAt || '',
        updatedAt: tag.updatedAt || '',
        vulnCounts: tag.vulnCounts || {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            unknown: 0,
        },
        branch: groupedImage.branch,
    });

    const handleTagClick = (groupedImage: GroupedContainerImage, tag: ContainerImageTag) => {
        // Convert to ContainerImage format for the parent handler
        onImageSelect(toContainerImage(groupedImage, tag));
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
                                {t('container.images.groupedDescription')}
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
                    ) : groupedImages.length > 0 ? (
                        <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line">
                            <thead className="bg-zinc-50/70 dark:bg-white/[0.02]">
                                <tr>
                                    <th className={cn(AS_TH, 'w-10')}>
                                        {/* Expand column */}
                                    </th>
                                    <th className={AS_TH}>
                                        {t('container.images.repository')}
                                    </th>
                                    <th className={AS_TH}>
                                        <div className="flex items-center gap-1">
                                            <Tag size={14} />
                                            {t('container.images.tags')}
                                        </div>
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
                                    <th className={cn(AS_TH, 'w-20')}>
                                        {t('common.actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                                {groupedImages.map(groupedImage => {
                                    const isExpanded = expandedRows.has(groupedImage.repositoryName);
                                    return (
                                        <React.Fragment key={groupedImage.repositoryName}>
                                            {/* Main row */}
                                            <tr
                                                onClick={() => toggleRow(groupedImage.repositoryName)}
                                                className={cn(
                                                    "cursor-pointer transition-colors",
                                                    isExpanded
                                                        ? "bg-zinc-50 dark:bg-as-raised"
                                                        : "hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-[120ms]"
                                                )}
                                            >
                                                <td className={AS_TD}>
                                                    <button className="p-1 hover:bg-zinc-200 dark:hover:bg-white/[0.09] rounded">
                                                        {isExpanded ? (
                                                            <ChevronDown size={18} className="text-zinc-500 dark:text-zinc-400" />
                                                        ) : (
                                                            <ChevronRight size={18} className="text-zinc-500 dark:text-zinc-400" />
                                                        )}
                                                    </button>
                                                </td>
                                                <td className={AS_TD}>
                                                    <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                                        {groupedImage.repositoryName}
                                                    </div>
                                                    <div className="text-xs text-zinc-500 dark:text-zinc-300">
                                                        {groupedImage.osFamily} - {groupedImage.osName || ''}
                                                    </div>
                                                    {!SCANNER_ONLY_HIDDEN && groupedImage.osEosl && <EolOsBanner variant="inline" className="mt-1" />}
                                                </td>
                                                <td className={AS_TD}>
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium",
                                                            "bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light"
                                                        )}>
                                                            <Layers size={12} className="mr-1" />
                                                            {groupedImage.tagCount}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className={AS_TD}>
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                        {severities.map(({ level, labelKey, defaultLabel }) => {
                                                            const count = groupedImage.aggregatedVulnCounts?.[level] || 0;
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
                                                <td className={AS_TD}>
                                                    {groupedImage.branch ? (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-as-raised dark:text-zinc-300">
                                                            {groupedImage.branch}
                                                        </span>
                                                    ) : null /* no branch: an empty cell, no dash */}
                                                </td>
                                                <td className={AS_TD}>
                                                    {convertDate(groupedImage.latestScanAt)}
                                                </td>
                                                <td className={AS_TD}>
                                                    {/* Empty for main row */}
                                                </td>
                                            </tr>

                                            {/* Expanded tags rows */}
                                            <AnimatePresence>
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={7} className="p-0">
                                                            <motion.div
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: 'auto', opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                transition={{ duration: 0.2 }}
                                                                className="overflow-hidden"
                                                            >
                                                                <div className="bg-zinc-50 dark:bg-as-surface border-l-4 border-secondary">
                                                                    <table className="min-w-full">
                                                                        <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                                                                            {groupedImage.tags.map(tag => (
                                                                                <tr
                                                                                    key={tag.id}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleTagClick(groupedImage, tag);
                                                                                    }}
                                                                                    className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/[0.03] transition-colors"
                                                                                >
                                                                                    <td className={cn(AS_TD, 'w-10')}></td>
                                                                                    <td className={AS_TD}>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <Tag size={14} className="text-secondary dark:text-secondary-light" />
                                                                                            <span
                                                                                                className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                                                                                                title={tag.digest || tag.tag}
                                                                                            >
                                                                                                {tagLabel(tag)}
                                                                                            </span>
                                                                                            {!SCANNER_ONLY_HIDDEN && tag.osEosl && <EolOsBanner variant="inline" />}
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className={AS_TD}>
                                                                                        {/* Empty for tags column alignment */}
                                                                                    </td>
                                                                                    <td className={AS_TD}>
                                                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                                                            {severities.map(({ level, labelKey, defaultLabel }) => {
                                                                                                const count = tag.vulnCounts?.[level] || 0;
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
                                                                                    <td className={AS_TD}>
                                                                                        {/* Empty for branch column alignment */}
                                                                                    </td>
                                                                                    <td className={AS_TD}>
                                                                                        {convertDate(tag.updatedAt)}
                                                                                    </td>
                                                                                    <td className={AS_TD}>
                                                                                        {onDeleteClick && (
                                                                                            <button
                                                                                                onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    // Same reference the row selects: the
                                                                                                    // deletion modal must name the image the
                                                                                                    // user is actually about to delete.
                                                                                                    onDeleteClick(toContainerImage(groupedImage, tag));
                                                                                                }}
                                                                                                className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors dark:text-zinc-400"
                                                                                                title={t('common.delete')}
                                                                                            >
                                                                                                <Trash2 size={16} />
                                                                                            </button>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </motion.div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </AnimatePresence>
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : error ? (
                        // The request failed: the list is unknown, not empty. The
                        // server's message is not shown (logged by the hook).
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
                {!loading && groupedImages.length > 0 && (
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

export default ResultsContainerGroupedImagesTable;
