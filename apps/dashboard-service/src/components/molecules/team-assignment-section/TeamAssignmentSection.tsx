import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Users } from '@/components/atoms/icon/icons';
import useOrganizationTeams from "../../../server/hooks/useOrganizationTeams";
import { TeamSelectionState } from "../../../server/interfaces/Organization";
import TeamRoleSelector from "../../atoms/team-role-selector/TeamRoleSelector";
import Checkbox from "../../atoms/checkbox/Checkbox";
import LoaderIcon from "../../atoms/loader/LoaderIcon";

import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
interface TeamAssignmentSectionProps {
    organizationId: string;
    selectedTeams: TeamSelectionState[];
    onTeamSelectionChange: (teams: TeamSelectionState[]) => void;
    error?: string;
}

/**
 * TeamAssignmentSection Component
 * 
 * Molecule component for managing team assignments in organization invitations.
 * Allows selection of multiple teams with specific roles for each team.
 * Handles loading states, error states, and empty states.
 * 
 * @param organizationId - ID of the organization to fetch teams from
 * @param selectedTeams - Array of currently selected teams with roles
 * @param onTeamSelectionChange - Callback when team selection changes
 * @param error - External validation error message
 */
const TeamAssignmentSection: React.FC<TeamAssignmentSectionProps> = ({
    organizationId,
    selectedTeams,
    onTeamSelectionChange,
    error,
}) => {
    const { t } = useTranslation();
    const { teams, loading, error: teamsError, refresh } = useOrganizationTeams(organizationId);

    /**
     * Handles team selection toggle (checkbox change)
     */
    const handleTeamToggle = (teamId: string, teamName: string) => {
        const isCurrentlySelected = selectedTeams.some(team => team.teamId === teamId);

        if (isCurrentlySelected) {
            // Remove team from selection
            const updatedTeams = selectedTeams.filter(team => team.teamId !== teamId);
            onTeamSelectionChange(updatedTeams);
        } else {
            // Add team to selection with empty role
            const newTeamSelection: TeamSelectionState = {
                teamId,
                teamName,
                selectedRole: '',
            };
            onTeamSelectionChange([...selectedTeams, newTeamSelection]);
        }
    };

    /**
     * Handles role change for a specific team
     */
    const handleRoleChange = (teamId: string, role: string) => {
        const updatedTeams = selectedTeams.map(team =>
            team.teamId === teamId
                ? { ...team, selectedRole: role }
                : team
        );
        onTeamSelectionChange(updatedTeams);
    };

    /**
     * Checks if a team is currently selected
     */
    const isTeamSelected = (teamId: string): boolean => {
        return selectedTeams.some(team => team.teamId === teamId);
    };

    /**
     * Gets the selected teams that need role assignment
     */
    const getSelectedTeamsWithRoles = () => {
        return selectedTeams.filter(team => isTeamSelected(team.teamId));
    };

    // Loading state
    if (loading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                    <h3 className={AS_PANEL_TITLE}>
                        {t('components.modal.inviteMember.teamAssignments.title')}
                    </h3>
                </div>
                <div className="flex items-center justify-center py-8">
                    <LoaderIcon />
                    <span className="ml-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                        {t('common.loading')}
                    </span>
                </div>
            </div>
        );
    }

    // Error state
    if (teamsError) {
        return (
            <div className="space-y-4">
                <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                    <h3 className={AS_PANEL_TITLE}>
                        {t('components.modal.inviteMember.teamAssignments.title')}
                    </h3>
                </div>
                <div className="text-center py-8">
                    <p className="text-[13px] text-red-600 dark:text-red-400 mb-4">
                        {teamsError}
                    </p>
                    <button
                        onClick={refresh}
                        className="text-[13px] text-secondary hover:underline dark:text-secondary-light"
                    >
                        {t('common.retry')}
                    </button>
                </div>
            </div>
        );
    }

    // Empty state
    if (!teams || teams.length === 0) {
        return (
            <div className="space-y-4">
                <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                    <h3 className={AS_PANEL_TITLE}>
                        {t('components.modal.inviteMember.teamAssignments.title')}
                    </h3>
                </div>
                <div className="text-center py-8">
                    <Users className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        {t('components.modal.inviteMember.teamAssignments.noTeams')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                <h3 className={AS_PANEL_TITLE}>
                    {t('components.modal.inviteMember.teamAssignments.title')}
                </h3>
            </div>

            {/* Section Description */}
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                {t('components.modal.inviteMember.teamAssignments.description')}
            </p>

            {/* Teams Selection */}
            <div className="space-y-3">
                {teams.map((team) => (
                    <div key={team.id} className="space-y-2">
                        {/* Team Selection Checkbox */}
                        <div className="flex items-center space-x-3">
                            <Checkbox
                                id={`team-${team.id}`}
                                name={`team-${team.id}`}
                                value={team.id}
                                checked={isTeamSelected(team.id)}
                                onChange={() => handleTeamToggle(team.id, team.name)}
                                label={team.name}
                            />
                            {team.description && (
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-2">
                                    {team.description}
                                </span>
                            )}
                        </div>

                        {/* Role Selector for Selected Team */}
                        {isTeamSelected(team.id) && (
                            <div className="ml-6">
                                <TeamRoleSelector
                                    teamId={team.id}
                                    teamName={team.name}
                                    selectedRole={
                                        selectedTeams.find(t => t.teamId === team.id)?.selectedRole || ''
                                    }
                                    onRoleChange={handleRoleChange}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Validation Error */}
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                    {error}
                </p>
            )}
        </div>
    );
};

export default TeamAssignmentSection;
