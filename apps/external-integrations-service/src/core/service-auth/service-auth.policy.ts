import type { ServiceAuthPolicy } from './service-auth';

const EI = 'cybedefend.external_integrations';

/** external-integrations' own rules, closed by default: each gRPC service answers the callers listed for it. */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'external-integrations',
  services: {
    [`${EI}.GithubService`]: ['gateway'],
    [`${EI}.GitlabService`]: ['gateway'],
    // Notifications and issue trackers, used by the scan results too.
    [`${EI}.SlackService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.JiraService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.LinearService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.GithubIssueService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.GitlabIssueService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.JiraIssueService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.LinearIssueService`]: ['gateway', 'analysis-reporting'],
    [`${EI}.ProjectIntegrationStatusService`]: [
      'gateway',
      'global-management',
      'security-scanning',
    ],
    // The data purge runner.
    [`${EI}.DataPurgeService`]: ['global-management'],
  },
  methods: {},
  scannerMethods: [],
};
