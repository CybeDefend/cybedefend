import React from "react";

import { useTranslation } from "react-i18next";
import { TeamOverviewSummary } from "../../../server/interfaces/Vulnerability";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FolderOpen, ShieldAlt, Users } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH } from '@/components/atoms/appsec/recipes';

interface TeamsSummaryTableProps {
    teams: TeamOverviewSummary[];
}

/**
 * Get color based on vulnerability count
 */
/**
 * The health of a team, carried by its figure (no dot):
 * green when nothing is open, amber under ten, red from ten. Text shades that
 * hold 4.5:1 on the row's zinc-100 hover (red-700 5.9:1, amber-700 4.6:1).
 */
const getHealthTone = (count: number): string => {
    if (count === 0) return "text-emerald-700 dark:text-emerald-400";
    if (count < 10) return "text-amber-700 dark:text-amber-400";
    return "text-red-700 dark:text-red-400";
};

/**
 * TeamsSummaryTable - Displays summary of all teams with their vulnerability counts
 * Shows team name, project count, and vulnerability stats
 */
const TeamsSummaryTable: React.FC<TeamsSummaryTableProps> = ({ teams }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const handleTeamClick = (teamId: string) => {
        navigate(`/setting/team/${teamId}`);
    };

    // Sort teams by vulnerability count descending
    const sortedTeams = [...teams].sort(
        (a, b) => b.totalVulnerabilities - a.totalVulnerabilities
    );

    return (
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
                {/* The title glyph keeps its box and loses its tinted tile. */}
                <div className="flex h-9 w-9 items-center justify-center">
                    <Users className={AS_GLYPH} />
                </div>
                <div>
                    <h3 className={AS_PANEL_TITLE}>
                        {t("pages.organizationOverview.teamsSummary.title")}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {teams.length} {t("pages.organizationOverview.teamsSummary.teams", { count: teams.length })}
                    </p>
                </div>
            </div>

            {/* Teams list */}
            {teams.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    {/* The empty-state glyph keeps its box and loses its disc. */}
                    <div className="mb-3 flex h-14 w-14 items-center justify-center">
                        <FolderOpen
                            className="h-5 w-5 text-zinc-400 dark:text-zinc-500"
                         />
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {t("pages.organizationOverview.teamsSummary.noTeams")}
                    </p>
                </div>
            ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                    {sortedTeams.map((team) => {
                        const healthTone = getHealthTone(team.totalVulnerabilities);

                        return (
                            <div
                                key={team.teamId}
                                onClick={() => handleTeamClick(team.teamId)}
                                // A zinc hover, not a violet tint: the accent marks a state, never a hover.
                                className="group flex cursor-pointer items-center justify-between rounded-lg bg-zinc-50 p-3 transition-colors duration-[120ms] hover:bg-zinc-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                            >
                                <div className="flex items-center gap-3">
                                    {/* Team info */}
                                    <div>
                                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                            {team.teamName}
                                        </span>
                                        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                            <span className="flex items-center gap-1">
                                                <FolderOpen className="h-4.5 w-4.5"  />
                                                {team.projectCount} {t("pages.organizationOverview.teamsSummary.projects")}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Stats */}
                                    <div className="flex items-center gap-2">
                                        {/* The figure in mono, written in the team's health colour. */}
                                        <div className="flex items-center gap-1 text-right">
                                            <ShieldAlt
                                                className="h-4 w-4 text-zinc-400 dark:text-zinc-500"
                                             />
                                            <span className={`font-mono text-sm font-medium tabular-nums ${healthTone}`}>
                                                {team.totalVulnerabilities}
                                            </span>
                                        </div>
                                    </div>

                                    <ChevronRight
                                        className="h-4.5 w-4.5 text-zinc-400 transition-colors duration-[120ms] group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-200"
                                     />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TeamsSummaryTable;
