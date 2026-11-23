import BackButton from "@/components/atoms/button/BackButton";
import Button from "@/components/atoms/button/Button";
import Modal from "@/components/atoms/modal/Modal";
import Pagination from "@/components/molecules/pagination/Pagination";
import useOrganizationProjects from "@/server/hooks/useOrganizationProjects";
import { useOptimizedCrossProviderLinking } from "@/server/hooks/useOptimizedCrossProviderLinking";
import { RootState } from "@/server/store";
import { useEditionEntitlements } from "@/edition/entitlements";
import { ArrowRight, Github} from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { IntegrationPageConfig, Repository, IntegrationHook } from "@/server/interfaces/IntegrationProvider";

import { AS_TOOLTIP } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { useStoredTheme } from '@/utils/theme/useDocumentTheme';
import { appsecProjectListPath } from "@/utils/appsecProjectList";
import { apiErrorKey } from '@/utils/function/apiErrorKey';
interface ProjectIntegrationLinkExistingPageProps {
    config: IntegrationPageConfig;
    useIntegrationHook: (organizationId: string) => IntegrationHook;
}

export const ProjectIntegrationLinkExistingPage: React.FC<ProjectIntegrationLinkExistingPageProps> = ({
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

    const [pageSize, setPageSize] = useState<number>(10);
    const [searchQuery] = useState<string>("");

    const {
        projects,
        totalProjects,
        totalPages,
        currentPage,
        loading,
        error,
        goToPage,
        refresh,
    } = useOrganizationProjects(organizationId, pageSize, searchQuery);

    const {
        repositories,
        isLoadingRepositories: loadingRepos,
        linkRepository,
        isLinkingRepository,
    } = useIntegrationHook(organizationId);

    // Hook that checks the cross-provider links
    const { isProjectLinkedToOtherProvider } = useOptimizedCrossProviderLinking(organizationId, config.provider);

    const [showRepoModal, setShowRepoModal] = useState<boolean>(false);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [unlinkedRepos, setUnlinkedRepos] = useState<Repository[]>([]);

    useEffect(() => {
        // Update unlinked repos when repositories change (no cross-provider check)
        const availableRepos = repositories.filter(repo => !repo.projectId);
        setUnlinkedRepos(availableRepos);
    }, [repositories.map(r => `${r.id}-${r.projectId || 'none'}`).join(',')]); // Stable dependency built from the ids and the links

    const handleSelectProject = (projectId: string) => {
        setSelectedProjectId(projectId);
        // The unlinked repositories of the current provider
        const availableRepos = repositories.filter(repo => !repo.projectId);
        setUnlinkedRepos(availableRepos);
        setShowRepoModal(true);
    };

    // Whether a project is linked (across providers)
    const getProjectLinkingStatus = (projectId: string): {
        isLinked: boolean;
        provider?: string;
        repository?: Repository;
        otherProviderLink?: {
            isLinked: boolean;
            provider: string;
            repositoryName?: string;
        };
    } => {
        // Check the current provider
        const linkedRepo = repositories.find(repo => repo.projectId === projectId);
        if (linkedRepo) {
            return {
                isLinked: true,
                provider: config.provider,
                repository: linkedRepo,
            };
        }

        // Check the other provider
        const otherProviderLink = isProjectLinkedToOtherProvider(projectId);
        if (otherProviderLink.isLinked) {
            return {
                isLinked: false, // Not linked to the current provider
                otherProviderLink,
            };
        }

        return { isLinked: false };
    };

    const handleLink = async (repoId: string) => {
        if (!organizationId || organizationId.trim() === "" || !selectedProjectId) return;

        try {
            await linkRepository(selectedProjectId, repoId);
            toast.success(t(`pages.integration.${config.translationKey}.linkExisting.successfullyLinked`));
            refresh();
            setShowRepoModal(false);
            // The import is an AppSec page: back to its project list, not the root the landing rule decides.
            navigate(appsecProjectListPath());
        } catch (error) {
            console.error("Error linking repository:", error);
            toast.error(t(apiErrorKey(error, { fallback: `pages.integration.${config.translationKey}.linkExisting.linkError` })));
        }
    };

    const getRepositoryDisplayName = (repo: Repository) => {
        return repo.nameWithNamespace || repo.fullName || repo.name;
    };

    const RepoSelectionModal = () => {
        if (!showRepoModal || !selectedProjectId) return null;

        return (
            <Modal
                title={t(`pages.integration.${config.translationKey}.common.selectRepo`)}
                onClose={() => setShowRepoModal(false)}
                width="max-w-lg"
            >
                {loadingRepos && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {t(`pages.integration.${config.translationKey}.common.loadingRepositories`)}
                    </p>
                )}
                {!loadingRepos && unlinkedRepos.length === 0 && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {t(`pages.integration.${config.translationKey}.linkExisting.noReposToLink`)}
                    </p>
                )}
                {!loadingRepos && unlinkedRepos.length > 0 && (
                    <div className="space-y-4 max-h-64 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="h-9 border-b border-zinc-200 dark:border-as-line text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                        {t(`pages.integration.${config.translationKey}.common.repository`)}
                                    </th>
                                    <th className="h-9 border-b border-zinc-200 dark:border-as-line text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                        {t(`pages.integration.${config.translationKey}.common.action`)}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {unlinkedRepos.map((repo) => (
                                    <tr key={repo.id} className="border-b border-zinc-100 dark:border-as-line">
                                        <td className="py-2 text-[13px] text-zinc-900 dark:text-zinc-100 flex items-center space-x-2">
                                            {config.icon}
                                            <span>{getRepositoryDisplayName(repo)}</span>
                                        </td>
                                        <td className="py-2">
                                            {writesBlocked ? (
                                                <div
                                                    className="relative group inline-flex"
                                                    data-testid={`link-repo-blocked-wrapper-${repo.id}`}
                                                >
                                                    <div className="pointer-events-none">
                                                        <Button
                                                            variant="secondary"
                                                            disabled
                                                            onClick={() => {}}
                                                        >
                                                            {t(`pages.integration.${config.translationKey}.common.link`)}
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
                                                    onClick={() => handleLink(repo.id)}
                                                    loading={isLinkingRepository}
                                                    disabled={isLinkingRepository}
                                                >
                                                    {t(`pages.integration.${config.translationKey}.common.link`)}
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Modal>
        );
    };

    return (
        <div className="min-h-screen flex flex-col md:flex-row">
            {/* Left sidebar */}
            <div className="flex-shrink-0 bg-primary flex flex-col justify-between p-8 md:pl-20 md:pr-32 h-auto md:h-screen">
                <img src="/logo-white.webp" alt="Logo" className="w-44 md:w-96 mb-10" />
                <div className="space-y-8">
                    <div className="text-white space-y-6">
                        <h1 className="text-3xl md:text-5xl font-semibold leading-tight">
                            {t(`pages.integration.${config.translationKey}.linkExisting.title`)}
                        </h1>
                        <p className="text-xl opacity-90">
                            {t(`pages.integration.${config.translationKey}.linkExisting.subtitle`)}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 gap-6 mt-8 text-white/90">
                        <div className="flex items-center space-x-4">
                            <div className="h-8 w-8 flex-shrink-0 bg-secondary rounded-full"></div>
                            <div>
                                <h3 className="font-medium">{t(`pages.integration.${config.translationKey}.linkExisting.quickAssociation`)}</h3>
                                <p className="text-white/70">
                                    {t(`pages.integration.${config.translationKey}.linkExisting.quickDescription`)}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="text-white/60 text-sm mt-10">
                    {t(`pages.integration.${config.translationKey}.common.copyright`)}
                </div>
            </div>

            {/* Main content: align with create page styling (single scroll container, no overflow beyond sidebar) */}
            <div className="flex-1 p-4 sm:p-6 bg-as-bg md:h-screen md:overflow-y-auto flex flex-col">
                <div className="max-w-7xl w-full mx-auto space-y-6 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)] animate-fade-in">
                    <div className="text-center space-y-4">
                        <div className="w-12 h-12 flex items-center justify-center mx-auto [&_svg]:h-6 [&_svg]:w-6">
                            <ArrowRight className="h-6 w-6 text-secondary dark:text-secondary-light" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
                            {t(`pages.integration.${config.translationKey}.linkExisting.pageTitle`)}
                        </h1>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">
                            {t(`pages.integration.${config.translationKey}.linkExisting.pageSubtitle`)}
                        </p>
                    </div>

                    <div className="space-y-4">
                        {loading && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                {t(`pages.integration.${config.translationKey}.common.loadingProjects`)}
                            </p>
                        )}
                        {!loading && projects.length === 0 && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                {t(`pages.integration.${config.translationKey}.linkExisting.noProjects`)}
                            </p>
                        )}
                        {!loading && projects.length > 0 && (
                            <>
                                <div className="border border-zinc-200 dark:border-as-line rounded-xl overflow-hidden">
                                    <div className="max-h-96 overflow-y-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-zinc-50 dark:bg-[#16161a] sticky top-0 z-10">
                                                <tr>
                                                    <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                        {t(`pages.integration.${config.translationKey}.common.projectName`)}
                                                    </th>
                                                    <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                        {t(`pages.integration.${config.translationKey}.common.status`)}
                                                    </th>
                                                    <th className="h-9 border-b border-zinc-200 dark:border-as-line px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                        {t(`pages.integration.${config.translationKey}.common.action`)}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {projects.map((proj: any) => {
                                                    const linkingStatus = getProjectLinkingStatus(proj.projectId);
                                                    return (
                                                        <tr
                                                            key={proj.projectId}
                                                            className="border-b border-zinc-100 dark:border-as-line transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                                                        >
                                                            <td className="py-3 px-4 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{proj.name}</td>
                                                            <td className="py-3 px-4">
                                                                {linkingStatus.isLinked ? (
                                                                    <div className="flex items-center space-x-2">
                                                                        {linkingStatus.provider === 'github' ? <Github
                                                                            className={linkingStatus.provider === 'github' ? 'text-zinc-700 dark:text-zinc-300' : 'text-orange-500'} /> : <Gitlab
                                                                            className={linkingStatus.provider === 'github' ? 'text-zinc-700 dark:text-zinc-300' : 'text-orange-500'} />}
                                                                        <span className="text-green-700 dark:text-green-400 text-[13px]">
                                                                            {linkingStatus.repository?.fullName || linkingStatus.repository?.nameWithNamespace}
                                                                        </span>
                                                                        {linkingStatus.provider !== config.provider && (
                                                                            <span className="inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                                                                {t(`pages.integration.${linkingStatus.provider}.common.${linkingStatus.provider}`)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ) : linkingStatus.otherProviderLink?.isLinked ? (
                                                                    <div className="flex items-center space-x-2">
                                                                        {linkingStatus.otherProviderLink.provider === 'github' ? <Github
                                                                            className={linkingStatus.otherProviderLink.provider === 'github' ? 'text-zinc-700 dark:text-zinc-300' : 'text-orange-500'} /> : <Gitlab
                                                                            className={linkingStatus.otherProviderLink.provider === 'github' ? 'text-zinc-700 dark:text-zinc-300' : 'text-orange-500'} />}
                                                                        <span className="text-orange-700 dark:text-orange-400 text-[13px]">
                                                                            {linkingStatus.otherProviderLink.repositoryName}
                                                                        </span>
                                                                        <span className="inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                                                                            {t(`pages.integration.${linkingStatus.otherProviderLink.provider}.common.${linkingStatus.otherProviderLink.provider}`)}
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-zinc-500 dark:text-zinc-400 text-[13px]">
                                                                        {t(`pages.integration.${config.translationKey}.linkExisting.notLinked`)}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-4">
                                                                {linkingStatus.isLinked ? (
                                                                    <span className="text-zinc-500 dark:text-zinc-400">
                                                                        {linkingStatus.provider === config.provider
                                                                            ? t(`pages.integration.${config.translationKey}.linkExisting.alreadyLinked`)
                                                                            : t(`pages.integration.${config.translationKey}.linkExisting.linkedToOtherProvider`, { provider: linkingStatus.provider })
                                                                        }
                                                                    </span>
                                                                ) : linkingStatus.otherProviderLink?.isLinked ? (
                                                                    <span className="text-orange-700 dark:text-orange-400 text-[13px]">
                                                                        {t(`pages.integration.${config.translationKey}.linkExisting.linkedToOtherProvider`, {
                                                                            provider: linkingStatus.otherProviderLink.provider
                                                                        })}
                                                                    </span>
                                                                ) : writesBlocked ? (
                                                                    <div
                                                                        className="relative group inline-flex"
                                                                        data-testid={`select-project-blocked-wrapper-${proj.projectId}`}
                                                                    >
                                                                        <div className="pointer-events-none">
                                                                            <Button
                                                                                variant="secondary"
                                                                                disabled
                                                                                onClick={() => {}}
                                                                            >
                                                                                {t(`pages.integration.${config.translationKey}.common.select`)}
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
                                                                        onClick={() => handleSelectProject(proj.projectId)}
                                                                    >
                                                                        {t(`pages.integration.${config.translationKey}.common.select`)}
                                                                    </Button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    {projects.length > 10 && (
                                        <div className="px-4 py-2.5 text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-as-line">
                                            {t('common.projectsTotal', { count: projects.length })}
                                        </div>
                                    )}
                                </div>
                                <Pagination
                                    currentPage={currentPage}
                                    totalPages={totalPages}
                                    pageSize={pageSize}
                                    totalItems={totalProjects}
                                    onPageChange={goToPage}
                                    onPageSizeChange={(size) => {
                                        setPageSize(size);
                                    }}
                                />
                            </>
                        )}
                    </div>

                    <div className="space-y-4">
                        <BackButton
                            text={t(`pages.integration.${config.translationKey}.common.backToChoice`)}
                            to={config.backToPath}
                        />
                    </div>
                </div>
            </div>

            {showRepoModal && <RepoSelectionModal />}
        </div>
    );
};

export default ProjectIntegrationLinkExistingPage;
