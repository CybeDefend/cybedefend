import { MainStatisticsResponse } from '@grpc/global-management/project';
import { GetMainStatisticsResponse } from '@grpc/analysis-reporting/result';

/** The home KPI cards of an organization whose statistics cannot be read. */
export const EMPTY_MAIN_STATISTICS: MainStatisticsResponse = {
  criticalRiskProjects: 0,
  criticalRiskProjectsInLast7Days: 0,
  highRiskProjects: 0,
  highRiskProjectsInLast7Days: 0,
  solvedIssues: 0,
  solvedIssuesInLast7Days: 0,
  newIssues: 0,
  newIssuesInLast7Days: 0,
  criticalIssues: 0,
  highIssues: 0,
  mediumIssues: 0,
  lowIssues: 0,
  agentAnalysesCount: 0,
  agentAutofixCount: 0,
  agentTriageCount: 0,
  agentFalsePositiveCount: 0,
};

/**
 * analysis-reporting's persisted organization statistics, as the KPI cards
 * the route returns: the same projection global-management applied when it
 * relayed them. The row's `projectIds` are not returned.
 */
export function toMainStatisticsResponse(
  s: GetMainStatisticsResponse,
): MainStatisticsResponse {
  return {
    criticalRiskProjects: s.criticalRiskProjects ?? 0,
    criticalRiskProjectsInLast7Days: s.criticalRiskProjectsInLast7Days ?? 0,
    highRiskProjects: s.highRiskProjects ?? 0,
    highRiskProjectsInLast7Days: s.highRiskProjectsInLast7Days ?? 0,
    solvedIssues: s.solvedIssues ?? 0,
    solvedIssuesInLast7Days: s.solvedIssuesInLast7Days ?? 0,
    newIssues: s.newIssues ?? 0,
    newIssuesInLast7Days: s.newIssuesInLast7Days ?? 0,
    criticalIssues: s.criticalIssues ?? 0,
    highIssues: s.highIssues ?? 0,
    mediumIssues: s.mediumIssues ?? 0,
    lowIssues: s.lowIssues ?? 0,
    agentAnalysesCount: s.agentAnalysesCount ?? 0,
    agentAutofixCount: s.agentAutofixCount ?? 0,
    agentTriageCount: s.agentTriageCount ?? 0,
    agentFalsePositiveCount: s.agentFalsePositiveCount ?? 0,
  };
}
