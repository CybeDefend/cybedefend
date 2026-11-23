import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Bug, CheckCircle, ExclamationTriangle, ProjectDiagram, Users } from '@/components/atoms/icon/icons';
import { AS_KPI_LABEL, AS_KPI_NOTE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH } from '@/components/atoms/appsec/recipes';
import { cn } from '@/utils/function/utils';

interface OrganizationStatsCardsProps {
    totalProjects: number;
    totalTeams: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
    solvedIssues: number;
    newIssuesLast7Days: number;
    solvedIssuesLast7Days: number;
}

interface StatCardProps {
    icon: any;
    label: string;
    value: number | string;
    subValue?: string;
    trend?: "up" | "down" | null;
    trendValue?: number;
}

/**
 * Individual stat card, in the zinc kit's « figure first » reading: the mono
 * figure, its label, the delta; the icon a quiet
 * zinc glyph in the corner, no tinted tile. The delta's arrow carries the
 * colour (more issues is red), the figure stays ink.
 */
const StatCard: React.FC<StatCardProps> = ({
    icon,
    label,
    value,
    subValue,
    trend,
    trendValue,
}) => {
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-2xl font-medium leading-7 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50">
                    {typeof value === "number" ? value.toLocaleString() : value}
                </p>
                {React.createElement(icon, { className: cn(AS_GLYPH, 'mt-1') })}
            </div>
            <p className={cn(AS_KPI_LABEL, 'mt-1 truncate')}>
                {label}
            </p>
            {(subValue || (trend && trendValue !== undefined)) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {trend && trendValue !== undefined && (
                        <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                            {trend === "up" ? (
                                <ArrowUp className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                            ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                            )}
                            {trendValue}
                        </span>
                    )}
                    {subValue && (
                        <p className={cn(AS_KPI_NOTE, 'tabular-nums')}>{subValue}</p>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * OrganizationStatsCards - Displays key organization statistics in a grid of cards
 * Shows projects, teams, issues by severity, and trends
 */
const OrganizationStatsCards: React.FC<OrganizationStatsCardsProps> = ({
    totalProjects,
    totalTeams,
    criticalIssues,
    highIssues,
    mediumIssues,
    lowIssues,
    solvedIssues,
    newIssuesLast7Days,
    solvedIssuesLast7Days,
}) => {
    const { t } = useTranslation();

    const totalIssues = criticalIssues + highIssues + mediumIssues + lowIssues;

    return (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {/* Total Projects */}
            <StatCard
                icon={ProjectDiagram}
                label={t("pages.organizationOverview.stats.totalProjects")}
                value={totalProjects}
            />

            {/* Total Teams */}
            <StatCard
                icon={Users}
                label={t("pages.organizationOverview.stats.totalTeams")}
                value={totalTeams}
            />

            {/* Total Vulnerabilities */}
            <StatCard
                icon={Bug}
                label={t("pages.organizationOverview.stats.totalVulnerabilities")}
                value={totalIssues}
                trend={newIssuesLast7Days > solvedIssuesLast7Days ? "up" : "down"}
                trendValue={Math.abs(newIssuesLast7Days - solvedIssuesLast7Days)}
            />

            {/* Critical Issues */}
            <StatCard
                icon={ExclamationTriangle}
                label={t("pages.organizationOverview.stats.criticalIssues")}
                value={criticalIssues}
            />

            {/* Solved Issues */}
            <StatCard
                icon={CheckCircle}
                label={t("pages.organizationOverview.stats.solvedIssues")}
                value={solvedIssues}
                subValue={`+${solvedIssuesLast7Days} ${t("pages.organizationOverview.stats.last7Days")}`}
            />
        </div>
    );
};

export default OrganizationStatsCards;
