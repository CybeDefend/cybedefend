import React, { useMemo } from "react";
import Select, { Option } from "../select/Select";
import { Branch } from "@/server/interfaces/Branch";
import { useTranslation } from "react-i18next";
import { GitBranch, Shield, Target } from '@/components/atoms/icon/icons';

/**
 * Props for the BranchSelector component
 */
export interface BranchSelectorProps {
    /** List of available branches */
    branches: Branch[];
    /** Currently selected branch */
    selectedBranch: string;
    /** Default branch of the repository */
    defaultBranch?: string;
    /** Configured scan branch */
    scanBranch?: string;
    /** Callback when branch selection changes (legacy name) */
    onChange?: (branch: string) => void;
    /** Callback when branch selection changes (alternative name for flexibility) */
    onBranchChange?: (branch: string) => void;
    /** Loading state */
    loading?: boolean;
    /** Disabled state */
    disabled?: boolean;
    /** Placeholder text */
    placeholder?: string;
    /** Whether to show badges for default/scan branches */
    showBadges?: boolean;
    /** Label for the select */
    label?: string;
    /** Width of the select */
    width?: string;
    /** Error message */
    error?: string;
    /** Whether the field is required */
    required?: boolean;
    /** Show "All branches" option at the top (for filtering mode) */
    showAllOption?: boolean;
    /** Align dropdown to the right edge (prevents overflow on right side) */
    alignRight?: boolean;
    /**
     * Async mode: `branches` is one page of a backend list. The search is
     * lifted to the parent (no client-side filtering), the next page loads on
     * scroll, and an empty page is a search result, not "no branches".
     */
    async?: BranchSelectorAsyncProps;
}

/** What a paginated, backend-searched branch list hands to the picker. */
export interface BranchSelectorAsyncProps {
    onSearchChange: (value: string) => void;
    onLoadMore?: () => void;
    hasMore?: boolean;
    searching?: boolean;
    loadingMore?: boolean;
}

/**
 * Branch selection dropdown component
 * Used for selecting which branch to scan or filter by
 * Supports badges to indicate default and scan branches
 * 
 * @example
 * ```tsx
 * <BranchSelector
 *   branches={branches}
 *   selectedBranch={selectedBranch}
 *   defaultBranch="main"
 *   scanBranch="develop"
 *   onChange={setSelectedBranch}
 *   showBadges
 * />
 * ```
 */
const BranchSelector: React.FC<BranchSelectorProps> = ({
    branches,
    selectedBranch,
    defaultBranch,
    scanBranch,
    onChange,
    onBranchChange,
    loading = false,
    disabled = false,
    placeholder,
    showBadges = true,
    label,
    width = "w-48",
    error,
    required = false,
    showAllOption = false,
    alignRight = false,
    async: asyncList,
}) => {
    const { t } = useTranslation();

    // Use either onChange or onBranchChange (for flexibility)
    const handleChange = (value: string) => {
        if (onChange) {
            onChange(value);
        } else if (onBranchChange) {
            onBranchChange(value);
        }
    };

    /**
     * Transform branches into Select options with optional badges
     */
    const options: Option[] = useMemo(() => {
        const result: Option[] = [];

        // Add "All branches" option if enabled (for filtering mode)
        if (showAllOption) {
            result.push({
                label: t('components.branchSelector.allBranches'),
                value: '',
            });
        }

        // In async mode the selected branch may sit beyond the loaded page:
        // keep it among the options so the field still names it.
        const listed: Branch[] =
            asyncList && selectedBranch && !branches.some((b) => b.name === selectedBranch)
                ? [{ name: selectedBranch, isDefault: selectedBranch === defaultBranch, isProtected: false }, ...branches]
                : branches;

        if (!listed || listed.length === 0) {
            return result;
        }

        listed.forEach((branch) => {
            let displayLabel = branch.name;

            if (showBadges) {
                const badges: string[] = [];

                if (branch.name === defaultBranch || branch.isDefault) {
                    badges.push(t('components.branchSelector.defaultBadge'));
                }

                if (branch.name === scanBranch) {
                    badges.push(t('components.branchSelector.scanBadge'));
                }

                if (branch.isProtected) {
                    badges.push(t('components.branchSelector.protectedBadge'));
                }

                if (badges.length > 0) {
                    displayLabel = `${branch.name} (${badges.join(', ')})`;
                }
            }

            result.push({
                label: displayLabel,
                value: branch.name,
            });
        });

        return result;
    }, [branches, defaultBranch, scanBranch, showBadges, showAllOption, t, asyncList, selectedBranch]);

    /**
     * Default placeholder text
     */
    const defaultPlaceholder = t('components.branchSelector.placeholder');

    /**
     * Handle loading and empty states
     */
    if (loading) {
        return (
            <div className={`${width} animate-pulse`}>
                {label && (
                    <div className="h-4 w-20 mb-1.5 rounded bg-zinc-200/70 dark:bg-white/[0.06]" />
                )}
                {/* The height of the Select it stands for: 36 px, 44 px on a phone. */}
                <div className="h-9 max-md:h-11 rounded-lg bg-zinc-200/70 dark:bg-white/[0.06]" />
            </div>
        );
    }

    if (branches.length === 0 && !asyncList) {
        return (
            <div className={`${width}`}>
                {label && (
                    <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                        {label}
                    </label>
                )}
                <div className="flex min-h-9 items-center space-x-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[13px] text-zinc-700 dark:border-as-line dark:bg-white/[0.03] dark:text-zinc-300">
                    <GitBranch className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    <span>{t('components.branchSelector.noBranches')}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={width}>
            <Select
                id="branch-selector"
                label={label}
                options={options}
                value={selectedBranch}
                onChange={handleChange}
                placeholder={placeholder || defaultPlaceholder}
                width="w-full"
                error={error}
                required={required}
                alignRight={alignRight}
                {...(asyncList
                    ? {
                          searchable: true,
                          onSearchChange: asyncList.onSearchChange,
                          onLoadMore: asyncList.onLoadMore,
                          hasMore: asyncList.hasMore,
                          searching: asyncList.searching,
                          loadingMore: asyncList.loadingMore,
                      }
                    : {})}
            />
        </div>
    );
};

export default BranchSelector;
