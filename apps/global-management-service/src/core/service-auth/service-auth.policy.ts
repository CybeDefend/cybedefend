import type { ServiceAuthPolicy } from './service-auth';

const GM = 'cybedefend.global_management';

/**
 * global-management's own rules, closed by default. The user, team, project,
 * organisation and sign-in services answer the gateway only: it is the one
 * caller that authenticated the acting user, and every method that grants
 * credentials, sessions or roles, or creates or deletes an organisation, a
 * team or a project, stays with it. The few methods other services call are
 * listed one by one, each with the callers that use it.
 */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'global-management',
  services: {
    [`${GM}.LocalAuthService`]: ['gateway'],
    [`${GM}.UserService`]: ['gateway'],
    [`${GM}.TeamService`]: ['gateway'],
    [`${GM}.ProjectService`]: ['gateway'],
    [`${GM}.OrganizationService`]: ['gateway'],
    // Scan and report mails.
    [`${GM}.MailReportService`]: ['analysis-reporting'],
  },
  methods: {
    [`/${GM}.ProjectService/Get`]: [
      'gateway',
      'analysis-reporting',
      'security-scanning',
      'external-integrations',
      'policy-management',
    ],
    [`/${GM}.ProjectService/GetAllFromOrganization`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/GetAllFromTeam`]: ['gateway', 'analysis-reporting'],
    [`/${GM}.ProjectService/GetAllProjects`]: ['gateway', 'analysis-reporting'],
    [`/${GM}.ProjectService/GetArchivedBranches`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/GetProjectBranches`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/GetProjectSecurityContext`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/GetReadableProjectsInOrganization`]: [
      'gateway',
      'analysis-reporting',
      'policy-management',
    ],
    [`/${GM}.ProjectService/GetOrganizationProjectIds`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/SetProjectCyberRiskScores`]: [
      'gateway',
      'analysis-reporting',
    ],
    [`/${GM}.ProjectService/Update`]: ['gateway', 'security-scanning'],
    [`/${GM}.ProjectService/MarkProjectAppsec`]: [
      'gateway',
      'security-scanning',
    ],
    [`/${GM}.ProjectService/ValidateProjectsInOrganization`]: [
      'gateway',
      'policy-management',
    ],
    [`/${GM}.OrganizationService/Get`]: [
      'gateway',
      'analysis-reporting',
      'security-scanning',
      'external-integrations',
    ],
    [`/${GM}.OrganizationService/GetOrganizationIdByProjectId`]: [
      'gateway',
      'analysis-reporting',
      'policy-management',
    ],
    [`/${GM}.TeamService/getTeam`]: ['gateway', 'analysis-reporting'],
    [`/${GM}.TeamService/validateTeamsInOrganization`]: [
      'gateway',
      'policy-management',
    ],
    [`/${GM}.UserService/GetById`]: ['gateway', 'analysis-reporting'],
  },
  scannerMethods: [],
};
