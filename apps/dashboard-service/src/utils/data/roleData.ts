import { t } from "i18next";

export const getOrganizationRoles = () => [
    { value: "administrator", label: t('roles.administrator') },
    { value: "manager", label: t('roles.manager') },
    { value: "billing_manager", label: t('roles.billingManager') },
    { value: "member", label: t('roles.member') },
  ];

export const getTeamRoles = () => [
    { value: "team_manager", label: t('roles.teamManager') },
    { value: "analyst_developer", label: t('roles.analystDeveloper') },
    { value: "developer", label: t('roles.developer') },
    { value: "read_only", label: t('roles.readOnly') },
  ];

// Backward compatibility - deprecated, use the getter functions instead
export const organizationRoles = getOrganizationRoles();
export const teamRoles = getTeamRoles();