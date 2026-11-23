import React from 'react';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { cn } from '@/utils/function/utils';

/**
 * Skeleton loader for analysis result pages (SAST, IAC, SCA, Container)
 * Displays a loading placeholder that mimics the real AnalyseWrapper + Table structure
 * Uses the Skeleton atom component for consistent styling
 */
export const AnalysePageSkeleton: React.FC = () => {
    return (
        <div className="animate-in fade-in duration-300">
            {/* AnalyseWrapper Header Section */}
            <div className="bg-white dark:bg-as-surface">
                <div className="px-6 pt-6">
                    {/* Back button */}
                    <div className="flex items-center gap-2 mb-4">
                        <Skeleton type="block" height="20px" width="20px" rounded="md" />
                        <Skeleton type="line" width="120px" />
                    </div>

                    {/* Title row: Project name + Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2 mb-4">
                        <div className="flex items-center gap-2">
                            <Skeleton type="line" width="100px" />
                            <Skeleton type="line" width="180px" />
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4">
                            <Skeleton type="button" height="40px" width="100px" />
                            <Skeleton type="button" height="40px" width="120px" />
                        </div>
                    </div>

                    {/* Branch selector row */}
                    <div className="flex items-center gap-2 mb-4">
                        <Skeleton type="line" width="60px" />
                        <Skeleton type="block" height="40px" width="280px" rounded="xl" />
                    </div>
                </div>

                {/* Tabs Section */}
                <div className="border-b border-zinc-200 dark:border-as-line">
                    <div className="flex items-center gap-1 px-6 overflow-x-auto overflow-y-hidden scrollbar-hide">
                        {[100, 150, 180, 140].map((width, i) => (
                            <div key={i} className="flex items-center gap-2 px-4 py-3">
                                <Skeleton type="line" width={`${width}px`} />
                                <Skeleton type="block" height="20px" width="32px" rounded="full" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content Section (Table) */}
            <div className="p-6">
                <div className="min-h-[calc(100vh-300px)] w-full max-w-full mx-auto flex flex-col">
                    <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
                        {/* Filters Row */}
                        <div className="px-6 py-4 flex flex-wrap gap-3 items-center justify-between border-b border-zinc-100 dark:border-as-line bg-zinc-50/50 dark:bg-white/[0.03]">
                            <div className="flex items-center gap-4 flex-wrap">
                                <Skeleton type="line" width="60px" />
                                <Skeleton type="button" height="40px" width="110px" />
                                <Skeleton type="button" height="40px" width="100px" />
                                <Skeleton type="button" height="40px" width="100px" />
                                <Skeleton type="line" width="60px" />
                                <Skeleton type="button" height="40px" width="120px" />
                                <Skeleton type="button" height="40px" width="120px" />
                            </div>
                            <Skeleton type="block" height="40px" width="200px" rounded="xl" />
                        </div>

                        {/* Table Header */}
                        <div className="bg-zinc-50 dark:bg-white/[0.03] border-b border-zinc-100 dark:border-as-line">
                            <div className="grid grid-cols-7 gap-4 px-6 py-3">
                                {[70, 60, 80, 80, 60, 60, 100].map((w, i) => (
                                    <Skeleton key={i} type="line" width={`${w}px`} height="12px" className={i === 1 ? 'col-span-2' : ''} />
                                ))}
                            </div>
                        </div>

                        {/* Table Rows */}
                        <div className="flex-1 overflow-auto bg-white dark:bg-as-surface">
                            {[...Array(8)].map((_, rowIndex) => (
                                <div
                                    key={rowIndex}
                                    className={cn(
                                        "grid grid-cols-7 gap-4 px-6 py-4 items-center",
                                        "border-b border-zinc-100 dark:border-as-line last:border-0"
                                    )}
                                >
                                    <Skeleton type="block" height="28px" width="80px" rounded="full" />
                                    <div className="col-span-2 space-y-2">
                                        <Skeleton type="line" width="90%" />
                                        <Skeleton type="line" width="60%" height="12px" />
                                    </div>
                                    <Skeleton type="block" height="24px" width="60px" rounded="lg" />
                                    <Skeleton type="block" height="24px" width="70px" rounded="full" />
                                    <Skeleton type="block" height="24px" width="60px" rounded="lg" />
                                    <Skeleton type="line" width="80px" />
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        <div className="px-6 py-4 border-t border-zinc-100 dark:border-as-line bg-zinc-50/50 dark:bg-white/[0.03]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Skeleton type="line" width="80px" />
                                    <Skeleton type="button" height="32px" width="70px" />
                                </div>
                                <div className="flex items-center gap-2">
                                    {[...Array(5)].map((_, i) => (
                                        <Skeleton key={i} type="block" height="32px" width="32px" rounded="lg" />
                                    ))}
                                </div>
                                <Skeleton type="line" width="120px" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AnalysePageSkeleton;
