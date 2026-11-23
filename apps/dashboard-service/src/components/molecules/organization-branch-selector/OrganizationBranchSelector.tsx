import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/function/utils';
import { getBatchProjectsBranches } from '@/server/services/resultService';
import { ProjectAnalysis } from '@/server/interfaces/Project';
import { ChevronDown, CodeBranch, Search } from '@/components/atoms/icon/icons';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';

/** A branch with its project context */
interface OrgBranch {
  name: string;
  projectId: string;
  projectName: string;
  isDefault: boolean;
}

interface OrganizationBranchSelectorProps {
  /** Organization id — drives the batch endpoint scope + Permify check. */
  organizationId: string;
  /** All organization projects */
  projects: ProjectAnalysis[];
  /** Optional: only show branches for these project IDs */
  filteredProjectIds?: string[];
  /** Currently selected branch names (composite keys: `${projectId}::${name}`) */
  selectedBranches: string[];
  /** Callback when selection changes */
  onChange: (branches: string[]) => void;
  /** Loading state */
  loading?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * OrganizationBranchSelector — multi-select branch dropdown for the
 * organization overview page.
 *
 * Lazily pulls branches from `GET /organization/:orgId/projects/branches`
 * the first time the dropdown opens, then keeps the result in component
 * state. Switched away from the per-project fan-out (N×2 requests) to a
 * single batch call. Archived branches are not surfaced — the use case
 * here is a filter over recent scans, not branch lifecycle management.
 */
const OrganizationBranchSelector: React.FC<OrganizationBranchSelectorProps> = ({
  organizationId,
  projects,
  filteredProjectIds,
  selectedBranches,
  onChange,
  loading = false,
  className,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allBranches, setAllBranches] = useState<OrgBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [fetchedProjectIds, setFetchedProjectIds] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Focus search when open, reset when closed
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Determine which projects to load branches for
  const targetProjects = useMemo(() => {
    if (filteredProjectIds && filteredProjectIds.length > 0) {
      return projects.filter(p => filteredProjectIds.includes(p.projectId));
    }
    return projects;
  }, [projects, filteredProjectIds]);

  // Fetch branches for all target projects.
  // Lazy: only fires when the dropdown is opened — page load with 20
  // projects no longer issues 40 branch fetches up-front. A single
  // batch endpoint replaces the per-project fan-out.
  useEffect(() => {
    if (!isOpen) return;
    if (!organizationId || targetProjects.length === 0) {
      setAllBranches([]);
      return;
    }

    // Only re-fetch if the project ids changed
    const ids = targetProjects.map(p => p.projectId).sort().join(',');
    const prevIds = fetchedProjectIds.sort().join(',');
    if (ids === prevIds) return;

    let cancelled = false;
    const fetchAll = async () => {
      setBranchesLoading(true);
      try {
        const projectIds = targetProjects.map(p => p.projectId);
        const { projects: entries } = await getBatchProjectsBranches(
          organizationId,
          projectIds,
        );

        // Map back into the {projectId, projectName, branchName} shape the
        // grouping + rendering code expects. The reference branch
        // (★, checked by default) is the project's configured `defaultBranch`
        // when the batch endpoint returns one that was actually scanned;
        // otherwise the conventional "main"/"master" naming is used.
        const byId = new Map(targetProjects.map(p => [p.projectId, p.name]));
        const results: OrgBranch[] = [];
        for (const entry of entries) {
          const projectName = byId.get(entry.projectId) ?? entry.projectId;
          const reference =
            entry.defaultBranch && entry.branches.includes(entry.defaultBranch)
              ? entry.defaultBranch
              : null;
          for (const name of entry.branches) {
            results.push({
              name,
              projectId: entry.projectId,
              projectName,
              isDefault: reference ? name === reference : name === 'main' || name === 'master',
            });
          }
        }

        if (!cancelled) {
          setAllBranches(results);
          setFetchedProjectIds(targetProjects.map(p => p.projectId));
        }
      } catch {
        // The batch is refused as a whole (403) when one project is not
        // readable by the caller: show no branch rather than the previous
        // set's. The project set is not recorded, so the next open retries.
        if (!cancelled) setAllBranches([]);
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [isOpen, organizationId, targetProjects]);

  // Composite keys for all branches (projectId::branchName)
  const allBranchKeys = useMemo(() => {
    return allBranches.map(b => `${b.projectId}::${b.name}`).sort();
  }, [allBranches]);

  // Composite keys for reference branches only — each project's default
  // branch (main/master), i.e. the ★ ones. These are what we check by
  // default; see the auto-select effect below.
  const referenceBranchKeys = useMemo(() => {
    return allBranches
      .filter(b => b.isDefault)
      .map(b => `${b.projectId}::${b.name}`)
      .sort();
  }, [allBranches]);

  // "All branches" = selectedBranches contains every key
  const isAllSelected = useMemo(() => {
    if (allBranchKeys.length === 0) return true;
    return allBranchKeys.every(key => selectedBranches.includes(key));
  }, [allBranchKeys, selectedBranches]);

  // Default the selection when branches first load. We check the reference
  // branches only (each project's main/master) rather than every branch, so
  // the overview isn't aggregated across all the feature branches by default.
  // If a project set exposes no reference branch at all, fall back to selecting
  // everything so the overview is never left empty. An explicit "all" selection
  // is preserved across branch-set changes (e.g. narrowing the project filter).
  const prevKeysRef = useRef<string>('');
  useEffect(() => {
    if (allBranchKeys.length === 0) return;
    const keysStr = allBranchKeys.join(',');
    if (keysStr === prevKeysRef.current) return;
    prevKeysRef.current = keysStr;
    if (selectedBranches.length === 0) {
      onChange(referenceBranchKeys.length > 0 ? referenceBranchKeys : allBranchKeys);
    } else if (isAllSelected) {
      onChange(allBranchKeys);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBranchKeys]);

  // Group by project
  const groupByProject = useCallback((list: OrgBranch[]) => {
    const map = new Map<string, { projectName: string; branches: OrgBranch[] }>();
    for (const b of list) {
      if (!map.has(b.projectId)) {
        map.set(b.projectId, { projectName: b.projectName, branches: [] });
      }
      map.get(b.projectId)!.branches.push(b);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].projectName.localeCompare(b[1].projectName),
    );
  }, []);

  // Filter by search
  const filterBySearch = useCallback(
    (list: OrgBranch[]) => {
      if (!searchQuery) return list;
      const q = searchQuery.toLowerCase();
      return list.filter(
        b =>
          b.name.toLowerCase().includes(q) ||
          b.projectName.toLowerCase().includes(q),
      );
    },
    [searchQuery],
  );

  const filteredBranches = useMemo(
    () => filterBySearch(allBranches),
    [filterBySearch, allBranches],
  );
  const groupedBranches = useMemo(
    () => groupByProject(filteredBranches),
    [groupByProject, filteredBranches],
  );

  // Toggle a branch (by composite key) in/out of selection
  const toggleBranch = useCallback(
    (projectId: string, name: string) => {
      const key = `${projectId}::${name}`;
      if (selectedBranches.includes(key)) {
        const newSelection = selectedBranches.filter(b => b !== key);
        onChange(
          newSelection.length > 0
            ? newSelection
            : allBranchKeys.filter(k => k !== key),
        );
      } else {
        onChange([...selectedBranches, key]);
      }
    },
    [selectedBranches, onChange, allBranchKeys],
  );

  // Select all branches
  const selectAll = useCallback(() => {
    onChange(allBranchKeys);
  }, [onChange, allBranchKeys]);

  // Display text
  const displayText = isAllSelected
    ? t('components.branchSelector.allBranches')
    : t('components.branchSelector.branchesCount', { count: selectedBranches.length });

  // External loading (e.g. projects still being fetched by the parent) is
  // the only state that hides the whole control. Internal `branchesLoading`
  // appears only after the dropdown is opened, so we render the loading
  // indicator INSIDE the panel below instead of swapping out the trigger.
  if (loading) {
    return (
      <div className={cn('animate-pulse min-w-[240px]', className)}>
        <div className="h-8 bg-zinc-200 dark:bg-white/[0.06] rounded-lg" />
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={cn('relative min-w-[240px]', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          // On a phone the trigger is the field height (44 px), like the day fields beside it.
          'relative flex h-8 items-center justify-between gap-2 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300 max-md:h-11',
          'dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]',
          AS_FOCUS,
          AS_TOUCH,
          isOpen && 'border-secondary/60 ring-[3px] ring-secondary/15 dark:border-secondary-light/50 dark:ring-secondary/25',
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <CodeBranch className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500"  />
          <span className="truncate text-zinc-900 dark:text-zinc-100">{displayText}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500 transition-transform',
            isOpen && 'rotate-180',
          )}
         />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]">
          {/* Search */}
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-as-line">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
               />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('components.branchSelector.searchPlaceholder')}
                className="h-8 w-full pl-7 pr-2 text-[13px] max-md:text-base bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line-strong rounded-md focus:outline-none focus:border-secondary/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="px-3 py-1.5 border-b border-zinc-100 dark:border-as-line flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className={cn(
                'text-xs px-2 py-1 rounded-md transition-colors duration-[120ms]',
                isAllSelected
                  ? 'bg-secondary/10 text-secondary font-medium dark:bg-secondary/20 dark:text-secondary-light'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100',
              )}
            >
              {t('components.branchSelector.allBranches')}
            </button>
            {!isAllSelected && (
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-secondary hover:underline dark:text-secondary-light ml-auto"
              >
                {t('components.branchSelector.selectAll')}
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="max-h-72 overflow-y-auto">
            {/* Loading indicator — only on first open, while branches are
                being fetched lazily. */}
            {branchesLoading && (
              <div className="px-3 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 text-center">
                {t('components.branchSelector.loading')}
              </div>
            )}
            {/* Branches grouped by project */}
            {!branchesLoading &&
              groupedBranches.map(([projectId, { projectName, branches }]) => (
                <div key={projectId}>
                  {/* Project header */}
                  <div className="px-3 py-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-as-raised border-t border-zinc-100 dark:border-as-line first:border-t-0 flex items-center gap-1.5">
                    <span className="truncate font-medium">{projectName}</span>
                  </div>
                  {/* Branches */}
                  {branches.map((branch) => (
                    <div
                      key={`${projectId}-${branch.name}`}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 text-[13px] hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors duration-[80ms] cursor-pointer max-md:min-h-11',
                        selectedBranches.includes(
                          `${branch.projectId}::${branch.name}`,
                        ) && 'bg-secondary/[0.06] dark:bg-secondary/[0.12]',
                      )}
                      onClick={() =>
                        toggleBranch(branch.projectId, branch.name)
                      }
                    >
                      <span className="flex items-center gap-2 truncate">
                        {/* Checkbox */}
                        <span
                          className={cn(
                            'w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-colors',
                            selectedBranches.includes(
                              `${branch.projectId}::${branch.name}`,
                            )
                              ? 'bg-secondary border-secondary text-white'
                              : 'border-zinc-300 dark:border-as-line-strong',
                          )}
                        >
                          {selectedBranches.includes(
                            `${branch.projectId}::${branch.name}`,
                          ) && (
                            <svg
                              className="w-2.5 h-2.5"
                              fill="currentColor"
                              viewBox="0 0 12 12"
                            >
                              <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                            </svg>
                          )}
                        </span>
                        <span className="truncate font-mono">{branch.name}</span>
                        {branch.isDefault && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-secondary/10 text-secondary font-medium shrink-0 dark:bg-secondary/20 dark:text-secondary-light">
                            ★
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}

            {/* No results */}
            {!branchesLoading && filteredBranches.length === 0 && (
              <div className="px-3 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 text-center">
                {t('components.branchSelector.noResults')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationBranchSelector;
