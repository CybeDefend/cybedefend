import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import Select from "../select/Select";
import RoleExplanationPopover from "../role-explanation-popover/RoleExplanationPopover";
import { getTeamRoles } from "../../../utils/data/roleData";

interface TeamRoleSelectorProps {
    teamId: string;
    teamName: string;
    selectedRole: string;
    onRoleChange: (teamId: string, role: string) => void;
    disabled?: boolean;
}

/**
 * TeamRoleSelector Component
 * 
 * Atomic component for selecting a team role in organization invitations.
 * Displays team name and provides a dropdown for role selection.
 * 
 * @param teamId - Unique identifier for the team
 * @param teamName - Display name of the team
 * @param selectedRole - Currently selected role for the team
 * @param onRoleChange - Callback when role selection changes
 * @param disabled - Whether the selector is disabled
 */
const TeamRoleSelector: React.FC<TeamRoleSelectorProps> = ({
    teamId,
    teamName,
    selectedRole,
    onRoleChange,
    disabled = false,
}) => {
    const { t } = useTranslation();
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Get team roles from centralized data source
    const teamRoleOptions = getTeamRoles();

    /**
     * Handles role selection change for this specific team
     */
    const handleRoleChange = (newRole: string) => {
        onRoleChange(teamId, newRole);
    };

    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-as-line dark:bg-white/[0.03]">
            {/* Team name display */}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                    {teamName}
                </p>
            </div>

            {/* Role selector */}
            <div className="ml-4 flex items-center gap-2">
                <div className="w-48">
                    <Select
                        value={selectedRole}
                        options={teamRoleOptions}
                        placeholder={t('components.modal.inviteMember.teamAssignments.selectRole')}
                        onChange={handleRoleChange}
                        width="w-full"
                        dropdownRef={dropdownRef}
                    />
                </div>
                <RoleExplanationPopover scope="team" role={selectedRole} />
            </div>
        </div>
    );
};

export default TeamRoleSelector;
