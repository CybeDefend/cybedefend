import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/function/utils';
import { ProjectBranch } from '@/server/interfaces/Vulnerability';
import { Archive, Box, ChevronDown, CodeBranch, Eye, EyeSlash, Search, Spinner, Star } from '@/components/atoms/icon/icons';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';

interface BranchSelectorProps {
    /** Available branches (including archived ones) */
    branches: ProjectBranch[];
    /** Currently selected branch (null means all branches) */
    selectedBranch: string | null;
    /** Callback when branch changes */
    onBranchChange: (branch: string | null) => void;
    /** Callback to archive a branch */
    onArchive?: (branchName: string) => void;
    /** Callback to unarchive a branch */
    onUnarchive?: (branchName: string) => void;
    /** Optional label */
    label?: string;
    /** Show "All branches" option */
    showAllOption?: boolean;
    /** Loading state */
    loading?: boolean;
    /** Additional class names */
    className?: string;
    /** Compact mode */
    compact?: boolean;
    /** Disabled state */
    disabled?: boolean;
    /** Default branch name (unused internally, for parent ref) */
    defaultBranch?: string;
    /** Legacy alias for onBranchChange */
    onChange?: (branch: string | null) => void;
    // ── Async / paginated mode ──────────────────────────────────────────────
    /** Enable async mode: backend provides filtered+sorted results; disables client-side filtering */
    async?: boolean;
    /** Lifted search handler (debounced upstream) */
    onSearchChange?: (value: string) => void;
    /** Load next page */
    onLoadMore?: () => void;
    /** Whether there are more pages to load */
    hasMore?: boolean;
    /** True while the backend is searching (new query in-flight) */
    searching?: boolean;
    /** True while loading the next page */
    loadingMore?: boolean;
    /** Whether archived branches are currently included in the backend results */
    includeArchived?: boolean;
    /** Toggle includeArchived on the backend */
    onToggleArchived?: () => void;
}

/**
 * BranchSelector - Dropdown component for selecting a branch
 * Supports archiving/unarchiving branches. Archived branches are hidden by default.
 *
 * In async mode (async={true}) the component:
 * - lifts search input up via onSearchChange (no client-side filtering)
 * - fires onLoadMore when the user scrolls near the bottom (infinite scroll)
 * - shows a spinner row when searching || loadingMore
 * - delegates the archived toggle to onToggleArchived instead of local state
 *
 * Full-list mode (no async prop) is byte-for-byte behaviourally identical to before.
 */
const BranchSelector: React.FC<BranchSelectorProps> = ({
    branches,
    selectedBranch,
    onBranchChange,
    onArchive,
    onUnarchive,
    label,
    showAllOption = true,
    loading = false,
    className,
    compact = false,
    disabled = false,
    defaultBranch: _defaultBranch,
    onChange,
    async: asyncProp,
    onSearchChange,
    onLoadMore,
    hasMore = false,
    searching = false,
    loadingMore = false,
    includeArchived = false,
    onToggleArchived,
}) => {
    const asyncMode = !!asyncProp;

    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Support both onBranchChange and onChange
    const handleBranchChange = useCallback((val: string | null) => {
        onBranchChange?.(val);
        onChange?.(val);
    }, [onBranchChange, onChange]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus search input when dropdown opens, reset when it closes
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
        } else {
            setSearchQuery('');
        }
    }, [isOpen]);

    // ── Full-list mode: client-side split & sort ──────────────────────────
    const archivedBranches = branches.filter(b => b.archived);
    const activeBranches = branches.filter(b => !b.archived);
    const hasArchived = archivedBranches.length > 0;

    // Sort branches: default first, then alphabetical
    const sortBranches = (list: ProjectBranch[]) =>
        [...list].sort((a, b) => {
            if (a.isDefault && !b.isDefault) return -1;
            if (!a.isDefault && b.isDefault) return 1;
            return a.name.localeCompare(b.name);
        });

    const sortedActive = sortBranches(activeBranches);
    const sortedArchived = sortBranches(archivedBranches);

    // Filter by search query (full-list mode only)
    const filterBySearch = (list: ProjectBranch[]) =>
        searchQuery
            ? list.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : list;

    const filteredActive = filterBySearch(sortedActive);
    const filteredArchived = filterBySearch(sortedArchived);

    // ── Async mode: backend already filtered+sorted ───────────────────────
    // In async mode we render the incoming branches as-given (server ordering).
    // The archived split is identical to the full-list splits — alias to avoid
    // double filtering the same array.
    const asyncActiveBranches = activeBranches;
    const asyncArchivedBranches = archivedBranches;

    // ── Scroll handler for infinite scroll (async mode only) ─────────────
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (!asyncMode || !hasMore || loadingMore) return;
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) onLoadMore?.();
    };

    const handleSelect = useCallback((branchName: string | null) => {
        handleBranchChange(branchName);
        setIsOpen(false);
    }, [handleBranchChange]);

    const handleArchiveClick = useCallback((e: React.MouseEvent, branchName: string, archived: boolean) => {
        e.stopPropagation();
        if (archived && onUnarchive) {
            onUnarchive(branchName);
        } else if (!archived && onArchive) {
            onArchive(branchName);
        }
    }, [onArchive, onUnarchive]);

    // ── Search input change handler ───────────────────────────────────────
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearchQuery(val);
        if (asyncMode) {
            onSearchChange?.(val);
        }
    };

    // Don't render if no branches AND no "All" option AND not loading.
    // Async mode is exempt: there an empty list is a *search* result, not an
    // empty project — unmounting would yank the trigger and the search input
    // out from under a user who is mid-search, leaving them unable to query
    // another branch. Async keeps the selector mounted and shows a no-results
    // empty state instead (see `showNoResults`).
    if (!asyncMode && branches.length === 0 && !showAllOption && !loading) {
        return null;
    }

    if (loading) {
        return (
            <div className={cn('animate-pulse', compact ? 'w-48' : 'w-full', className)}>
                {label && <div className="h-4 bg-zinc-200 dark:bg-as-raised rounded w-20 mb-2" />}
                <div className="h-8 bg-zinc-200 dark:bg-white/[0.06] rounded-lg" />
            </div>
        );
    }

    const selectedLabel = selectedBranch
        ? branches.find(b => b.name === selectedBranch)?.name || selectedBranch
        : showAllOption
            ? t('components.branchSelector.allBranches')
            // Never claim "All branches" when that option is disabled — prompt
            // the user to pick a concrete branch instead.
            : t('components.branchSelector.selectBranch');

    const canArchive = !!(onArchive || onUnarchive);

    // ── Archived footer toggle ────────────────────────────────────────────
    // Full-list mode: uses local showArchived state + count in label.
    // Async mode: delegates to onToggleArchived, reflects includeArchived,
    //             count = currently-loaded archived items (or omitted when unknown).
    const showArchivedFooter = asyncMode
        ? !!onToggleArchived
        : hasArchived;

    const renderArchivedToggle = () => {
        if (asyncMode) {
            // The async list holds the archived branches only once they are
            // shown, and all of them only once no page is left: a count before
            // that would be false (« (0) » for a project that has some).
            const archivedCountKnown = includeArchived && !hasMore;
            return (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleArchived?.(); }}
                    className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                >
                    {includeArchived ? <EyeSlash className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {includeArchived
                        ? archivedCountKnown
                            ? t('components.branchSelector.hideArchived', { count: asyncArchivedBranches.length })
                            : t('components.branchSelector.hideArchivedUncounted')
                        : t('components.branchSelector.showArchivedUncounted')
                    }
                </button>
            );
        }
        return (
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowArchived(!showArchived); }}
                className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            >
                {showArchived ? <EyeSlash className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showArchived
                    ? t('components.branchSelector.hideArchived', { count: archivedBranches.length })
                    : t('components.branchSelector.showArchived', { count: archivedBranches.length })
                }
            </button>
        );
    };

    // ── Rendered lists (differ by mode) ──────────────────────────────────
    const renderedActive = asyncMode ? asyncActiveBranches : filteredActive;
    const renderedArchived = asyncMode ? asyncArchivedBranches : filteredArchived;
    const showArchivedSection = asyncMode ? (includeArchived && renderedArchived.length > 0) : (showArchived && filteredArchived.length > 0);
    const showNoResults = asyncMode
        // Async mode: an empty list is a *search* result, not "no branches".
        // Show the empty state only once the query settles (no fetch in flight)
        // so the user knows to try another name — instead of the dropdown
        // silently collapsing. The inline spinner covers the in-flight window.
        ? (!searching && !loadingMore && renderedActive.length === 0 && !showArchivedSection)
        : (filteredActive.length === 0 && (!showArchived || filteredArchived.length === 0));

    return (
        <div ref={dropdownRef} className={cn('relative', compact ? 'w-48' : 'w-full', className)}>
            {label && (
                <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {label}
                </label>
            )}
            {/* Trigger button */}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={cn(
                    'relative flex h-8 items-center justify-between gap-2 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300',
                    'dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]',
                    AS_FOCUS,
                    AS_TOUCH,
                    isOpen && 'border-secondary/60 ring-[3px] ring-secondary/15 dark:border-secondary-light/50 dark:ring-secondary/25',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
            >
                <span className="flex items-center gap-2 truncate">
                    <CodeBranch className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500"  />
                    <span className={cn('truncate text-zinc-900 dark:text-zinc-100', selectedBranch && 'font-mono')}>{selectedLabel}</span>
                    {selectedBranch && branches.find(b => b.name === selectedBranch)?.isDefault && (
                        <Star className="h-3 w-3 shrink-0 text-zinc-500 dark:text-zinc-400" title={t('components.branchSelector.defaultBranch')} />
                    )}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500 transition-transform', isOpen && 'rotate-180')}  />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 mt-1 w-full min-w-[220px] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]">
                    {/* Search input */}
                    <div className="px-3 py-2 border-b border-zinc-100 dark:border-as-line">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"  />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={handleSearchChange}
                                placeholder={t('components.branchSelector.searchPlaceholder')}
                                className="h-8 w-full pl-7 pr-2 text-[13px] max-md:text-base bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line-strong rounded-md focus:outline-none focus:border-secondary/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    </div>
                    {/* Options list */}
                    <div
                        className="max-h-60 overflow-y-auto"
                        data-testid="branch-options"
                        onScroll={handleScroll}
                    >
                        {/* All branches option */}
                        {showAllOption && (
                            <button
                                type="button"
                                onClick={() => handleSelect(null)}
                                className={cn(
                                    'relative w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors duration-[80ms] max-md:min-h-11',
                                    !selectedBranch
                                        ? 'bg-secondary/[0.06] text-secondary font-medium dark:bg-secondary/[0.12] dark:text-secondary-light'
                                        : 'text-zinc-900 dark:text-zinc-100'
                                )}
                            >
                                {t('components.branchSelector.allBranches')}
                            </button>
                        )}

                        {/* Active branches */}
                        {renderedActive.map(branch => (
                            <div
                                key={branch.name}
                                className={cn(
                                    'group flex items-center justify-between px-3 py-2 text-[13px] hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors duration-[80ms] cursor-pointer max-md:min-h-11',
                                    selectedBranch === branch.name
                                        ? 'bg-secondary/[0.06] text-secondary font-medium dark:bg-secondary/[0.12] dark:text-secondary-light'
                                        : 'text-zinc-900 dark:text-zinc-100'
                                )}
                                onClick={() => handleSelect(branch.name)}
                            >
                                <span className="flex items-center gap-2 truncate">
                                    <span className="truncate font-mono">{branch.name}</span>
                                    {branch.isDefault && (
                                        <Star className="h-3 w-3 shrink-0 text-zinc-500 dark:text-zinc-400" title={t('components.branchSelector.defaultBranch')} />
                                    )}
                                </span>
                                {canArchive && (
                                    <button
                                        type="button"
                                        onClick={(e) => handleArchiveClick(e, branch.name, false)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-amber-500 transition-colors shrink-0 dark:text-zinc-400"
                                        title={t('components.branchSelector.archive')}
                                    >
                                        <Archive className="h-4 w-4"  />
                                    </button>
                                )}
                            </div>
                        ))}

                        {/* Archived branches section */}
                        {/* No results message (full-list mode, or a settled async search) */}
                        {showNoResults && (
                            <div className="px-3 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 text-center">
                                {t('components.branchSelector.noResults')}
                            </div>
                        )}

                        {showArchivedSection && (
                            <>
                                <div className="px-3 py-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-as-raised border-t border-zinc-100 dark:border-as-line">
                                    {t('components.branchSelector.archivedSection')}
                                </div>
                                {renderedArchived.map(branch => (
                                    <div
                                        key={branch.name}
                                        className={cn(
                                            'group flex items-center justify-between px-3 py-2 text-[13px] hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors duration-[80ms] cursor-pointer opacity-60 max-md:min-h-11',
                                            selectedBranch === branch.name
                                                ? 'bg-secondary/[0.06] text-secondary font-medium opacity-100 dark:bg-secondary/[0.12] dark:text-secondary-light'
                                                : 'text-zinc-900 dark:text-zinc-100'
                                        )}
                                        onClick={() => handleSelect(branch.name)}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <span className="truncate font-mono">{branch.name}</span>
                                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium shrink-0">
                                                {t('components.branchSelector.archivedBadge')}
                                            </span>
                                        </span>
                                        {canArchive && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleArchiveClick(e, branch.name, true)}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-emerald-500 transition-colors shrink-0 dark:text-zinc-400"
                                                title={t('components.branchSelector.unarchive')}
                                            >
                                                <Box className="h-4 w-4"  />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}

                        {/* Async mode: inline spinner row when searching or loading more pages */}
                        {asyncMode && (searching || loadingMore) && (
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                                <Spinner className="h-4 w-4 animate-spin"  />
                                <span>
                                    {searching
                                        ? t('components.branchSelector.searching')
                                        : t('components.branchSelector.loadingMore')
                                    }
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Footer: toggle archived */}
                    {showArchivedFooter && (
                        <div className="border-t border-zinc-100 dark:border-as-line px-3 py-2">
                            {renderArchivedToggle()}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default BranchSelector;
