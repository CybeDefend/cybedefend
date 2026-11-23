import React from "react";

import { useTranslation } from "react-i18next";
import { TopVulnerableProject } from "../../../server/interfaces/Vulnerability";
import { useNavigate } from "react-router-dom";
import { projectPath } from "@/utils/product";
import { AlertTriangle, Bug, ChevronRight, FolderOpen } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import SeverityCount from '@/components/atoms/badge/SeverityCount';

interface TopVulnerableProjectsTableProps {
    projects: TopVulnerableProject[];
}


/**
 * TopVulnerableProjectsTable - Displays top projects with most vulnerabilities
 * Shows project name, total issues, and breakdown by severity
 */
const TopVulnerableProjectsTable: React.FC<TopVulnerableProjectsTableProps> = ({
    projects,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const handleProjectClick = (projectId: string) => {
        navigate(projectPath('appsec', projectId));
    };

    return (
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center">
                    <AlertTriangle
                        className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
                     />
                </div>
                <div>
                    <h3 className={AS_PANEL_TITLE}>
                        {t("pages.organizationOverview.topVulnerable.title")}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t("pages.organizationOverview.topVulnerable.subtitle")}
                    </p>
                </div>
            </div>

            {/* Table */}
            {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    {/* The empty-state glyph keeps its box and loses its disc. */}
                    <div className="mb-3 flex h-14 w-14 items-center justify-center">
                        <FolderOpen
                            className="h-5 w-5 text-zinc-400 dark:text-zinc-500"
                         />
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {t("pages.organizationOverview.topVulnerable.noProjects")}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {projects.map((project, index) => (
                        <div
                            key={project.projectId}
                            onClick={() => handleProjectClick(project.projectId)}
                            // A zinc hover, not a violet tint: the accent marks a state, never a hover.
                            className="group flex cursor-pointer items-center justify-between rounded-lg bg-zinc-50 p-3 transition-colors duration-[120ms] hover:bg-zinc-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                        >
                            <div className="flex items-center gap-3">
                                {/* Rank */}
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white font-mono text-sm font-medium tabular-nums text-zinc-600 dark:bg-as-raised dark:text-zinc-300">
                                    {index + 1}
                                </div>

                                {/* Project info */}
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Bug
                                            className="h-4 w-4 text-zinc-400 dark:text-zinc-500"
                                         />
                                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                            {project.projectName}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                        {project.criticalCount > 0 && (
                                            <SeverityCount
                                                severity="critical"
                                                count={project.criticalCount}
                                                label={t("components.issueBadges.critical")}
                                                title={`${project.criticalCount} ${t("common.severity.critical")}`}
                                                aria-label={`${project.criticalCount} ${t("common.severity.critical")}`}
                                            />
                                        )}
                                        {project.highCount > 0 && (
                                            <SeverityCount
                                                severity="high"
                                                count={project.highCount}
                                                label={t("components.issueBadges.high")}
                                                title={`${project.highCount} ${t("common.severity.high")}`}
                                                aria-label={`${project.highCount} ${t("common.severity.high")}`}
                                            />
                                        )}
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                            {project.teamName}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* Total count */}
                                <div className="text-right">
                                    <span className="font-mono text-base font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                                        {project.vulnerabilityCount}
                                    </span>
                                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                                        {t("pages.organizationOverview.topVulnerable.issues")}
                                    </span>
                                </div>

                                <ChevronRight
                                    className="h-4.5 w-4.5 text-zinc-400 transition-colors duration-[120ms] group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-200"
                                 />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TopVulnerableProjectsTable;
