import { describe, expect, it } from 'vitest';
import { rankProjectsAtRisk } from './rankProjectsAtRisk';

// The ranked list merges two parts of the overview payload, as the gateway
// relays them from analysis-reporting (result.proto): the server's top
// vulnerable projects (ranked over EVERY project, each with its CybeRisk
// level) and the first page of projectsSummary (CybeRisk level and the week's
// moves). The level is `cyberRiskLevel`: `risk_level` is
// reserved, and the payload carries no `projectStats`.

const top = (id: string, count: number, critical = 1, high = 2, cyberRiskLevel?: string) => ({
  projectId: id,
  projectName: `Project ${id}`,
  teamName: 'Core',
  vulnerabilityCount: count,
  criticalCount: critical,
  highCount: high,
  ...(cyberRiskLevel ? { cyberRiskLevel } : {}),
});

describe('rankProjectsAtRisk', () => {
  it('ranks by open findings and enriches each project with its risk level and its seven-day move', () => {
    const rows = rankProjectsAtRisk({
      topVulnerableProjects: [top('b', 40), top('a', 77), top('c', 12)],
      projectsSummary: [
        { projectId: 'a', projectName: 'Project a', teamId: 't', teamName: 'Core', cyberRiskLevel: 'CRITICAL', criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 4, totalVulnerabilities: 77, newLast7Days: 5, resolvedLast7Days: 8 },
        // A zero is left out of the JSON: no 7-day field is a move of 0.
        { projectId: 'b', projectName: 'Project b', teamId: 't', teamName: 'Core', cyberRiskLevel: 'low', criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 4, totalVulnerabilities: 40 },
      ],
    });

    expect(rows.map((r) => [r.projectId, r.open, r.risk, r.delta7])).toEqual([
      ['a', 77, 'critical', -3],
      ['b', 40, 'low', 0],
      ['c', 12, null, null],
    ]);
  });

  it('takes the level from the top entry itself, so a project beyond the summary page is rated too', () => {
    const rows = rankProjectsAtRisk({
      topVulnerableProjects: [top('a', 30, 4, 2, 'critical'), top('z', 9, 0, 1, 'medium')],
      projectsSummary: [
        { projectId: 'a', projectName: 'Project a', teamId: 't', teamName: 'Core', cyberRiskLevel: 'critical', criticalCount: 4, highCount: 2, mediumCount: 0, lowCount: 0, totalVulnerabilities: 30, newLast7Days: 2 },
      ],
    });

    expect(rows.map((r) => [r.projectId, r.risk, r.delta7])).toEqual([
      ['a', 'critical', 2],
      ['z', 'medium', null],
    ]);
  });

  it('keeps the first five only', () => {
    const rows = rankProjectsAtRisk({
      topVulnerableProjects: [1, 2, 3, 4, 5, 6, 7].map((i) => top(String(i), 100 - i)),
      projectsSummary: [],
    });
    expect(rows).toHaveLength(5);
    expect(rows[0].projectId).toBe('1');
  });

  it('reads an unknown risk word as « none » when the summary carries the project, and leaves it null otherwise', () => {
    const rows = rankProjectsAtRisk({
      topVulnerableProjects: [top('a', 3)],
      projectsSummary: [
        { projectId: 'a', projectName: 'Project a', teamId: 't', teamName: 'Core', cyberRiskLevel: 'mystery', criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 3, totalVulnerabilities: 3 },
      ],
    });
    expect(rows[0].risk).toBe('none');
    expect(rankProjectsAtRisk({ topVulnerableProjects: [top('z', 1)] })[0].risk).toBeNull();
  });
});
