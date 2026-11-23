import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { RootState, AppDispatch } from '@/server/store';
import { refreshBackgroundTasks } from '@/server/store/backgroundTasksThunks';
import { useEditionEntitlements } from "@/edition/entitlements";
import { useOnboardingProgress } from '@/server/hooks/useOnboardingProgress';
import useOrganizationTeams from '@/server/hooks/useOrganizationTeams';
import useAllOrganizationProjects from '@/server/hooks/useAllOrganizationProjects';
import useAggregatedReports from '@/server/hooks/useAggregatedReports';
import { archiveBranch, unarchiveBranch } from '@/server/services/resultService';
import { ProjectBranchSelection } from '@/server/interfaces/Vulnerability';
import ReportsPageTemplate from './ReportsPageTemplate';
import { fetchReportBranchMaps } from './reportBranchData';
import { FeatureGate } from '@/components/molecules/feature-gate';
import useBillingEntitlements from '@/server/hooks/useBillingEntitlements';
import { useDisabledFeatures } from "@/server/hooks/useDisabledFeatures";
import { useReportDeepLink } from '@/components/organismes/stored-reports/useReportDeepLink';
import { apiErrorKey } from '@/utils/function/apiErrorKey';

/**
 * ReportsPage Container Component
 * Handles logic, data fetching, and state management for report generation
 */
const ReportsPage: React.FC = () => {
    const { t } = useTranslation();
    const { complete } = useOnboardingProgress();
    const dispatch = useDispatch<AppDispatch>();

    // Redux state
    const organization = useSelector((state: RootState) => state.organization);
    const selectedOrganization = organization.selectedOrganization;
    const organizationId = selectedOrganization?.id || '';

    // A ?reportId=… deep-link from the background-tasks widget opens the
    // stored-reports drawer, on mount and on every later link to this page.
    const { reportId: highlightReportId, key: highlightKey } = useReportDeepLink();
    const { entitlements } = useBillingEntitlements(organizationId);
    // Mirror the live org id so an in-flight per-project load can detect that the
    // user switched organizations while it was awaiting, and discard its result.
    const organizationIdRef = useRef(organizationId);
    organizationIdRef.current = organizationId;
    const disabledFeatures = useDisabledFeatures();
    const isReportsDisabled = disabledFeatures.has('reports');
    const writesBlocked = useEditionEntitlements().writesBlocked;

    // Local state for report generation options
    const [reportType, setReportType] = useState<'owasp' | 'cwe' | 'license' | 'ai-act'>('owasp');
    const [reportFormat, setReportFormat] = useState<'json' | 'html' | 'pdf'>('pdf');
    const [detailed, setDetailed] = useState<boolean>(true);
    const [branchFilter, setBranchFilter] = useState<'all' | 'reference' | 'selected'>('all');
    const [projectBranchSelections, setProjectBranchSelections] = useState<ProjectBranchSelection[]>([]);
    const [projectBranchesMap, setProjectBranchesMap] = useState<Record<string, string[]>>({});
    const [archivedBranchesMap, setArchivedBranchesMap] = useState<Record<string, string[]>>({});
    // Per-project lazy-load bookkeeping: which projects have already had their
    // branches fetched, and which currently have a request in flight.
    const [loadedProjectIds, setLoadedProjectIds] = useState<Set<string>>(new Set());
    const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(new Set());

    // State for team selection
    const [selectedTeamId, setSelectedTeamId] = useState<string>('');

    // State for project selection (batch reports)
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

    // Fetch teams (disabled for Developer plan to avoid unnecessary 403s)
    const {
        teams,
        loading: teamsLoading,
        error: teamsError,
    } = useOrganizationTeams(organizationId, !isReportsDisabled);

    // Fetch all projects for selection (passes empty ID when blocked so hook short-circuits)
    const {
        projects,
        loading: projectsLoading,
        error: projectsError,
    } = useAllOrganizationProjects(isReportsDisabled ? '' : organizationId);

    // Reports generation hook
    const {
        loading: reportLoading,
        error: reportError,
        generateOrgReport,
        generateTeamReportFn,
        generateBatchReportFn,
        clearError,
    } = useAggregatedReports();

    /**
     * Lazily fetch a single project's branches the first time its row is
     * expanded in the "selected branches" step.
     *
     * Replaces the previous eager fan-out that fetched every project's branches
     * the moment the filter switched to "selected" — an org with hundreds of
     * projects no longer pays for branches it will never open. Each project is
     * fetched at most once (subsequent expands read the in-memory maps), and an
     * in-flight guard prevents a duplicate request when a row is toggled twice
     * before the first response lands. The single-project call still goes through
     * the org-scoped batch endpoint (active + archived in one round-trip) — see
     * {@link fetchReportBranchMaps}.
     */
    const loadBranchesForProject = useCallback(
        async (projectId: string) => {
            if (!organizationId || !projectId) return;
            if (loadedProjectIds.has(projectId) || loadingProjectIds.has(projectId)) return;

            setLoadingProjectIds((prev) => new Set(prev).add(projectId));
            try {
                const { branchesMap, archivedBranchesMap: archivedMap } =
                    await fetchReportBranchMaps(organizationId, [projectId]);
                // The active org may have changed while awaiting — discard a stale
                // response so a previous org's branches never leak into the new one.
                if (organizationIdRef.current !== organizationId) return;
                setProjectBranchesMap((prev) => ({
                    ...prev,
                    [projectId]: branchesMap[projectId] ?? [],
                }));
                setArchivedBranchesMap((prev) => ({
                    ...prev,
                    [projectId]: archivedMap[projectId] ?? [],
                }));
                // Mark "loaded" only on success: a failed fetch must stay retryable
                // so re-expanding the row tries again instead of sticking forever on
                // a misleading "No branches".
                setLoadedProjectIds((prev) => new Set(prev).add(projectId));
            } catch {
                // Swallow: leave the project unloaded so the next expand retries.
                // A transient blip must never permanently blank a real project.
            } finally {
                // Only clear the in-flight flag for the still-current org; if the
                // org changed, the reset effect already wiped this state.
                if (organizationIdRef.current === organizationId) {
                    setLoadingProjectIds((prev) => {
                        const next = new Set(prev);
                        next.delete(projectId);
                        return next;
                    });
                }
            }
        },
        [organizationId, loadedProjectIds, loadingProjectIds],
    );

    // Drop cached branches when the active organization changes so a previous
    // org's per-project maps can never leak into the new org's selector.
    useEffect(() => {
        setProjectBranchesMap({});
        setArchivedBranchesMap({});
        setLoadedProjectIds(new Set());
        setLoadingProjectIds(new Set());
    }, [organizationId]);

    /**
     * Generates an organization-wide report
     */
    const handleGenerateOrganizationReport = async () => {
        if (!organizationId) {
            toast.error(t('pages.reportsPage.errors.noOrganization'));
            return;
        }

        try {
            clearError();
            const result = await generateOrgReport(
                organizationId,
                reportType,
                reportFormat,
                detailed,
                true,
                branchFilter,
                projectBranchSelections
            );

            if (result) {
                complete('report_generated');
                dispatch(refreshBackgroundTasks());
                toast.info(
                    t('pages.reportsPage.generating.started')
                );
            }
        } catch (error: any) {
            toast.error(
                t(apiErrorKey(error, { fallback: 'pages.reportsPage.errors.generateFailed' }))
            );
        }
    };

    /**
     * Generates a team report
     */
    const handleGenerateTeamReport = async () => {
        if (!selectedTeamId) {
            toast.error(t('pages.reportsPage.errors.noTeamSelected'));
            return;
        }

        try {
            clearError();
            const result = await generateTeamReportFn(
                selectedTeamId,
                reportType,
                reportFormat,
                detailed,
                true,
                branchFilter,
                projectBranchSelections,
                organizationId,
            );

            if (result) {
                complete('report_generated');
                dispatch(refreshBackgroundTasks());
                toast.info(
                    t('pages.reportsPage.generating.started')
                );
            }
        } catch (error: any) {
            toast.error(
                t(apiErrorKey(error, { fallback: 'pages.reportsPage.errors.generateFailed' }))
            );
        }
    };

    /**
     * Generates a batch report for selected projects
     */
    const handleGenerateBatchReport = async () => {
        if (selectedProjectIds.length === 0) {
            toast.error(t('pages.reportsPage.errors.noProjectsSelected'));
            return;
        }

        if (!organizationId) {
            toast.error(t('pages.reportsPage.errors.noOrganization'));
            return;
        }

        try {
            clearError();
            const result = await generateBatchReportFn(
                organizationId,
                selectedProjectIds,
                reportType,
                reportFormat,
                detailed,
                true,
                branchFilter,
                projectBranchSelections
            );

            if (result) {
                complete('report_generated');
                dispatch(refreshBackgroundTasks());
                toast.info(
                    t('pages.reportsPage.generating.started')
                );
            }
        } catch (error: any) {
            toast.error(
                t(apiErrorKey(error, { fallback: 'pages.reportsPage.errors.generateFailed' }))
            );
        }
    };

    const handleArchiveBranch = useCallback(async (projectId: string, branchName: string) => {
        try {
            await archiveBranch(projectId, branchName);
            // Move from active to archived
            setProjectBranchesMap(prev => ({
                ...prev,
                [projectId]: (prev[projectId] || []).filter(b => b !== branchName),
            }));
            setArchivedBranchesMap(prev => ({
                ...prev,
                [projectId]: [...(prev[projectId] || []), branchName],
            }));
            // Remove from selections if selected
            setProjectBranchSelections(prev =>
                prev.map(s => s.projectId === projectId
                    ? { ...s, branches: s.branches.filter(b => b !== branchName) }
                    : s
                ).filter(s => s.branches.length > 0)
            );
        } catch (err) {
            console.error('Failed to archive branch:', err);
        }
    }, []);

    const handleUnarchiveBranch = useCallback(async (projectId: string, branchName: string) => {
        try {
            await unarchiveBranch(projectId, branchName);
            // Move from archived to active
            setArchivedBranchesMap(prev => ({
                ...prev,
                [projectId]: (prev[projectId] || []).filter(b => b !== branchName),
            }));
            setProjectBranchesMap(prev => ({
                ...prev,
                [projectId]: [...(prev[projectId] || []), branchName],
            }));
        } catch (err) {
            console.error('Failed to unarchive branch:', err);
        }
    }, []);

    /**
     * Toggles project selection for batch reports
     */
    const handleToggleProject = (projectId: string) => {
        setSelectedProjectIds((prev) =>
            prev.includes(projectId)
                ? prev.filter((id) => id !== projectId)
                : [...prev, projectId]
        );
    };

    /**
     * Selects all projects
     */
    const handleSelectAllProjects = () => {
        setSelectedProjectIds(projects.map((p) => p.projectId));
    };

    /**
     * Deselects all projects
     */
    const handleDeselectAllProjects = () => {
        setSelectedProjectIds([]);
    };

    /**
     * Get projects for selected team
     */
    const selectedTeamProjects = useMemo(() => {
        if (!selectedTeamId) return [];
        return projects.filter((project) => project.teamId === selectedTeamId);
    }, [selectedTeamId, projects]);

    return (
        <FeatureGate feature="reports" preview featureLabel="Reports">
        <ReportsPageTemplate
            // Organization info
            organizationName={selectedOrganization?.name || ''}
            organizationId={organizationId}
            // Stored-reports drawer trigger data
            maxStoredReports={entitlements?.maxStoredReports}
            reportRetentionDays={entitlements?.reportRetentionDays}
            highlightReportId={highlightReportId}
            highlightKey={highlightKey}
            // Teams data
            teams={teams}
            teamsLoading={teamsLoading}
            teamsError={teamsError}
            selectedTeamId={selectedTeamId}
            onTeamSelect={setSelectedTeamId}
            selectedTeamProjects={selectedTeamProjects}
            // Projects data
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            selectedProjectIds={selectedProjectIds}
            onToggleProject={handleToggleProject}
            onSelectAllProjects={handleSelectAllProjects}
            onDeselectAllProjects={handleDeselectAllProjects}
            // Report options
            reportType={reportType}
            onReportTypeChange={setReportType}
            reportFormat={reportFormat}
            onReportFormatChange={setReportFormat}
            detailed={detailed}
            onDetailedChange={setDetailed}
            // Branch filter
            branchFilter={branchFilter}
            onBranchFilterChange={setBranchFilter}
            projectBranchSelections={projectBranchSelections}
            onProjectBranchSelectionsChange={setProjectBranchSelections}
            projectBranchesMap={projectBranchesMap}
            archivedBranchesMap={archivedBranchesMap}
            onArchiveBranch={handleArchiveBranch}
            onUnarchiveBranch={handleUnarchiveBranch}
            onLoadProjectBranches={loadBranchesForProject}
            loadingProjectIds={loadingProjectIds}
            loadedProjectIds={loadedProjectIds}
            // Report generation
            reportLoading={reportLoading}
            reportError={reportError}
            onGenerateOrganizationReport={handleGenerateOrganizationReport}
            onGenerateTeamReport={handleGenerateTeamReport}
            onGenerateBatchReport={handleGenerateBatchReport}
            writesBlocked={writesBlocked}
        />
        </FeatureGate>
    );
};

export default ReportsPage;
