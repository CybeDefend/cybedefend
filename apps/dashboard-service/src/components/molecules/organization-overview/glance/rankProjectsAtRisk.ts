import type { GetOrganizationOverviewResponse } from '@/server/interfaces/Vulnerability';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface ProjectAtRisk {
  projectId: string;
  name: string;
  team: string;
  /** The project's risk level; null when the payload's project page does not carry this project. */
  risk: RiskLevel | null;
  open: number;
  critical: number;
  high: number;
  /** New minus resolved over seven days; null when the summary page does not carry this project. */
  delta7: number | null;
}

const RISK_LEVELS: readonly RiskLevel[] = ['critical', 'high', 'medium', 'low', 'none'];

const asRisk = (value: string | undefined): RiskLevel | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (RISK_LEVELS as readonly string[]).includes(lower) ? (lower as RiskLevel) : null;
};

type Source = Partial<Pick<GetOrganizationOverviewResponse, 'topVulnerableProjects' | 'projectsSummary'>>;

/**
 * One ranked list in place of two blocks (« Projects at risk », « Most
 * vulnerable projects »): the server's top vulnerable projects,
 * ranked over EVERY project of the organisation. Each one carries its own
 * CybeRisk level (`cyberRiskLevel`: `risk_level` is reserved);
 * the first page of `projectsSummary` adds the seven days' moves. A project
 * beyond that page keeps its rank, its counts and its level, and reads « — »
 * for the move. The payload has no `projectStats`.
 */
export function rankProjectsAtRisk(source: Source, limit = 5): ProjectAtRisk[] {
  const summary = new Map((source.projectsSummary ?? []).map((p) => [p.projectId, p]));

  return [...(source.topVulnerableProjects ?? [])]
    .sort((a, b) => b.vulnerabilityCount - a.vulnerabilityCount)
    .slice(0, limit)
    .map((project) => {
      const s = summary.get(project.projectId);
      return {
        projectId: project.projectId,
        name: project.projectName,
        team: project.teamName,
        risk: asRisk(project.cyberRiskLevel) ?? (s ? asRisk(s.cyberRiskLevel) ?? 'none' : null),
        open: project.vulnerabilityCount,
        critical: project.criticalCount,
        high: project.highCount,
        // A zero is left out of the JSON: a missing count is a move of 0.
        delta7: s ? (s.newLast7Days ?? 0) - (s.resolvedLast7Days ?? 0) : null,
      };
    });
}
