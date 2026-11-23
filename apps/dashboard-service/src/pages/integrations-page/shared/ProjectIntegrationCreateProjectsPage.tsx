import BackButton from "@/components/atoms/button/BackButton";
import Button from "@/components/atoms/button/Button";
import Checkbox from "@/components/atoms/checkbox/Checkbox";
import Select from "@/components/atoms/select/Select";
import Input from "@/components/atoms/input/Input";
import { Slot } from "@/edition/slots";
import { createProject, deleteProject } from "@/server/services/projectService";
import { fetchAllTeams } from "@/server/services/teamService";
import { RootState } from "@/server/store";
import { useEditionEntitlements } from "@/edition/entitlements";
import { ArrowRight } from '@/components/atoms/icon/icons';
import LoaderHome from "@/components/atoms/loader/LoaderHome";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { IntegrationPageConfig, Repository, IntegrationHook } from "@/server/interfaces/IntegrationProvider";
import { projectPath } from "@/utils/product";

import { AS_TOOLTIP, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { useStoredTheme } from '@/utils/theme/useDocumentTheme';
import { appsecProjectListPath } from "@/utils/appsecProjectList";
import { apiErrorKey } from '@/utils/function/apiErrorKey';
export interface Team {
    id: string;
    name: string;
}

interface ProjectIntegrationCreateProjectsPageProps {
    config: IntegrationPageConfig;
    useIntegrationHook: (organizationId: string) => IntegrationHook;
}

export const ProjectIntegrationCreateProjectsPage: React.FC<ProjectIntegrationCreateProjectsPageProps> = ({
    config,
    useIntegrationHook
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    // No Layout, so no rail: the remembered theme is applied here, or a direct
    // load draws the page light in dark mode.
    useStoredTheme();

    const organization = useSelector((state: RootState) => state.organization);
    const selectedOrganization = organization.selectedOrganization;
    const writesBlocked = useEditionEntitlements().writesBlocked;
    const organizationId = selectedOrganization?.id || "";

    const {
        repositories,
        isLoadingRepositories: loadingRepos,
        linkRepository,
        isLinkingRepository,
    } = useIntegrationHook(organizationId);

    const [isCreating, setIsCreating] = useState(false);
    const [teams, setTeams] = useState<Team[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState<string>("");
    const [selectedRepos, setSelectedRepos] = useState<{
        [repoId: string]: { projectName: string; selected: boolean };
    }>({});
    // The project flags each created project is given; an edition's
    // `project.settings.sections` registration lets the user change them.
    const [aiFeatures, setAiFeatures] = useState({
        aiMergeRequestEnabled: true,
        improvingResultsEnabled: true,
        sortsVulnerabilitiesEnabled: true,
        securityChampionEnabled: true,
    });
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [showLinkedRepos, setShowLinkedRepos] = useState<boolean>(false);
    const [isRedirecting, setIsRedirecting] = useState(false);

    // Helper function to get repository display name
    const getRepositoryDisplayName = (repo: Repository) => {
        return repo.nameWithNamespace || repo.fullName || repo.name;
    };

    // Separate linked and unlinked repositories
    const linkedRepos = repositories.filter((repo) => repo.projectId);
    const unlinkedRepos = repositories.filter((repo) => !repo.projectId);

    // Filter repositories based on search query and show linked toggle
    const filteredRepos = (showLinkedRepos ? repositories : unlinkedRepos).filter((repo) => {
        const displayName = getRepositoryDisplayName(repo).toLowerCase();
        return displayName.includes(searchQuery.toLowerCase());
    });

    const fetchTeamsData = async () => {
        try {
            const data = await fetchAllTeams(organizationId);
            if (data.length === 0) {
                setTeams([]);
                return;
            }
            setTeams(data);
            if (data.length > 0 && !selectedTeamId) {
                setSelectedTeamId(data[0].id);
            }
        } catch (error: any) {
            if (error.response?.status === 404) {
                setTeams([]);
                return;
            }
            setTeams([]);
            toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.fetchError' })));
            throw error;
        }
    };

    useEffect(() => {
        fetchTeamsData();
    }, [organizationId]);

    useEffect(() => {
        const initialSelected: {
            [repoId: string]: { projectName: string; selected: boolean };
        } = {};
        unlinkedRepos.forEach((repo) => {
            // Preserve existing selection state if it exists
            const existingState = selectedRepos[repo.id];
            const projectName = repo.nameWithNamespace || repo.fullName || repo.name;
            initialSelected[repo.id] = existingState || {
                projectName,
                selected: false,
            };
        });
        setSelectedRepos(initialSelected);
    }, [unlinkedRepos.map(r => r.id).join(',')]); // Only depend on repo IDs, not the full objects

    const handleCreateProjects = async () => {
        if (!selectedTeamId) {
            toast.error(t(`pages.integration.${config.translationKey}.createProjects.selectTeamError`));
            return;
        }

        const reposToCreate = Object.entries(selectedRepos).filter(
            ([, val]) => val.selected && val.projectName.trim() !== ""
        );
        if (reposToCreate.length === 0) {
            toast.error(t(`pages.integration.${config.translationKey}.createProjects.noSelectedRepos`));
            return;
        }

        setIsCreating(true);
        try {
            let successCount = 0;
            let firstProjectId: string | null = null;
            for (const [repoId, val] of reposToCreate) {
                let createdProjectId = null;
                try {
                    // Create the project
                    const createdProject = await createProject(
                        selectedTeamId,
                        val.projectName,
                        aiFeatures.aiMergeRequestEnabled,
                        aiFeatures.improvingResultsEnabled,
                        aiFeatures.sortsVulnerabilitiesEnabled,
                        aiFeatures.securityChampionEnabled,
                        undefined,
                        // Created from the AppSec space: an AppSec project.
                        'appsec'
                    );
                    createdProjectId = createdProject.projectId;

                    // Link the project to repository
                    await linkRepository(createdProject.projectId, repoId);

                    if (!firstProjectId) {
                        firstProjectId = createdProject.projectId;
                    }
                    successCount++;
                } catch (error) {
                    // If a project was created but linking failed, delete the project
                    if (createdProjectId) {
                        try {
                            await deleteProject(createdProjectId);
                        } catch (deleteError) {
                            // A constant message: the project name and id stay out of the format string.
                            console.error('Failed to delete a project whose repository link failed', deleteError);
                        }
                    }

                    // Handle error for each project individually
                    toast.error(`${t(`pages.integration.${config.translationKey}.createProjects.failedToCreate`)} "${val.projectName}": ${t(apiErrorKey(error))}`);
                    console.error('Failed to create or link a project', error);
                }
            }

            if (successCount > 0) {
                toast.success(`${successCount} project(s) created and linked successfully!`);
                // Mark onboarding steps
                try {
                    const { completeOnboardingStep } = await import('@/server/services/userService');
                    await completeOnboardingStep('first_project');
                    await completeOnboardingStep('integration_linked');
                } catch { /* non-blocking */ }
                if (firstProjectId) {
                    setIsRedirecting(true);
                    setTimeout(() => {
                        navigate(projectPath("appsec", firstProjectId, "sast"));
                    }, 4000);
                } else {
                    // The import is an AppSec page: back to its project list, not the root the landing rule decides.
                    navigate(appsecProjectListPath());
                }
            } else {
                toast.error(t(`pages.integration.${config.translationKey}.createProjects.failedToCreateMultiple`));
            }
        } catch (error) {
            toast.error(t(apiErrorKey(error, { fallback: `pages.integration.${config.translationKey}.createProjects.failedToCreateMultiple` })));
        } finally {
            setIsCreating(false);
        }
    };

    const toggleRepoSelection = (repoId: string, selected: boolean) => {
        setSelectedRepos((prev) => ({
            ...prev,
            [repoId]: { ...prev[repoId], selected },
        }));
    };

    const updateProjectName = (repoId: string, projectName: string) => {
        setSelectedRepos((prev) => ({
            ...prev,
            [repoId]: { ...prev[repoId], projectName },
        }));
    };

    if (isRedirecting) {
        return <LoaderHome title={t('common.loading')} />;
    }

    return (
        <div className="min-h-screen flex flex-col md:flex-row">
            {/* Left panel at 1/4 width on md+ */}
            <div className="flex-shrink-0 bg-primary flex flex-col justify-between p-8 md:pl-12 md:pr-12 h-auto md:h-screen md:w-1/4">
                <img src="/logo-white.webp" alt="Logo" className="w-40 md:w-60 mb-8" />
                <div className="space-y-8">
                    <div className="text-white space-y-6">
                        <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
                            {t(`pages.integration.${config.translationKey}.createProjects.title`)}
                        </h1>
                        <p className="text-lg opacity-90">
                            {t(`pages.integration.${config.translationKey}.createProjects.subtitle`)}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 gap-6 mt-8 text-white/90">
                        <div className="flex items-center space-x-4">
                            <div className="h-8 w-8 flex-shrink-0 bg-secondary rounded-full"></div>
                            <div>
                                <h3 className="font-medium">{t(`pages.integration.${config.translationKey}.createProjects.bulkCreation`)}</h3>
                                <p className="text-white/70">
                                    {t(`pages.integration.${config.translationKey}.createProjects.bulkDescription`)}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="text-white/60 text-sm mt-10">
                    {t(`pages.integration.${config.translationKey}.common.copyright`)}
                </div>
            </div>

            {/* Right panel: limit height to viewport on md+ to avoid overflowing left sidebar and enable internal scroll */}
            <div className="flex-1 md:w-3/4 p-4 sm:p-6 bg-as-bg md:h-screen md:overflow-y-auto flex flex-col">
                <div className="w-full space-y-6 rounded-2xl border border-zinc-200 bg-white p-5 md:p-8 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)] animate-fade-in">
                    <div className="text-center space-y-4">
                        <div className="w-12 h-12 flex items-center justify-center mx-auto [&_svg]:h-6 [&_svg]:w-6">
                            <ArrowRight className="h-6 w-6 text-secondary dark:text-secondary-light" />
                        </div>
                        <h1 className="text-xl md:text-2xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
                            {t(`pages.integration.${config.translationKey}.createProjects.pageTitle`)}
                        </h1>
                        <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-300">
                            {t(`pages.integration.${config.translationKey}.createProjects.pageSubtitle`)}
                        </p>
                    </div>

                    <div className="space-y-4">
                        {teams.length > 0 && (
                            <Select
                                label={t(`pages.integration.${config.translationKey}.createProjects.team`)}
                                options={teams.map((t) => ({ label: t.name, value: t.id }))}
                                value={selectedTeamId}
                                onChange={(val) => setSelectedTeamId(val as string)}
                            />
                        )}

                        {/* The AI features of the created projects: a
                            `project.settings.sections` registration of the
                            active edition. */}
                        {teams.length > 0 && (
                            <Slot
                                name="project.settings.sections"
                                context={{
                                    organizationId,
                                    host: "project-creation",
                                    settings: {
                                        values: { ...aiFeatures },
                                        onChange: (values) => setAiFeatures({ ...aiFeatures, ...values }),
                                    },
                                }}
                            />
                        )}

                        {loadingRepos && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                {t(`pages.integration.${config.translationKey}.common.loadingRepositories`)}
                            </p>
                        )}
                        {!loadingRepos && unlinkedRepos.length === 0 && linkedRepos.length === 0 && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                {t(`pages.integration.${config.translationKey}.createProjects.noRepos`)}
                            </p>
                        )}
                        {!loadingRepos && repositories.length > 0 && (
                            <div className="border border-zinc-200 dark:border-as-line rounded-xl overflow-hidden">
                                {/* Header with search and stats */}
                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-as-line space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4 text-[13px] tabular-nums">
                                            <span className="text-zinc-600 dark:text-zinc-400">
                                                <span className="font-medium text-zinc-900 dark:text-zinc-100">{unlinkedRepos.length}</span> {t(`pages.integration.${config.translationKey}.createProjects.availableRepos`) || "available"}
                                            </span>
                                            {linkedRepos.length > 0 && (
                                                <span className="text-zinc-500 dark:text-zinc-400">
                                                    <span className="font-medium">{linkedRepos.length}</span> {t(`pages.integration.${config.translationKey}.createProjects.alreadyLinked`) || "already linked"}
                                                </span>
                                            )}
                                        </div>
                                        {linkedRepos.length > 0 && (
                                            <label className={cn("relative flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400 cursor-pointer", AS_TOUCH)}>
                                                <input
                                                    type="checkbox"
                                                    checked={showLinkedRepos}
                                                    onChange={(e) => setShowLinkedRepos(e.target.checked)}
                                                    className="rounded-[4px] border-zinc-300 dark:border-white/[0.2] dark:bg-as-raised text-secondary dark:text-secondary-light focus:ring-secondary"
                                                />
                                                {t(`pages.integration.${config.translationKey}.createProjects.showLinked`) || "Show linked"}
                                            </label>
                                        )}
                                    </div>
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={t(`pages.integration.${config.translationKey}.createProjects.searchPlaceholder`) || "Search repositories..."}
                                    />
                                </div>
                                <div className="max-h-96 overflow-y-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-zinc-50 dark:bg-[#16161a] sticky top-0 z-10">
                                            <tr>
                                                <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    {t(`pages.integration.${config.translationKey}.common.select`)}
                                                </th>
                                                <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    {t(`pages.integration.${config.translationKey}.common.repository`)}
                                                </th>
                                                <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    {t(`pages.integration.${config.translationKey}.createProjects.projectName`)}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredRepos.length === 0 ? (
                                                <tr>
                                                    <td colSpan={3} className="py-8 px-4 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                                                        {t(`pages.integration.${config.translationKey}.createProjects.noMatchingRepos`) || "No matching repositories found"}
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredRepos.map((repo) => {
                                                    const isLinked = !!repo.projectId;
                                                    return (
                                                        <tr
                                                            key={repo.id}
                                                            className={`border-b border-zinc-100 dark:border-as-line ${isLinked
                                                                    ? 'bg-zinc-50 dark:bg-white/[0.03] opacity-60'
                                                                    : 'transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                                                                }`}
                                                        >
                                                            <td className="py-3 px-4">
                                                                {isLinked ? (
                                                                    <span className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                                                        {t(`pages.integration.${config.translationKey}.createProjects.linked`) || "Linked"}
                                                                    </span>
                                                                ) : (
                                                                    <Checkbox
                                                                        name={`repo-${repo.id}`}
                                                                        value={repo.id}
                                                                        label=""
                                                                        checked={selectedRepos[repo.id]?.selected || false}
                                                                        onChange={(e) => toggleRepoSelection(repo.id, e.target.checked)}
                                                                    />
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-4 text-[13px] text-zinc-900 dark:text-zinc-100">
                                                                <div className="flex items-center space-x-2">
                                                                    {config.icon}
                                                                    <span>{getRepositoryDisplayName(repo)}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4">
                                                                {isLinked ? (
                                                                    <span className="text-[13px] text-zinc-500 dark:text-zinc-400 italic">
                                                                        {t(`pages.integration.${config.translationKey}.createProjects.alreadyLinkedToProject`) || "Already linked to a project"}
                                                                    </span>
                                                                ) : (
                                                                    <Input
                                                                        value={selectedRepos[repo.id]?.projectName || ""}
                                                                        onChange={(e) => updateProjectName(repo.id, e.target.value)}
                                                                        placeholder={t(`pages.integration.${config.translationKey}.createProjects.projectNamePlaceholder`)}
                                                                        disabled={!selectedRepos[repo.id]?.selected}
                                                                    />
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {repositories.length > 10 && (
                                    <div className="px-4 py-2.5 text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-as-line">
                                        {repositories.length} {t(`pages.integration.${config.translationKey}.createProjects.totalRepos`) || "repositories total"} ({unlinkedRepos.length} {t(`pages.integration.${config.translationKey}.createProjects.available`) || "available"})
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-center">
                            {writesBlocked ? (
                                <div
                                    className="relative group inline-flex w-full"
                                    data-testid="create-projects-blocked-wrapper"
                                >
                                    <div className="pointer-events-none w-full">
                                        <Button
                                            variant="secondary"
                                            fullWidth={true}
                                            className="w-full items-center justify-center"
                                            disabled
                                            onClick={() => {}}
                                        >
                                            {t(`pages.integration.${config.translationKey}.createProjects.createButton`)}
                                        </Button>
                                    </div>
                                    <div
                                        role="tooltip"
                                        className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                                    >
                                        {t('billing.read_only_integration_disabled')}
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    variant="secondary"
                                    fullWidth={true}
                                    className="w-full items-center justify-center"
                                    onClick={handleCreateProjects}
                                    loading={isCreating}
                                    disabled={isCreating || isLinkingRepository}
                                >
                                    {t(`pages.integration.${config.translationKey}.createProjects.createButton`)}
                                </Button>
                            )}
                        </div>
                        <BackButton
                            disabled={isCreating || isLinkingRepository}
                            text={t(`pages.integration.${config.translationKey}.common.backToChoice`)}
                            to={config.backToPath}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectIntegrationCreateProjectsPage;
