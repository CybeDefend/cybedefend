import React, { useState, useMemo } from 'react';
import { destinationIcon } from '@/components/atoms/icon/destinationIcons';
import { appsecPath } from '@/utils/product';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import Button from '@/components/atoms/button/Button';
import Card from '@/components/atoms/card/Card';
import Modal from '@/components/atoms/modal/Modal';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { PageContainer } from '@/components/molecules/page-container';
import { PageHeader } from '@/components/molecules/page-header';
import StoredReportsTrigger from '@/components/organismes/stored-reports/StoredReportsTrigger';
import { cn } from '@/utils/function/utils';
import { Team } from '@/server/interfaces/Team';
import { ProjectAnalysis } from '@/server/interfaces/Project';
import { ProjectBranchSelection } from '@/server/interfaces/Vulnerability';
import OnboardingStep from '@/components/molecules/on-boarding/OnboardingStep';
import { Archive, ArrowLeft, ArrowRight, Box, Building, ChartBar, Check, CheckSquare, ChevronDown, ChevronRight, CodeBranch, Cog, Download, ExternalLinkAlt, Eye, EyeSlash, FileAlt, FileCode, FilePdf, FolderOpen, InfoCircle, LayerGroup, ListUl, Search, ShieldAlt, Spinner, Square, Star, Users } from '@/components/atoms/icon/icons';

import { AS_TOOLTIP, AS_FOCUS, AS_FOCUS_INSET, AS_HAIRLINE, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { AS_NOTICE_BLOCK, AS_NOTICE_DOT_BLOCK, AS_NOTICE_TITLE, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
import { EDITION } from '@/edition/edition';

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

interface ReportsPageTemplateProps {
    // Organization
    organizationName: string;
    organizationId?: string;
    // Stored-reports drawer trigger data, rendered under the header.
    maxStoredReports?: number;
    reportRetentionDays?: number;
    highlightReportId?: string;
    /** The navigation that named `highlightReportId`: a new one reopens the drawer. */
    highlightKey?: string;
    // Teams
    teams: Team[];
    teamsLoading: boolean;
    teamsError: string | null;
    selectedTeamId: string;
    onTeamSelect: (teamId: string) => void;
    selectedTeamProjects: ProjectAnalysis[];
    // Projects
    projects: ProjectAnalysis[];
    projectsLoading: boolean;
    projectsError: string | null;
    selectedProjectIds: string[];
    onToggleProject: (projectId: string) => void;
    onSelectAllProjects: () => void;
    onDeselectAllProjects: () => void;
    // Report options
    reportType: 'owasp' | 'cwe' | 'license' | 'ai-act';
    onReportTypeChange: (type: 'owasp' | 'cwe' | 'license' | 'ai-act') => void;
    reportFormat: 'json' | 'html' | 'pdf';
    onReportFormatChange: (format: 'json' | 'html' | 'pdf') => void;
    detailed: boolean;
    onDetailedChange: (detailed: boolean) => void;
    // Branch filter
    branchFilter: 'all' | 'reference' | 'selected';
    onBranchFilterChange: (filter: 'all' | 'reference' | 'selected') => void;
    projectBranchSelections: ProjectBranchSelection[];
    onProjectBranchSelectionsChange: (selections: ProjectBranchSelection[]) => void;
    projectBranchesMap: Record<string, string[]>;
    archivedBranchesMap: Record<string, string[]>;
    onArchiveBranch: (projectId: string, branchName: string) => void;
    onUnarchiveBranch: (projectId: string, branchName: string) => void;
    /** Lazily fetch a single project's branches the first time its row opens. */
    onLoadProjectBranches: (projectId: string) => void;
    /** Project ids whose branches are currently being fetched. */
    loadingProjectIds: Set<string>;
    /** Project ids whose branches have already been fetched (possibly empty). */
    loadedProjectIds: Set<string>;
    // Report generation
    reportLoading: boolean;
    reportError: string | null;
    onGenerateOrganizationReport: () => void;
    onGenerateTeamReport: () => void;
    onGenerateBatchReport: () => void;
    writesBlocked?: boolean;
}

type ReportScope = 'organization' | 'team' | 'custom';

/**
 * ReportsPageTemplate - Pure presentation component for Reports Page
 * Redesigned with tab-based navigation and cleaner configuration panel
 */
const ReportsPageTemplate: React.FC<ReportsPageTemplateProps> = ({
    organizationName,
    organizationId,
    maxStoredReports,
    reportRetentionDays,
    highlightReportId,
    highlightKey,
    teams,
    teamsLoading,
    teamsError,
    selectedTeamId,
    onTeamSelect,
    selectedTeamProjects,
    projects,
    projectsLoading,
    projectsError,
    selectedProjectIds,
    onToggleProject,
    onSelectAllProjects,
    onDeselectAllProjects,
    reportType,
    onReportTypeChange,
    reportFormat,
    onReportFormatChange,
    detailed,
    onDetailedChange,
    branchFilter,
    onBranchFilterChange,
    projectBranchSelections,
    onProjectBranchSelectionsChange,
    projectBranchesMap,
    archivedBranchesMap,
    onArchiveBranch,
    onUnarchiveBranch,
    onLoadProjectBranches,
    loadingProjectIds,
    loadedProjectIds,
    reportLoading,
    reportError,
    onGenerateOrganizationReport,
    onGenerateTeamReport,
    onGenerateBatchReport,
    writesBlocked = false,
}) => {
    const { t } = useTranslation();
    const [activeScope, setActiveScope] = useState<ReportScope>('organization');
    const [showTeamProjectsModal, setShowTeamProjectsModal] = useState(false);
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [branchSearchQuery, setBranchSearchQuery] = useState('');
    const [showArchivedBranches, setShowArchivedBranches] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);

    // Projects grouped by team for the branch selector, filtered by active scope
    const projectsForBranchSelector = useMemo(() => {
        // Filter projects based on active scope
        let filtered: ProjectAnalysis[];
        if (activeScope === 'team') {
            // Only show projects from the selected team
            filtered = selectedTeamId ? projects.filter((p) => p.teamId === selectedTeamId) : [];
        } else if (activeScope === 'custom') {
            // Only show projects that are selected for the batch report
            const selectedSet = new Set(selectedProjectIds);
            filtered = projects.filter((p) => selectedSet.has(p.projectId));
        } else {
            // Organization: show all
            filtered = projects;
        }

        // Group by teamName
        const byTeam = new Map<string, ProjectAnalysis[]>();
        for (const p of filtered) {
            const key = p.teamName || t('pages.reportsPage.branchSelector.noTeam');
            if (!byTeam.has(key)) byTeam.set(key, []);
            byTeam.get(key)!.push(p);
        }
        return byTeam;
    }, [projects, activeScope, selectedTeamId, selectedProjectIds, t]);

    // Total selected branch count
    const totalSelectedBranches = useMemo(() =>
        projectBranchSelections.reduce((acc, s) => acc + s.branches.length, 0),
    [projectBranchSelections]);

    // Total archived branch count
    const totalArchivedBranches = useMemo(() =>
        Object.values(archivedBranchesMap).reduce((acc, arr) => acc + arr.length, 0),
    [archivedBranchesMap]);

    // Helper to toggle a branch for a specific project
    const toggleBranch = (projectId: string, branch: string) => {
        const existing = projectBranchSelections.find((s) => s.projectId === projectId);
        if (existing) {
            const has = existing.branches.includes(branch);
            if (has) {
                const newBranches = existing.branches.filter((b) => b !== branch);
                if (newBranches.length === 0) {
                    onProjectBranchSelectionsChange(projectBranchSelections.filter((s) => s.projectId !== projectId));
                } else {
                    onProjectBranchSelectionsChange(projectBranchSelections.map((s) =>
                        s.projectId === projectId ? { ...s, branches: newBranches } : s
                    ));
                }
            } else {
                onProjectBranchSelectionsChange(projectBranchSelections.map((s) =>
                    s.projectId === projectId ? { ...s, branches: [...s.branches, branch] } : s
                ));
            }
        } else {
            onProjectBranchSelectionsChange([...projectBranchSelections, { projectId, branches: [branch] }]);
        }
    };

    // Helper to toggle all branches for a project
    const toggleAllBranchesForProject = (projectId: string) => {
        const available = projectBranchesMap[projectId] || [];
        const existing = projectBranchSelections.find((s) => s.projectId === projectId);
        if (existing && existing.branches.length === available.length) {
            // Deselect all
            onProjectBranchSelectionsChange(projectBranchSelections.filter((s) => s.projectId !== projectId));
        } else {
            // Select all
            if (existing) {
                onProjectBranchSelectionsChange(projectBranchSelections.map((s) =>
                    s.projectId === projectId ? { ...s, branches: [...available] } : s
                ));
            } else {
                onProjectBranchSelectionsChange([...projectBranchSelections, { projectId, branches: [...available] }]);
            }
        }
    };

    // Helper to toggle expand/collapse a project
    const toggleProjectExpanded = (projectId: string) => {
        const willExpand = !expandedProjects.has(projectId);
        setExpandedProjects((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) next.delete(projectId);
            else next.add(projectId);
            return next;
        });
        // Fetch this project's branches the first time it is opened (lazy load).
        if (willExpand) onLoadProjectBranches(projectId);
    };

    // Scope definitions with icons and descriptions
    const scopes = [
        {
            id: 'organization' as ReportScope,
            icon: Building,
            label: t('pages.reportsPage.organizationReport.title'),
            description: t('pages.reportsPage.scopes.organizationShort'),
        },
        {
            id: 'team' as ReportScope,
            icon: Users,
            label: t('pages.reportsPage.teamReport.title'),
            description: t('pages.reportsPage.scopes.teamShort'),
        },
        {
            id: 'custom' as ReportScope,
            icon: LayerGroup,
            label: t('pages.reportsPage.batchReport.title'),
            description: t('pages.reportsPage.scopes.customShort'),
        },
    ];

    // Format options with icons
    // The format's glyph is chrome, not information: zinc, the accent only on the chosen one.
    const formatOptions = [
        { value: 'pdf' as const, icon: FilePdf, label: 'PDF' },
        { value: 'html' as const, icon: FileAlt, label: 'HTML' },
        { value: 'json' as const, icon: FileCode, label: 'JSON' },
    ];

    // Standard options
    const standardOptions = [
        { value: 'owasp' as const, label: 'OWASP Top 10', description: t('pages.reportsPage.standards.owaspDesc') },
        { value: 'cwe' as const, label: 'CWE Top 25', description: t('pages.reportsPage.standards.cweDesc') },
        { value: 'license' as const, label: t('pages.reportsPage.reportTypes.license'), description: t('pages.reportsPage.standards.licenseDesc') },
        { value: 'ai-act' as const, label: t('pages.reportsPage.reportTypes.aiAct'), description: t('pages.reportsPage.standards.aiActDesc') },
    // The EU AI Act report depends on the AI-BOM, both closed, and
    // licence management is the cloud's.
    ].filter((option) => EDITION !== 'community' || (option.value !== 'ai-act' && option.value !== 'license'));

    // Detail level options
    const detailOptions = [
        { value: true, icon: ChartBar, label: t('pages.reportsPage.configuration.detailed'), description: t('pages.reportsPage.detailLevels.detailedDesc') },
        { value: false, icon: ListUl, label: t('pages.reportsPage.configuration.summary'), description: t('pages.reportsPage.detailLevels.summaryDesc') },
    ];

    // Step completion validation
    const isStepComplete = (step: number) => {
        if (step === 1) {
            if (activeScope === 'team') return !!selectedTeamId;
            if (activeScope === 'custom') return selectedProjectIds.length > 0;
            return true;
        }
        return true;
    };

    // Summary label for the selected scope
    const scopeSummary = useMemo(() => {
        if (activeScope === 'organization') return organizationName;
        if (activeScope === 'team') {
            const team = teams.find(tm => tm.id === selectedTeamId);
            return team?.name || '';
        }
        return `${selectedProjectIds.length} ${t('pages.reportsPage.wizard.projects')}`;
    }, [activeScope, organizationName, teams, selectedTeamId, selectedProjectIds, t]);

    const handleGenerate = () => {
        switch (activeScope) {
            case 'organization':
                onGenerateOrganizationReport();
                break;
            case 'team':
                onGenerateTeamReport();
                break;
            case 'custom':
                onGenerateBatchReport();
                break;
        }
    };

    const isGenerateDisabled = () => {
        if (reportLoading) return true;
        if (activeScope === 'team' && !selectedTeamId) return true;
        if (activeScope === 'custom' && selectedProjectIds.length === 0) return true;
        return false;
    };

    const content = (
        <PageContainer background="default" padding="md">
            {/* Page Header */}
            <PageHeader
                title={t('pages.reportsPage.title')}
                description={t('pages.reportsPage.description')}
                icon={React.createElement(destinationIcon(appsecPath('/reports')), {
                    className: 'h-6 w-6 text-zinc-500 dark:text-zinc-400',
                })}
                iconBgColor="border-transparent bg-transparent"
                actions={
                    /* The stored reports open the history drawer; they sit with the page's title now. */
                    organizationId ? (
                        <StoredReportsTrigger
                            scope={{ kind: 'organization', organizationId }}
                            maxStoredReports={maxStoredReports}
                            retentionDays={reportRetentionDays}
                            scopeMeta={{ organizationName }}
                            highlightReportId={highlightReportId}
                            highlightKey={highlightKey}
                        />
                    ) : undefined
                }
            />

            {/* Main Content - Wizard Layout: one frame, the steps along its top, the way forward along its foot */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <Card padding="none" className="overflow-hidden">
                {/* Step Indicator: left-aligned, the current step's number in the accent, a done step checked */}
                <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden scrollbar-hide border-b border-zinc-200 px-4 py-3 dark:border-as-line sm:px-6">
                    {[
                        { n: 1, icon: LayerGroup, label: t('pages.reportsPage.wizard.step1') },
                        { n: 2, icon: Cog, label: t('pages.reportsPage.wizard.step2') },
                        { n: 3, icon: Download, label: t('pages.reportsPage.wizard.step3') },
                    ].map((step, idx, arr) => (
                        <React.Fragment key={step.n}>
                            <button
                                type="button"
                                onClick={() => { if (step.n < currentStep) setCurrentStep(step.n); }}
                                aria-current={step.n === currentStep ? 'step' : undefined}
                                className={cn(
                                    'relative flex shrink-0 items-center gap-2 rounded-md px-1 py-1', AS_FOCUS, AS_TOUCH,
                                    step.n < currentStep ? 'cursor-pointer' : 'cursor-default'
                                )}
                            >
                                <span className={cn(
                                    'flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums transition-colors duration-[120ms]',
                                    step.n < currentStep && 'bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300',
                                    step.n === currentStep && 'bg-secondary text-white',
                                    step.n > currentStep && 'border border-zinc-300 text-zinc-500 dark:border-as-line-strong dark:text-zinc-400'
                                )}>
                                    {step.n < currentStep ? <Check className="h-3 w-3" /> : step.n}
                                </span>
                                <span className={cn(
                                    'whitespace-nowrap text-[13px] font-medium transition-colors duration-[120ms]',
                                    // On a phone only the current step keeps its word: the three would not fit.
                                    step.n === currentStep ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400 max-sm:sr-only',
                                    step.n < currentStep && 'hover:text-zinc-900 dark:hover:text-zinc-100'
                                )}>
                                    {step.label}
                                </span>
                            </button>
                            {idx < arr.length - 1 && (
                                <span aria-hidden="true" className={cn('h-px w-6 shrink-0 sm:w-10', AS_HAIRLINE)} />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* STEP 1: Select Scope */}
                {currentStep === 1 && (<>
                        <div className="border-b border-zinc-100 dark:border-as-line">
                            <div className="flex">
                                {scopes.map((scope) => (
                                    <button
                                        key={scope.id}
                                        onClick={() => setActiveScope(scope.id)}
                                        className={cn(
                                            'flex-1 flex h-11 items-center justify-center gap-2 px-4 text-[13px] font-medium transition-colors duration-[120ms]', AS_FOCUS_INSET,
                                            'border-b-2 -mb-[1px]',
                                            activeScope === scope.id
                                                ? 'border-secondary text-zinc-900 dark:text-zinc-50'
                                                : 'border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:border-white/[0.2]'
                                        )}
                                    >
                                        <scope.icon className="h-4 w-4"  />
                                        <span className="hidden sm:inline">{scope.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Scope Content */}
                        <div className="p-4 sm:p-6">
                            {/* Organization Scope */}
                            {activeScope === 'organization' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center">
                                                <Building className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400"  />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
                                                    {organizationName}
                                                </h3>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {t('pages.reportsPage.organizationReport.includesDesc')}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-start gap-4 md:flex-nowrap md:flex-shrink-0">
                                            <div className="text-center px-4">
                                                <p className="font-mono text-xl font-medium tabular-nums tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">{projects.length}</p>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {t('pages.reportsPage.stats.totalProjects')}
                                                </p>
                                            </div>
                                            <div className="h-8 w-px bg-zinc-200 dark:bg-as-line" />
                                            <div className="text-center px-4">
                                                <p className="font-mono text-xl font-medium tabular-nums tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">{teams.length}</p>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {t('pages.reportsPage.stats.totalTeams')}
                                                </p>
                                            </div>
                                            <div className="h-8 w-px bg-zinc-200 dark:bg-as-line" />
                                            <div className="text-center px-4">
                                                <p className="text-xl font-medium tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">{reportType.toUpperCase()}</p>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {t('pages.reportsPage.stats.standard')}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* Team Scope */}
                            {activeScope === 'team' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-4"
                                >
                                    {teamsLoading ? (
                                        <Skeleton type="card" />
                                    ) : teamsError ? (
                                        <NotFoundElement
                                            title={t('pages.reportsPage.teamReport.errorTitle')}
                                            description={teamsError}
                                        />
                                    ) : teams.length === 0 ? (
                                        <NotFoundElement
                                            title={t('pages.reportsPage.teamReport.noTeamsTitle')}
                                            description={t('pages.reportsPage.teamReport.noTeamsMessage')}
                                        />
                                    ) : (
                                        <>
                                            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                                                {t('pages.reportsPage.teamReport.description')}
                                            </p>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {teams.map((team, index) => (
                                                    <motion.button
                                                        key={team.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: index * 0.05 }}
                                                        onClick={() => onTeamSelect(team.id)}
                                                        className={cn(
                                                            'flex items-center gap-3 p-3 rounded-xl border transition-colors duration-[120ms] text-left',
                                                            selectedTeamId === team.id
                                                                ? 'border-secondary/60 bg-zinc-50 dark:border-secondary-light/40 dark:bg-white/[0.04]'
                                                                : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                                                        )}
                                                    >
                                                        <div className={cn(
                                                            'flex h-9 w-9 items-center justify-center',
                                                            selectedTeamId === team.id
                                                                ? 'text-secondary dark:text-secondary-light'
                                                                : 'text-zinc-500 dark:text-zinc-400'
                                                        )}>
                                                            <Users className="h-4 w-4"  />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                                {team.name}
                                                            </p>
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                                {team.description || t('pages.reportsPage.teamReport.noDescription')}
                                                            </p>
                                                        </div>
                                                        {selectedTeamId === team.id && (
                                                            <CheckSquare className="h-4 w-4 text-secondary dark:text-secondary-light flex-shrink-0"  />
                                                        )}
                                                    </motion.button>
                                                ))}
                                            </div>

                                            {selectedTeamId && (
                                                <button
                                                    onClick={() => setShowTeamProjectsModal(true)}
                                                    className="flex items-center gap-2 text-sm text-secondary dark:text-secondary-light hover:underline transition-colors"
                                                >
                                                    <InfoCircle className="h-4 w-4"  />
                                                    <span>{t('pages.reportsPage.teamReport.viewProjectsButton')}</span>
                                                </button>
                                            )}
                                        </>
                                    )}
                                </motion.div>
                            )}

                            {/* Custom Selection Scope */}
                            {activeScope === 'custom' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-4"
                                >
                                    {projectsLoading ? (
                                        <Skeleton type="table" rows={5} columns={3} />
                                    ) : projectsError ? (
                                        <NotFoundElement
                                            title={t('pages.reportsPage.batchReport.errorTitle')}
                                            description={projectsError}
                                        />
                                    ) : projects.length === 0 ? (
                                        <NotFoundElement
                                            title={t('pages.reportsPage.batchReport.noProjectsTitle')}
                                            description={t('pages.reportsPage.batchReport.noProjectsMessage')}
                                        />
                                    ) : (
                                        <>
                                            {/* Selection Header */}
                                            <div className="flex items-center justify-between">
                                                <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                                                    {t('pages.reportsPage.batchReport.description')}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={onSelectAllProjects}
                                                        disabled={selectedProjectIds.length === projects.length}
                                                        className="text-xs text-secondary dark:text-secondary-light hover:underline disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {t('pages.reportsPage.batchReport.selectAll')}
                                                    </button>
                                                    <button
                                                        onClick={onDeselectAllProjects}
                                                        disabled={selectedProjectIds.length === 0}
                                                        className="text-xs text-secondary dark:text-secondary-light hover:underline disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {t('pages.reportsPage.batchReport.deselectAll')}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Selection Counter */}
                                            <div className="flex items-center gap-3 px-3 py-2 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line rounded-lg">
                                                <FolderOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                    {t('pages.reportsPage.batchReport.selectedCount', {
                                                        count: selectedProjectIds.length,
                                                        total: projects.length,
                                                    })}
                                                </span>
                                            </div>

                                            {/* Projects List */}
                                            <div className="max-h-48 overflow-y-auto rounded-xl border border-zinc-200 dark:border-as-line">
                                                <div className="divide-y divide-zinc-100 dark:divide-as-line">
                                                    {projects.map((project, index) => {
                                                        const isSelected = selectedProjectIds.includes(project.projectId);
                                                        return (
                                                            <motion.div
                                                                key={project.projectId}
                                                                initial={{ opacity: 0 }}
                                                                animate={{ opacity: 1 }}
                                                                transition={{ delay: index * 0.02 }}
                                                                onClick={() => onToggleProject(project.projectId)}
                                                                className={cn(
                                                                    'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                                                                    isSelected
                                                                        ? 'bg-secondary/[0.04] dark:bg-secondary/[0.08]'
                                                                        : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                                                                )}
                                                            >
                                                                {isSelected ? <CheckSquare
                                                                    className={cn(
                                                                        'h-4 w-4 flex-shrink-0 transition-colors',
                                                                        isSelected ? 'text-secondary dark:text-secondary-light' : 'text-zinc-500'
                                                                    )} /> : <Square
                                                                    className={cn(
                                                                        'h-4 w-4 flex-shrink-0 transition-colors',
                                                                        isSelected ? 'text-secondary dark:text-secondary-light' : 'text-zinc-500'
                                                                    )} />}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                                        {project.name}
                                                                    </p>
                                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                                        {project.teamName}
                                                                    </p>
                                                                </div>
                                                            </motion.div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            )}
                        </div>

                {/* Step 1 Navigation */}
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-as-line sm:px-6 justify-end">
                    <Button
                        variant="secondary"
                        onClick={() => setCurrentStep(2)}
                        disabled={!isStepComplete(1)}
                        icon={<ArrowRight className="h-4 w-4"  />}
                        iconPosition="right"
                    >
                        {t('pages.reportsPage.wizard.continue')}
                    </Button>
                </div>
                </>)}

                {/* STEP 2: Configure Report */}
                {currentStep === 2 && (<>
                        <div className="p-4 sm:p-6">
                            <h2 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-4">
                                {t('pages.reportsPage.configuration.title')}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:divide-x md:divide-zinc-200 dark:md:divide-as-line">
                                {/* Column 1: Report Type */}
                                <div className="space-y-3">
                                    <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                                        {t('pages.reportsPage.configuration.reportType')}
                                    </label>
                                    <div className="space-y-2">
                                        {standardOptions.map((option) => (
                                            <button
                                                key={option.value}
                                                onClick={() => onReportTypeChange(option.value)}
                                                className={cn(
                                                    'w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors duration-[120ms] text-left',
                                                    reportType === option.value
                                                        ? 'border-secondary/60 bg-zinc-50 dark:border-secondary-light/40 dark:bg-white/[0.04]'
                                                        : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                                                )}
                                            >
                                                <div className={cn(
                                                    'w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                                                    reportType === option.value
                                                        ? 'border-secondary bg-secondary'
                                                        : 'border-zinc-300 dark:border-as-line-strong'
                                                )}>
                                                    {reportType === option.value && (
                                                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                        {option.label}
                                                    </p>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                        {option.description}
                                                    </p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Column 2: Format + Detail Level */}
                                <div className="md:pl-6 space-y-5">
                                    {/* Format */}
                                    <div className="space-y-3">
                                        <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                                            {t('pages.reportsPage.configuration.format')}
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {formatOptions.map((option) => (
                                                <motion.button
                                                    key={option.value}
                                                    aria-pressed={reportFormat === option.value}
                                                    onClick={() => onReportFormatChange(option.value)}
                                                    className={cn(
                                                        'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-colors duration-[120ms]',
                                                        reportFormat === option.value
                                                            ? 'border-secondary/60 bg-zinc-50 dark:border-secondary-light/40 dark:bg-white/[0.04]'
                                                            : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                                                    )}
                                                >
                                                    <option.icon
                                                        className={cn('h-4 w-4', reportFormat === option.value ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400')}
                                                     />
                                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                                        {option.label}
                                                    </span>
                                                </motion.button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Detail Level */}
                                    <div className="space-y-3">
                                        <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                                            {t('pages.reportsPage.configuration.detailedReport')}
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {detailOptions.map((option) => (
                                                <motion.button
                                                    key={String(option.value)}
                                                    aria-pressed={detailed === option.value}
                                                    onClick={() => onDetailedChange(option.value)}
                                                    className={cn(
                                                        'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-colors duration-[120ms]',
                                                        detailed === option.value
                                                            ? 'border-secondary/60 bg-zinc-50 dark:border-secondary-light/40 dark:bg-white/[0.04]'
                                                            : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                                                    )}
                                                >
                                                    <option.icon
                                                        className={cn(
                                                            'h-4 w-4',
                                                            detailed === option.value ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'
                                                        )}
                                                     />
                                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                                        {option.label}
                                                    </span>
                                                </motion.button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Column 3: Branch Filter */}
                                <div className="md:pl-6 space-y-3">
                                    <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                                        {t('pages.reportsPage.configuration.branchFilter')}
                                    </label>
                                    <div className="space-y-2">
                                        {([
                                            {
                                                value: 'all' as const,
                                                icon: CodeBranch,
                                                label: t('pages.reportsPage.branchFilter.all'),
                                                description: t('pages.reportsPage.branchFilter.allDesc'),
                                            },
                                            {
                                                value: 'reference' as const,
                                                icon: Star,
                                                label: t('pages.reportsPage.branchFilter.reference'),
                                                description: t('pages.reportsPage.branchFilter.referenceDesc'),
                                            },
                                            {
                                                value: 'selected' as const,
                                                icon: ListUl,
                                                label: t('pages.reportsPage.branchFilter.selected'),
                                                description: t('pages.reportsPage.branchFilter.selectedDesc'),
                                            },
                                        ]).map((option) => (
                                            <button
                                                key={option.value}
                                                onClick={() => onBranchFilterChange(option.value)}
                                                className={cn(
                                                    'w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors duration-[120ms] text-left',
                                                    branchFilter === option.value
                                                        ? 'border-secondary/60 bg-zinc-50 dark:border-secondary-light/40 dark:bg-white/[0.04]'
                                                        : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                                                )}
                                            >
                                                <div className={cn(
                                                    'flex h-7 w-7 flex-shrink-0 items-center justify-center',
                                                    branchFilter === option.value
                                                        ? 'text-secondary dark:text-secondary-light'
                                                        : 'text-zinc-500 dark:text-zinc-400'
                                                )}>
                                                    <option.icon className="h-4 w-4"  />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                        {option.label}
                                                    </p>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                        {option.description}
                                                    </p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                {/* Row 3: Branch Selector (only when "selected" branch filter is active) */}
                {branchFilter === 'selected' && (
                    <div className="border-t border-zinc-200 dark:border-as-line">
                            <div className="p-4 sm:p-6 space-y-3">
                                <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                                    {t('pages.reportsPage.branchFilter.selected')}
                                </label>
                                {projects.length === 0 ? (
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 italic py-2">
                                        {t('pages.reportsPage.branchSelector.noProjects')}
                                    </p>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-4">
                                            {/* Search input */}
                                            <div className="relative flex-1">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400"  />
                                                <input
                                                    type="text"
                                                    value={branchSearchQuery}
                                                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                                                    placeholder={t('pages.reportsPage.branchSelector.searchPlaceholder')}
                                                    className="w-full pl-7 pr-3 py-1.5 text-sm bg-zinc-50 dark:bg-as-raised border border-zinc-200 dark:border-as-line-strong rounded-lg focus:outline-none focus:ring-1 focus:ring-secondary/30 focus:border-secondary text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                                                />
                                            </div>

                                            {/* Summary */}
                                            {totalSelectedBranches > 0 && (
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs text-secondary dark:text-secondary-light font-medium whitespace-nowrap">
                                                        {t('pages.reportsPage.branchSelector.selectedCount', { count: totalSelectedBranches })}
                                                    </span>
                                                    <button
                                                        onClick={() => onProjectBranchSelectionsChange([])}
                                                        className="text-xs text-zinc-500 hover:text-red-500 transition-colors whitespace-nowrap"
                                                    >
                                                        {t('pages.reportsPage.branchSelector.clearAll')}
                                                    </button>
                                                </div>
                                            )}

                                            {/* Show archived toggle */}
                                            {totalArchivedBranches > 0 && (
                                                <button
                                                    onClick={() => setShowArchivedBranches(!showArchivedBranches)}
                                                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300 transition-colors whitespace-nowrap"
                                                >
                                                    {showArchivedBranches ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    {showArchivedBranches
                                                        ? t('components.branchSelector.hideArchived', { count: totalArchivedBranches })
                                                        : t('components.branchSelector.showArchived', { count: totalArchivedBranches })
                                                    }
                                                </button>
                                            )}
                                        </div>

                                        {/* Projects grouped by team */}
                                        <div className="max-h-52 overflow-y-auto rounded-xl border border-zinc-200 dark:border-as-line divide-y divide-zinc-100 dark:divide-as-line">
                                            {Array.from(projectsForBranchSelector.entries()).map(([teamName, teamProjects]) => {
                                                // Search filters projects by NAME. Branch-name matching only
                                                // applies to projects whose branches have already been lazily
                                                // loaded (expanded) — an unexpanded project has no branches in
                                                // memory to match against, so it is matched by name only.
                                                const query = branchSearchQuery.toLowerCase();
                                                const filteredTeamProjects = query
                                                    ? teamProjects.filter(p => {
                                                        if (p.name.toLowerCase().includes(query)) return true;
                                                        if (!loadedProjectIds.has(p.projectId)) return false;
                                                        const available = projectBranchesMap[p.projectId] || [];
                                                        const archived = archivedBranchesMap[p.projectId] || [];
                                                        return available.some(b => b.toLowerCase().includes(query))
                                                            || archived.some(b => b.toLowerCase().includes(query));
                                                    })
                                                    : teamProjects;
                                                if (filteredTeamProjects.length === 0) return null;

                                                return (
                                                <div key={teamName}>
                                                    {/* Team header */}
                                                    <div className="px-3 py-1.5 bg-zinc-50 dark:bg-white/[0.03] sticky top-0 z-10">
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                            <Users className="h-3.5 w-3.5"  />
                                                            {teamName}
                                                        </span>
                                                    </div>
                                                    {/* Projects in team */}
                                                    {filteredTeamProjects.map((project) => {
                                                        const available = (projectBranchesMap[project.projectId] || []).filter(
                                                            b => !query || b.toLowerCase().includes(query) || project.name.toLowerCase().includes(query)
                                                        );
                                                        const allAvailable = projectBranchesMap[project.projectId] || [];
                                                        const archived = (archivedBranchesMap[project.projectId] || []).filter(
                                                            b => !query || b.toLowerCase().includes(query) || project.name.toLowerCase().includes(query)
                                                        );
                                                        const selected = projectBranchSelections.find((s) => s.projectId === project.projectId);
                                                        const selectedCount = selected?.branches.length || 0;
                                                        const isExpanded = expandedProjects.has(project.projectId);
                                                        const allSelected = allAvailable.length > 0 && selectedCount === allAvailable.length;
                                                        const isLoadingBranches = loadingProjectIds.has(project.projectId);
                                                        const isBranchesLoaded = loadedProjectIds.has(project.projectId);

                                                        return (
                                                            <div key={project.projectId}>
                                                                {/* Project row */}
                                                                <button
                                                                    onClick={() => toggleProjectExpanded(project.projectId)}
                                                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors text-left"
                                                                >
                                                                    {isExpanded ? <ChevronDown
                                                                        className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" /> : <ChevronRight
                                                                        className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />}
                                                                    <FolderOpen className="h-4 w-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0"  />
                                                                    <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate flex-1">
                                                                        {project.name}
                                                                    </span>
                                                                    {isLoadingBranches ? (
                                                                        <span
                                                                            data-testid={`branch-row-loading-${project.projectId}`}
                                                                            className="text-[11px] text-zinc-500 dark:text-zinc-400"
                                                                        >
                                                                            <Spinner className="h-3.5 w-3.5 animate-spin"  />
                                                                        </span>
                                                                    ) : !isBranchesLoaded ? null : allAvailable.length === 0 && archived.length === 0 ? (
                                                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 italic">
                                                                            {t('pages.reportsPage.branchSelector.noBranches')}
                                                                        </span>
                                                                    ) : (
                                                                        <span className={cn(
                                                                            'text-[11px] font-medium',
                                                                            selectedCount > 0 ? 'text-secondary dark:text-secondary-light' : 'text-zinc-500 dark:text-zinc-400'
                                                                        )}>
                                                                            {selectedCount}/{allAvailable.length}
                                                                        </span>
                                                                    )}
                                                                </button>

                                                                {/* Expanded: still fetching this project's branches */}
                                                                {isExpanded && isLoadingBranches && (
                                                                    <div className="pl-8 pr-3 pb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                                        <Spinner className="h-3.5 w-3.5 animate-spin"  />
                                                                        {t('pages.reportsPage.branchSelector.loading')}
                                                                    </div>
                                                                )}
                                                                {/* Expanded branches (the row badge already conveys the
                                                                    loaded-but-empty "No branches" case) */}
                                                                {isExpanded && !isLoadingBranches && (available.length > 0 || (showArchivedBranches && archived.length > 0)) && (
                                                                    <div className="pl-8 pr-3 pb-2 space-y-0.5">
                                                                        {/* Select all toggle */}
                                                                        {available.length > 0 && (
                                                                        <button
                                                                            onClick={() => toggleAllBranchesForProject(project.projectId)}
                                                                            className="w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.03] transition-colors text-left"
                                                                        >
                                                                            <div className={cn(
                                                                                'h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0',
                                                                                allSelected
                                                                                    ? 'bg-secondary border-secondary'
                                                                                    : 'border-zinc-300 dark:border-as-line-strong'
                                                                            )}>
                                                                                {allSelected && <Check className="h-2 w-2 text-white"  />}
                                                                            </div>
                                                                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                                                {t('pages.reportsPage.branchSelector.selectAll')}
                                                                            </span>
                                                                        </button>
                                                                        )}
                                                                        {/* Active branches */}
                                                                        {available.map((branch) => {
                                                                            const isChecked = selected?.branches.includes(branch) ?? false;
                                                                            return (
                                                                                <div
                                                                                    key={branch}
                                                                                    className="group w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.03] transition-colors"
                                                                                >
                                                                                    <button
                                                                                        onClick={() => toggleBranch(project.projectId, branch)}
                                                                                        className="flex items-center gap-2 flex-1 text-left min-w-0"
                                                                                    >
                                                                                        <div className={cn(
                                                                                            'h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0',
                                                                                            isChecked
                                                                                                ? 'bg-secondary border-secondary'
                                                                                                : 'border-zinc-300 dark:border-as-line-strong'
                                                                                        )}>
                                                                                            {isChecked && <Check className="h-2 w-2 text-white"  />}
                                                                                        </div>
                                                                                        <CodeBranch className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"  />
                                                                                        <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                                                                                            {branch}
                                                                                        </span>
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => onArchiveBranch(project.projectId, branch)}
                                                                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-amber-500 transition-colors flex-shrink-0"
                                                                                        title={t('components.branchSelector.archive')}
                                                                                    >
                                                                                        <Archive className="h-3.5 w-3.5"  />
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {/* Archived branches */}
                                                                        {showArchivedBranches && archived.map((branch) => {
                                                                            const isChecked = selected?.branches.includes(branch) ?? false;
                                                                            return (
                                                                                <div
                                                                                    key={`archived-${branch}`}
                                                                                    className="group w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.03] transition-colors opacity-60 hover:opacity-100"
                                                                                >
                                                                                    <button
                                                                                        onClick={() => toggleBranch(project.projectId, branch)}
                                                                                        className="flex items-center gap-2 flex-1 text-left min-w-0"
                                                                                    >
                                                                                        <div className={cn(
                                                                                            'h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0',
                                                                                            isChecked
                                                                                                ? 'bg-secondary border-secondary'
                                                                                                : 'border-zinc-300 dark:border-as-line-strong'
                                                                                        )}>
                                                                                            {isChecked && <Check className="h-2 w-2 text-white"  />}
                                                                                        </div>
                                                                                        <CodeBranch className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"  />
                                                                                        <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                                                                                            {branch}
                                                                                        </span>
                                                                                        <span className="text-[11px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 font-medium flex-shrink-0">
                                                                                            {t('components.branchSelector.archivedBadge')}
                                                                                        </span>
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => onUnarchiveBranch(project.projectId, branch)}
                                                                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-emerald-500 transition-colors flex-shrink-0"
                                                                                        title={t('components.branchSelector.unarchive')}
                                                                                    >
                                                                                        <Box className="h-3.5 w-3.5"  />
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                );
                                            })}
                                        </div>

                                        {/* No branches selected warning */}
                                        {totalSelectedBranches === 0 && (
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                                                {t('pages.reportsPage.branchSelector.noneSelected')}
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                    </div>
                )}

                {/* Step 2 Navigation */}
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-as-line sm:px-6 justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => setCurrentStep(1)}
                        icon={<ArrowLeft className="h-4 w-4"  />}
                    >
                        {t('pages.reportsPage.wizard.back')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => setCurrentStep(3)}
                        icon={<ArrowRight className="h-4 w-4"  />}
                        iconPosition="right"
                    >
                        {t('pages.reportsPage.wizard.continue')}
                    </Button>
                </div>
                </>)}

                {/* STEP 3: Review & Generate */}
                {currentStep === 3 && (<>
                {/* Summary Card */}
                        <div className="p-4 sm:p-6 space-y-5">
                            <div>
                                <h2 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
                                    {t('pages.reportsPage.wizard.reviewTitle')}
                                </h2>
                                <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                    {t('pages.reportsPage.wizard.reviewDesc')}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] space-y-1.5">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                        {t('pages.reportsPage.wizard.summaryScope')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {React.createElement(activeScope === 'organization' ? Building : activeScope === 'team' ? Users : LayerGroup, { className: "h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" })}
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{scopeSummary}</p>
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] space-y-1.5">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                        {t('pages.reportsPage.wizard.summaryType')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <ShieldAlt className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{reportType.toUpperCase()}</p>
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] space-y-1.5">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                        {t('pages.reportsPage.wizard.summaryFormat')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {React.createElement(reportFormat === 'pdf' ? FilePdf : reportFormat === 'html' ? FileAlt : FileCode, { className: 'h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400' })}
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{reportFormat.toUpperCase()}</p>
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] space-y-1.5">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                        {t('pages.reportsPage.wizard.summaryDetail')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {detailed ? <ChartBar className="h-4 w-4 text-zinc-500 dark:text-zinc-400" /> : <ListUl className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />}
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {detailed ? t('pages.reportsPage.configuration.detailed') : t('pages.reportsPage.configuration.summary')}
                                        </p>
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] space-y-1.5">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                        {t('pages.reportsPage.wizard.summaryBranches')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <CodeBranch className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                            {branchFilter === 'all'
                                                ? t('pages.reportsPage.branchFilter.all')
                                                : branchFilter === 'reference'
                                                ? t('pages.reportsPage.branchFilter.reference')
                                                : t('pages.reportsPage.branchSelector.selectedCount', { count: totalSelectedBranches })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                {/* Error Display */}
                {reportError && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn(AS_NOTICE_BLOCK, 'mx-4 mb-4 sm:mx-6')}
                    >
                        <div>
                            <p className={cn(AS_NOTICE_TITLE, WORD_TONE.bad)}>
                                {t('pages.reportsPage.error.title')}
                            </p>
                            <p className="mt-1">
                                {reportError}
                            </p>
                        </div>
                    </motion.div>
                )}

                {/* Standard Info */}
                <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                <div className="p-4 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line rounded-xl">
                    <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                            <InfoCircle className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400"  />
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                {reportType === 'owasp'
                                    ? t('pages.reportsPage.standardInfo.owasp.title')
                                    : reportType === 'cwe'
                                    ? t('pages.reportsPage.standardInfo.cwe.title')
                                    : t('pages.reportsPage.standardInfo.license.title')
                                }
                            </h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                                {reportType === 'owasp'
                                    ? t('pages.reportsPage.standardInfo.owasp.description')
                                    : reportType === 'cwe'
                                    ? t('pages.reportsPage.standardInfo.cwe.description')
                                    : t('pages.reportsPage.standardInfo.license.description')
                                }
                            </p>
                            {reportType !== 'license' && (
                            <a
                                href={reportType === 'owasp' ? 'https://owasp.org/www-project-top-ten/' : 'https://cwe.mitre.org/top25/'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary dark:text-secondary-light hover:underline mt-2 transition-colors"
                            >
                                {t('pages.reportsPage.standardInfo.learnMore')}
                                <ExternalLinkAlt className="h-4 w-4"  />
                            </a>
                            )}
                        </div>
                    </div>
                </div>
                </div>

                {/* Step 3 Navigation: back on the left, the help line and Generate on the right */}
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-as-line sm:px-6 justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => setCurrentStep(2)}
                        icon={<ArrowLeft className="h-4 w-4"  />}
                    >
                        {t('pages.reportsPage.wizard.back')}
                    </Button>
                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-sm:w-full">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-sm:order-2 max-sm:w-full">
                            {reportLoading ? t('pages.reportsPage.generating.message') : t('pages.reportsPage.helpText')}
                        </p>
                        {/* Generate Button */}
                    {writesBlocked ? (
                        <div
                            className="relative group inline-flex max-sm:w-full"
                            data-testid="generate-report-blocked-wrapper"
                        >
                            <Button
                                variant="secondary"
                                disabled
                                onClick={() => {}}
                                size="lg"
                                icon={<Download className="h-4 w-4"  />}
                            >
                                {t('pages.reportsPage.generateButton')}
                            </Button>
                            <div
                                role="tooltip"
                                className={cn(AS_TOOLTIP, "absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                            >
                                {t('billing.trial_exhausted_report_disabled')}
                            </div>
                        </div>
                    ) : (
                        <Button
                            variant="secondary"
                            onClick={handleGenerate}
                            loading={reportLoading}
                            disabled={isGenerateDisabled()}
                            size="lg"
                            icon={<Download className="h-4 w-4"  />}
                        >
                            {t('pages.reportsPage.generateButton')}
                        </Button>
                    )}


                    </div>
                </div>
                </>)}
                </Card>
            </motion.div>

            {/* Team Projects Modal */}
            {showTeamProjectsModal && selectedTeamId && (
                <Modal
                    onClose={() => setShowTeamProjectsModal(false)}
                    title={t('pages.reportsPage.teamReport.projectsModalTitle')}
                >
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {selectedTeamProjects.length === 0 ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
                                {t('pages.reportsPage.teamReport.noProjectsInTeam')}
                            </p>
                        ) : (
                            selectedTeamProjects.map((project, index) => (
                                <motion.div
                                    key={project.projectId}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-white/[0.03]"
                                >
                                    <FolderOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                                    <div>
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {project.name}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {t('pages.reportsPage.teamReport.createdAt', {
                                                date: new Date(project.createdAt).toLocaleDateString(),
                                            })}
                                        </p>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </Modal>
            )}
        </PageContainer>
    );

    return (
        <OnboardingStep
            title={t('components.onboarding.reports.title')}
            subtitle={t('components.onboarding.reports.subtitle')}
            stepId="reports"
        >
            {content}
        </OnboardingStep>
    );
};

export default ReportsPageTemplate;
