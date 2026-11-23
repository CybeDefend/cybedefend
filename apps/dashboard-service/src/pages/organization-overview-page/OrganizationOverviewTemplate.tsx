import React, { useState, useRef } from "react";
import { destinationIcon } from '@/components/atoms/icon/destinationIcons';
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { GetOrganizationOverviewResponse, OrganizationOverviewFilters } from "@/server/interfaces/Vulnerability";
import { ProjectAnalysis } from "@/server/interfaces/Project";
import SeverityTab from "./tabs/SeverityTab";
import StateTab from "./tabs/StateTab";
import TrendsTab from "./tabs/TrendsTab";
import Button from "@/components/atoms/button/Button";
import OnboardingStep from "@/components/molecules/on-boarding/OnboardingStep";
import { PageContainer } from "@/components/molecules/page-container";
import { PageHeader } from "@/components/molecules/page-header";
import ExportButtons from "@/components/molecules/chart-export/ExportButtons";
import PostureHeadline from "@/components/molecules/project-overview/posture/PostureHeadline";
import { BandEyebrow } from "@/components/molecules/project-overview/posture/PosturePanel";
import SeverityStack from "@/components/molecules/project-overview/posture/SeverityStack";
import ScannerRanking from "@/components/molecules/project-overview/posture/ScannerRanking";
import OrganizationKpiStrip from "@/components/molecules/organization-overview/glance/OrganizationKpiStrip";
import ProjectsAtRisk from "@/components/molecules/organization-overview/glance/ProjectsAtRisk";
import TeamsRows from "@/components/molecules/organization-overview/glance/TeamsRows";
import LicenceRow from "@/components/molecules/organization-overview/glance/LicenceRow";
import { cn } from "@/utils/function/utils";
import { appsecPath } from "@/utils/product";
import OrganizationBranchSelector from "@/components/molecules/organization-branch-selector/OrganizationBranchSelector";
import { Calendar, ChartLine, ChevronDown, CodeBranch, Filter, FolderOpen, ListCheck, ShieldAlt, Sync, Times } from '@/components/atoms/icon/icons';
import { AS_FOCUS, AS_FOCUS_INSET, AS_PANEL, AS_TAG, AS_TOUCH, AS_WORD_TONE } from '@/components/atoms/appsec/styles';

interface OrganizationOverviewTemplateProps {
    data: GetOrganizationOverviewResponse | null;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
    organizationId: string;
    organizationName?: string;
    filters: OrganizationOverviewFilters;
    onFiltersChange: (filters: OrganizationOverviewFilters) => void;
    onResetFilters: () => void;
    projects: ProjectAnalysis[];
    projectsLoading: boolean;
}

type TabType = "overview" | "severity" | "state" | "trends";

// Animation variants for stagger effects
const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.3,
        },
    },
};

/** A grey block where a figure or a panel will be, while the overview loads. */
const PULSE = "animate-pulse rounded-md bg-zinc-200 dark:bg-as-raised";

/**
 * Loading skeleton for the organization overview page, in the shape of the
 * page: header, filters, the sentence, the four figures, the tab row, the
 * first band of two panels.
 */
const OrganizationOverviewSkeleton: React.FC = () => {
    return (
        <PageContainer background="default" padding="md">
            <div className="space-y-6" aria-busy="true">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2">
                        <div className={cn(PULSE, "h-6 w-56")} />
                        <div className={cn(PULSE, "h-4 w-32")} />
                    </div>
                    <div className={cn(PULSE, "h-8 w-24")} />
                </div>
                <div className={cn(PULSE, "h-8 w-full max-w-2xl")} />
                <div className={cn(PULSE, "h-7 w-[28rem] max-w-full")} />
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className={cn(AS_PANEL, "p-4 sm:p-5")}>
                            <div className={cn(PULSE, "h-8 w-20")} />
                            <div className={cn(PULSE, "mt-3 h-3 w-28")} />
                            <div className={cn(PULSE, "mt-2 h-3 w-16")} />
                        </div>
                    ))}
                </div>
                <div className="flex gap-5 border-b border-zinc-200 pb-3 dark:border-as-line">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className={cn(PULSE, "h-4 w-24")} />
                    ))}
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    <div className={cn(AS_PANEL, "h-72 lg:col-span-3")} />
                    <div className={cn(AS_PANEL, "h-72 lg:col-span-2")} />
                </div>
            </div>
        </PageContainer>
    );
};

/**
 * Multi-project selector dropdown
 */
const ProjectSelector: React.FC<{
    projects: ProjectAnalysis[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    loading?: boolean;
}> = ({ projects, selectedIds, onChange, loading }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    React.useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const toggle = (projectId: string) => {
        onChange(
            selectedIds.includes(projectId)
                ? selectedIds.filter((id) => id !== projectId)
                : [...selectedIds, projectId]
        );
    };

    const selectAll = () => onChange(projects.map((p) => p.projectId));
    const deselectAll = () => onChange([]);

    return (
        <div className="relative max-md:min-w-0 max-md:flex-1" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    // On a phone the trigger is the field height (44 px), so the toolbar has one control height.
                    'relative flex h-8 items-center gap-2 px-2.5 rounded-lg text-[13px] font-medium max-md:h-11 max-md:w-full',
                    'bg-white dark:bg-as-raised',
                    'border border-zinc-200 dark:border-as-line-strong',
                    'hover:border-zinc-300 dark:hover:border-white/[0.2]',
                    'transition-colors duration-[120ms]',
                    AS_FOCUS,
                    AS_TOUCH,
                    selectedIds.length > 0 && 'border-secondary/60 dark:border-secondary-light/50'
                )}
            >
                <FolderOpen className={cn('h-4 w-4', selectedIds.length > 0 ? 'text-secondary dark:text-secondary-light' : 'text-zinc-400 dark:text-zinc-500')} />
                <span className="text-zinc-800 dark:text-zinc-100">
                    {selectedIds.length > 0
                        ? t('pages.organizationOverview.filters.projectsSelected', { count: selectedIds.length })
                        : t('pages.organizationOverview.filters.allProjects')}
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-400 transition-transform', isOpen && 'rotate-180')}  />
            </button>

            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-zinc-200 dark:border-as-line-strong bg-white dark:bg-as-raised shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]"
                >
                    {/* Actions */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-as-line">
                        <button onClick={selectAll} className="text-xs font-medium text-secondary hover:underline dark:text-secondary-light">
                            {t('pages.organizationOverview.filters.selectAll')}
                        </button>
                        <button onClick={deselectAll} className="text-xs text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400">
                            {t('pages.organizationOverview.filters.deselectAll')}
                        </button>
                    </div>
                    {/* Project list */}
                    <div className="max-h-56 overflow-y-auto p-1">
                        {loading ? (
                            <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                {t('common.loading')}
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                {t('pages.organizationOverview.filters.noProjects')}
                            </div>
                        ) : (
                            projects.map((project) => {
                                const isSelected = selectedIds.includes(project.projectId);
                                return (
                                    <button
                                        key={project.projectId}
                                        onClick={() => toggle(project.projectId)}
                                        className={cn(
                                            'relative w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors duration-[80ms] max-md:min-h-11',
                                            isSelected
                                                ? 'bg-secondary/[0.06] dark:bg-secondary/[0.12]'
                                                : 'hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
                                        )}
                                    >
                                        <div className={cn(
                                            'h-3.5 w-3.5 rounded-[4px] border flex items-center justify-center flex-shrink-0',
                                            isSelected ? 'bg-secondary border-secondary' : 'border-zinc-300 dark:border-as-line-strong'
                                        )}>
                                            {isSelected && (
                                                <svg className="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 12 12">
                                                    <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                                                </svg>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{project.name}</p>
                                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{project.teamName}</p>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </motion.div>
            )}
        </div>
    );
};

/**
 * The organisation's posture briefing, in six blocks: the filters; one sentence of scope and open findings; four
 * figures; then the tabs. « At a glance » holds the posture now (severity,
 * where the findings are, licences) and what to look at (the projects at risk,
 * the teams); the Severity, Status and Trends tabs keep their own lazy
 * requests and draw them with the same blocks as the project page.
 * Every figure of « At a glance » comes from the one overview payload; the
 * filters, the tabs, the links and the PNG / PDF export behave as before.
 */
const OrganizationOverviewTemplate: React.FC<OrganizationOverviewTemplateProps> = ({
    data,
    loading,
    error,
    onRefresh,
    organizationId,
    organizationName,
    filters,
    onFiltersChange,
    projects,
    projectsLoading,
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<TabType>("overview");

    // Refs for export
    const overviewRef = useRef<HTMLDivElement>(null);
    const severityRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<HTMLDivElement>(null);
    const trendsRef = useRef<HTMLDivElement>(null);

    const handleBranchesChange = (branches: string[]) => {
        onFiltersChange({ ...filters, branches: branches.length > 0 ? branches : undefined });
    };

    const handleProjectsChange = (projectIds: string[]) => {
        onFiltersChange({ ...filters, projectIds: projectIds.length > 0 ? projectIds : undefined });
    };

    const handleDateFromChange = (value: string) => {
        onFiltersChange({ ...filters, dateFrom: value || undefined });
    };

    const handleDateToChange = (value: string) => {
        onFiltersChange({ ...filters, dateTo: value || undefined });
    };

    const hasActiveFilters = !!(filters.branches?.length || filters.projectIds?.length || filters.dateFrom || filters.dateTo);

    // Loading state - using Skeleton
    if (loading && !data) {
        return <OrganizationOverviewSkeleton />;
    }

    // Error state
    if (error) {
        return (
            <PageContainer background="default" padding="md">
                <div className="flex min-h-[60vh] items-center justify-center">
                    {/* A hairline panel, the failure written in red (no dot): the tinted red box it replaces coloured the whole block. */}
                    <motion.div
                        className={cn(AS_PANEL, "flex max-w-md flex-col items-center gap-4 p-6 text-center sm:p-8")}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                    >
                        <p className={cn("text-left text-sm", AS_WORD_TONE.bad)}>{error}</p>
                        <Button
                            variant="white"
                            onClick={onRefresh}
                            icon={<Sync className="h-4 w-4"  />}
                        >
                            {t("common.retry")}
                        </Button>
                    </motion.div>
                </div>
            </PageContainer>
        );
    }

    if (!data) {
        return (
            <PageContainer background="default" padding="md">
                <div className="flex min-h-[60vh] items-center justify-center">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.noData")}</p>
                </div>
            </PageContainer>
        );
    }

    const totalIssues = (data.criticalIssues ?? 0) + (data.highIssues ?? 0) + (data.mediumIssues ?? 0) + (data.lowIssues ?? 0);

    // The headline: « 12 projects in 4 teams, 550 open findings, 24 critical. »
    const headlineParts = [
        { value: data.totalProjects ?? 0, label: t("pages.organizationOverview.glance.headline.projects", { count: data.totalProjects ?? 0 }) },
        {
            value: data.totalTeams ?? 0,
            label: t("pages.organizationOverview.glance.headline.teams", { count: data.totalTeams ?? 0 }),
            joiner: t("pages.organizationOverview.glance.headline.in"),
        },
        { value: totalIssues, label: t("pages.organizationOverview.glance.headline.open", { count: totalIssues }) },
        { value: data.criticalIssues ?? 0, label: t("pages.organizationOverview.glance.headline.critical", { count: data.criticalIssues ?? 0 }) },
    ];

    // The posture block reads the four severity totals of the payload.
    const severityTotals = [
        { severity: "CRITICAL", count: data.criticalIssues ?? 0 },
        { severity: "HIGH", count: data.highIssues ?? 0 },
        { severity: "MEDIUM", count: data.mediumIssues ?? 0 },
        { severity: "LOW", count: data.lowIssues ?? 0 },
    ];

    // What the export of each tab draws, and the file it writes: the same four as before.
    const exportTargets: Record<TabType, { ref: React.RefObject<HTMLDivElement | null>; filename: string }> = {
        overview: { ref: overviewRef, filename: "organization-overview" },
        severity: { ref: severityRef, filename: "organization-severity" },
        state: { ref: stateRef, filename: "organization-state" },
        trends: { ref: trendsRef, filename: "organization-trends" },
    };

    const tabs = [
        { id: "overview" as TabType, label: t("pages.organizationOverview.tabs.overview"), icon: ChartLine },
        { id: "severity" as TabType, label: t("pages.organizationOverview.severity.title"), icon: ShieldAlt },
        { id: "state" as TabType, label: t("pages.organizationOverview.state.title"), icon: ListCheck },
        { id: "trends" as TabType, label: t("pages.organizationOverview.overTime.title"), icon: ChartLine },
    ];

    const content = (
        <PageContainer background="default" padding="md">
            {/* Header */}
            <PageHeader
                title={t("pages.organizationOverview.title")}
                description={organizationName}
                icon={React.createElement(destinationIcon(appsecPath('/organization/overview')), {
                    className: 'h-5 w-5 text-zinc-500 dark:text-zinc-400',
                })}
                // The title glyph keeps its box and loses its violet tile.
                iconBgColor="border-transparent bg-transparent"
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="white"
                            onClick={onRefresh}
                            disabled={loading}
                            loading={loading}
                            icon={<Sync className="h-4 w-4"  />}
                        >
                            {t("common.refresh")}
                        </Button>
                    </div>
                }
            />

            {/* Filters bar */}
            {/*
              On a phone every control is the field height (44 px) and the row wraps
              evenly: the two day fields share a line, then the two selectors.
              Nothing changes from md up.
            */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Filter className="h-4 w-4 text-zinc-400 dark:text-zinc-500"  />

                {/* Date from */}
                <div className="flex items-center gap-1.5 max-md:min-w-0 max-md:flex-1">
                    <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('pages.organizationOverview.filters.dateFrom')}</label>
                    <input
                        type="date"
                        value={filters.dateFrom ? filters.dateFrom.split('T')[0] : ''}
                        onChange={(e) => handleDateFromChange(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
                        className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-800 transition-[border-color,box-shadow] duration-[120ms] hover:border-zinc-300 focus:border-secondary/60 focus:outline-none focus:ring-[3px] focus:ring-secondary/15 max-md:h-11 max-md:w-full max-md:min-w-0 max-md:text-base dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:[color-scheme:dark] dark:focus:border-secondary-light/50 dark:focus:ring-secondary/25"
                    />
                </div>

                {/* Date to */}
                <div className="flex items-center gap-1.5 max-md:min-w-0 max-md:flex-1">
                    <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('pages.organizationOverview.filters.dateTo')}</label>
                    <input
                        type="date"
                        value={filters.dateTo ? filters.dateTo.split('T')[0] : ''}
                        onChange={(e) => handleDateToChange(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
                        className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-800 transition-[border-color,box-shadow] duration-[120ms] hover:border-zinc-300 focus:border-secondary/60 focus:outline-none focus:ring-[3px] focus:ring-secondary/15 max-md:h-11 max-md:w-full max-md:min-w-0 max-md:text-base dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:[color-scheme:dark] dark:focus:border-secondary-light/50 dark:focus:ring-secondary/25"
                    />
                </div>

                {/* Divider */}
                <div className="h-5 w-px bg-zinc-200 dark:bg-as-line max-md:basis-full max-md:h-0 max-md:w-0" />

                {/* Project selector */}
                <ProjectSelector
                    projects={projects}
                    selectedIds={filters.projectIds || []}
                    onChange={handleProjectsChange}
                    loading={projectsLoading}
                />

                {/* Branch selector */}
                <OrganizationBranchSelector
                    organizationId={organizationId}
                    projects={projects}
                    filteredProjectIds={filters.projectIds}
                    selectedBranches={filters.branches || []}
                    onChange={handleBranchesChange}
                    loading={projectsLoading}
                    className="max-md:min-w-0 max-md:flex-1"
                />

                {/* Clear filters */}
                {hasActiveFilters && (
                    <button
                        onClick={() => onFiltersChange({ ...filters, branches: undefined, projectIds: undefined, dateFrom: undefined, dateTo: undefined })}
                        className={`relative inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-zinc-500 transition-colors duration-[120ms] hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 ${AS_FOCUS} ${AS_TOUCH}`}
                    >
                        <Times className="h-3.5 w-3.5"  />
                        {t('pages.organizationOverview.filters.clearAll')}
                    </button>
                )}
            </div>

            {/* Active filters indicator */}
            {hasActiveFilters && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 flex flex-wrap items-center gap-2"
                >
                    {filters.dateFrom && (
                        <span className={AS_TAG}>
                            <Calendar className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
                            {t('pages.organizationOverview.filters.dateFrom')}: {filters.dateFrom.split('T')[0]}
                        </span>
                    )}
                    {filters.dateTo && (
                        <span className={AS_TAG}>
                            <Calendar className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
                            {t('pages.organizationOverview.filters.dateTo')}: {filters.dateTo.split('T')[0]}
                        </span>
                    )}
                    {filters.projectIds && filters.projectIds.length > 0 && (
                        <span className={AS_TAG}>
                            <FolderOpen className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
                            {filters.projectIds.length} {t('pages.organizationOverview.filters.projectsFiltered')}
                        </span>
                    )}
                    {filters.branches && filters.branches.length > 0 && (
                        <span className={AS_TAG}>
                            <CodeBranch className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
                            {t('pages.organizationOverview.filters.branchesSelected', { count: filters.branches.length })}
                        </span>
                    )}
                </motion.div>
            )}

            {/*
              The briefing: one sentence (the Scope cards folded into it), four figures that hold
              for every tab, then the tabs with their content laid on the page.
            */}
            <motion.div
                className="space-y-6"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                <motion.div variants={itemVariants}>
                    <PostureHeadline
                        parts={headlineParts}
                        meta={
                            <span>
                                {hasActiveFilters
                                    ? t("pages.organizationOverview.glance.meta.filtered")
                                    : t("pages.organizationOverview.glance.meta.allProjects")}
                            </span>
                        }
                    />
                </motion.div>

                <motion.div variants={itemVariants}>
                    <OrganizationKpiStrip data={data} />
                </motion.div>

                <motion.div variants={itemVariants}>
                    {/* The tab row on a hairline, the export of the tab shown at its right end. */}
                    <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-as-line">
                        {/* The four tabs measure ~523px in a row. Unwrapped, they
                            pushed a 390px phone's document to 552px: the page
                            rendered zoomed out and every fixed surface landed
                            off-screen. The row scrolls inside its own box. */}
                        <nav role="tablist" className="flex min-w-0 flex-1 gap-5 overflow-x-auto overflow-y-hidden scrollbar-hide">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={activeTab === tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "relative flex shrink-0 h-11 md:h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] font-medium transition-colors duration-[120ms]",
                                        AS_FOCUS_INSET,
                                        activeTab === tab.id
                                            ? "border-secondary text-zinc-900 dark:text-zinc-50"
                                            : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/[0.2] dark:hover:text-zinc-100"
                                    )}
                                >
                                    <tab.icon className="h-4 w-4"  />
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                        <div className="shrink-0">
                            <ExportButtons targetRef={exportTargets[activeTab].ref} filename={exportTargets[activeTab].filename} />
                        </div>
                    </div>

                    {/* Tab Content */}
                    <div className="pt-6">
                        {activeTab === "overview" && (
                            <motion.div
                                ref={overviewRef}
                                className="space-y-8"
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                            >
                                {/* Posture now: open findings by severity, where they are, and the licences. */}
                                <motion.section variants={itemVariants} className="space-y-3">
                                    <BandEyebrow label={t("pages.organizationOverview.glance.bands.now")} />
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                                        <div className="min-w-0 lg:col-span-3">
                                            <SeverityStack data={severityTotals} />
                                        </div>
                                        <div className="min-w-0 lg:col-span-2">
                                            <ScannerRanking data={data.totalByAnalysisType ?? []} />
                                        </div>
                                    </div>
                                    <LicenceRow
                                        permissive={data.licensePermissiveCount ?? 0}
                                        weakCopyleft={data.licenseWeakCopyleftCount ?? 0}
                                        strongCopyleft={data.licenseStrongCopyleftCount ?? 0}
                                        unknown={data.licenseUnknownCount ?? 0}
                                        totalPackages={data.licenseTotalPackages}
                                    />
                                </motion.section>

                                {/* What to look at: the projects that carry the most, and the teams. */}
                                <motion.section variants={itemVariants} className="space-y-3">
                                    <BandEyebrow label={t("pages.organizationOverview.glance.bands.look")} />
                                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                                        <div className="min-w-0 xl:col-span-3">
                                            <ProjectsAtRisk data={data} />
                                        </div>
                                        <div className="min-w-0 xl:col-span-2">
                                            <TeamsRows teams={data.teamsSummary ?? []} />
                                        </div>
                                    </div>
                                </motion.section>
                            </motion.div>
                        )}

                        {activeTab === "severity" && (
                            <div ref={severityRef}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                            >
                                <SeverityTab organizationId={organizationId} filters={filters} />
                            </motion.div>
                            </div>
                        )}

                        {activeTab === "state" && (
                            <div ref={stateRef}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                            >
                                <StateTab organizationId={organizationId} filters={filters} />
                            </motion.div>
                            </div>
                        )}

                        {activeTab === "trends" && (
                            <div ref={trendsRef}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                            >
                                <TrendsTab organizationId={organizationId} filters={filters} />
                            </motion.div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </PageContainer>
    );

    return (
        <OnboardingStep
            title={t('components.onboarding.organizationOverview.title')}
            subtitle={t('components.onboarding.organizationOverview.subtitle')}
            stepId="organizationOverview"
        >
            {content}
        </OnboardingStep>
    );
};

export default OrganizationOverviewTemplate;
