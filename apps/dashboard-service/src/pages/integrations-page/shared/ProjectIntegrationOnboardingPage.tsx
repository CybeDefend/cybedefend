import React, { useMemo } from "react";
import { useSelector } from "react-redux";
import { ArrowRight, Home, Link2, Plus, ChevronLeft } from '@/components/atoms/icon/icons';
import Button from "@/components/atoms/button/Button";
import useOrganizationProjects from "@/server/hooks/useOrganizationProjects";
import { RootState } from "@/server/store";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LinkDiv } from "@/components/atoms/link";
import { IntegrationPageConfig, IntegrationHook } from "@/server/interfaces/IntegrationProvider";
import BackButton from "@/components/atoms/button/BackButton";
import { useEditionEntitlements } from "@/edition/entitlements";
import { projectIntegrationPath } from "./integrationPaths";

import { AS_TOOLTIP, AS_PANEL, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { useStoredTheme } from '@/utils/theme/useDocumentTheme';
interface ProjectIntegrationOnboardingPageProps {
    config: IntegrationPageConfig;
    useIntegrationHook: (organizationId: string) => IntegrationHook;
}

export const ProjectIntegrationOnboardingPage: React.FC<ProjectIntegrationOnboardingPageProps> = ({ config, useIntegrationHook }) => {
    const { t } = useTranslation();
    // No Layout, so no rail: nothing else puts the remembered theme on <html>
    // here, and a direct load (the return from the app install) drew the page
    // light in dark mode.
    useStoredTheme();
    const organization = useSelector((state: RootState) => state.organization);
    const selectedOrganization = organization.selectedOrganization;
    const writesBlocked = useEditionEntitlements().writesBlocked;
    const organizationId = selectedOrganization?.id || "";

    const pageSize = 10;
    const searchQuery = "";
    const {
        projects,
        loading,
        totalProjects,
    } = useOrganizationProjects(organizationId, pageSize, searchQuery);

    const {
        repositories,
        isLoadingRepositories: loadingRepos,
    } = useIntegrationHook(organizationId);

    // The projects linked to no provider. Each project of the list says it
    // itself (isGithubLinked / isGitlabLinked): the other provider's
    // repositories were fetched only to learn it again. The list holds the
    // first page only, so with more projects than the page the card is
    // offered on the total, and the count, unknown, is not shown
    //.
    const { showLinkCard, availableProjectsCount } = useMemo(() => {
        if (loading || !projects) return { showLinkCard: false, availableProjectsCount: null };
        const unlinkedOnPage = projects.filter(
            (project) => !project.isGithubLinked && !project.isGitlabLinked,
        ).length;
        const wholeListOnPage = totalProjects <= projects.length;
        return {
            showLinkCard: unlinkedOnPage > 0 || !wholeListOnPage,
            availableProjectsCount: wholeListOnPage ? unlinkedOnPage : null,
        };
    }, [projects, totalProjects, loading]);

    return (
        <div className="min-h-screen flex flex-col md:flex-row">
            {/* Left Panel */}
            <div className="flex-shrink-0 bg-primary flex flex-col justify-between p-8 md:pl-8 md:pr-8 md:w-1/4 h-auto md:h-screen">
                <img
                    src="/logo-white.webp"
                    alt="Logo"
                    className="w-44 md:w-96 mb-10"
                />
                <div className="space-y-8">
                    <div className="text-white space-y-6">
                        <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
                            {t(`pages.integration.${config.translationKey}.onboarding.title`)}
                        </h1>
                        <p className="text-xl opacity-90">
                            {t(`pages.integration.${config.translationKey}.onboarding.subtitle`)}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 gap-6 mt-8 text-white/90">
                        <div className="flex items-center space-x-4">
                            <div>
                                <h3 className="font-medium">{t(`pages.integration.${config.translationKey}.onboarding.option1Title`)}</h3>
                                <p className="text-white/70">
                                    {t(`pages.integration.${config.translationKey}.onboarding.option1Description`)}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <div>
                                <h3 className="font-medium">{t(`pages.integration.${config.translationKey}.onboarding.option2Title`)}</h3>
                                <p className="text-white/70">
                                    {t(`pages.integration.${config.translationKey}.onboarding.option2Description`)}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="text-white/60 text-sm mt-10">
                    {t(`pages.integration.${config.translationKey}.common.copyright`)}
                </div>
            </div>

            {/* Right Panel */}
            <div className="flex-1 flex items-center justify-center p-4 sm:p-6 bg-as-bg">
                <div className={cn(AS_PANEL, "max-w-2xl w-full space-y-6 p-5 sm:p-8 animate-fade-in")}>
                    <div className="text-center space-y-4">
                        <div className="w-14 h-14 flex items-center justify-center mx-auto">
                            {config.icon && <div className="text-2xl">{config.icon}</div>}
                        </div>
                        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
                            {t(`pages.integration.${config.translationKey}.onboarding.integrationTitle`)}
                        </h1>
                        <p className="text-zinc-600 dark:text-zinc-300 text-base">
                            {t(`pages.integration.${config.translationKey}.onboarding.chooseOption`)}
                        </p>
                    </div>

                    <div className="grid gap-3">
                        {/* Link existing projects option - only show if projects exist */}
                        {showLinkCard && (() => {
                            const linkCardContent = (
                                <div className="flex items-center space-x-4">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
                                        <Link2 className="h-[18px] w-[18px]" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-[15px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-0.5">
                                            {t(`pages.integration.${config.translationKey}.onboarding.linkExisting`)}
                                        </h3>
                                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                                            {t(`pages.integration.${config.translationKey}.onboarding.option1Description`)}
                                        </p>
                                        {availableProjectsCount !== null && (
                                        <p className="text-zinc-700 dark:text-zinc-300 text-[13px] mt-1.5 font-medium">
                                            {t(`pages.integration.${config.translationKey}.onboarding.projectsAvailable`, { count: availableProjectsCount })}
                                        </p>
                                        )}
                                    </div>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition-colors duration-[120ms] group-hover:text-secondary dark:text-zinc-500 dark:group-hover:text-secondary-light" />
                                </div>
                            );
                            return writesBlocked ? (
                                <div
                                    className="relative group inline-flex w-full"
                                    data-testid="onboarding-link-blocked-wrapper"
                                >
                                    <div className="pointer-events-none w-full rounded-2xl border border-zinc-200 bg-white p-5 opacity-60 dark:border-as-line dark:bg-as-surface">
                                        {linkCardContent}
                                    </div>
                                    <div
                                        role="tooltip"
                                        className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 z-10 hidden group-hover:block")}
                                    >
                                        {t('billing.read_only_integration_disabled')}
                                    </div>
                                </div>
                            ) : (
                                <LinkDiv
                                    to={projectIntegrationPath(config.provider, "link")}
                                    className="group cursor-pointer block rounded-2xl border border-zinc-200 bg-white p-5 transition-colors duration-[120ms] hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:border-as-line dark:bg-as-surface dark:hover:border-white/[0.14] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]"
                                >
                                    {linkCardContent}
                                </LinkDiv>
                            );
                        })()}

                        {/* Create new projects option */}
                        {(() => {
                            const createCardContent = (
                                <div className="flex items-center space-x-4">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
                                        <Plus className="h-[18px] w-[18px]" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-[15px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-0.5">
                                            {t(`pages.integration.${config.translationKey}.onboarding.addProject`)}
                                        </h3>
                                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                                            {t(`pages.integration.${config.translationKey}.onboarding.option2Description`)}
                                        </p>
                                        {!loadingRepos && repositories.length > 0 && (
                                            <p className="text-zinc-700 dark:text-zinc-300 text-[13px] mt-1.5 font-medium">
                                                {t(`pages.integration.${config.translationKey}.onboarding.repositoriesAvailable`, { count: repositories.length })}
                                            </p>
                                        )}
                                    </div>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition-colors duration-[120ms] group-hover:text-secondary dark:text-zinc-500 dark:group-hover:text-secondary-light" />
                                </div>
                            );
                            return writesBlocked ? (
                                <div
                                    className="relative group inline-flex w-full"
                                    data-testid="onboarding-create-blocked-wrapper"
                                >
                                    <div className="pointer-events-none w-full rounded-2xl border border-zinc-200 bg-white p-5 opacity-60 dark:border-as-line dark:bg-as-surface">
                                        {createCardContent}
                                    </div>
                                    <div
                                        role="tooltip"
                                        className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 z-10 hidden group-hover:block")}
                                    >
                                        {t('billing.read_only_integration_disabled')}
                                    </div>
                                </div>
                            ) : (
                                <LinkDiv
                                    to={projectIntegrationPath(config.provider, "create")}
                                    className="group cursor-pointer block rounded-2xl border border-zinc-200 bg-white p-5 transition-colors duration-[120ms] hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:border-as-line dark:bg-as-surface dark:hover:border-white/[0.14] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]"
                                >
                                    {createCardContent}
                                </LinkDiv>
                            );
                        })()}
                    </div>

                    {/* Back button */}
                    <div className="flex justify-center pt-5 border-t border-zinc-200 dark:border-as-line">
                        <Link
                            to={config.backToPath}
                            className={cn("relative inline-flex h-8 items-center space-x-1.5 rounded-lg px-2.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 transition-colors duration-[120ms] group", AS_FOCUS, AS_TOUCH)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            <span className="text-[13px] font-medium">{t(`pages.integration.${config.translationKey}.common.backToHome`)}</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectIntegrationOnboardingPage;
