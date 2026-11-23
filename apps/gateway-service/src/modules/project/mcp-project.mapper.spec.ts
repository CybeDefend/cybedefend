import { toSlimProject, toSlimProjectList } from './mcp-project.mapper';

const fullProject = {
  projectId: 'p1',
  teamId: 't1',
  teamName: 'Backend',
  name: 'api-microservices',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  cyberRiskScore: 5801,
  cyberRiskLevel: 'critical',
  issuesCount: { critical: 4, high: 10, medium: 29, low: 0 },
  analyses: [
    { type: 'SAST', lastScan: 'x', source: 'cli', issuesCount: {} },
    { type: 'SCA', lastScan: 'y', source: 'cli', issuesCount: {} },
  ],
  ingestionProjectId: 'ing1',
  isGithubLinked: true,
  isGitlabLinked: false,
  isJiraLinked: false,
  lastScan: '2026-06-04T00:00:00.000Z',
  referenceBranch: 'main',
  parsedBranches: [{ branch: 'main' }],
} as never;

describe('mcp-project.mapper', () => {
  describe('toSlimProject', () => {
    it('keeps only the discovery fields', () => {
      expect(toSlimProject(fullProject)).toEqual({
        projectId: 'p1',
        name: 'api-microservices',
        teamName: 'Backend',
        cyberRiskLevel: 'critical',
        cyberRiskScore: 5801,
        issuesCount: { critical: 4, high: 10, medium: 29, low: 0 },
      });
    });

    it('drops the heavy / irrelevant fields', () => {
      const slim = toSlimProject(fullProject);
      expect(slim).not.toHaveProperty('analyses');
      expect(slim).not.toHaveProperty('ingestionProjectId');
      expect(slim).not.toHaveProperty('isGithubLinked');
      expect(slim).not.toHaveProperty('parsedBranches');
      expect(slim).not.toHaveProperty('createdAt');
    });
  });

  describe('toSlimProjectList', () => {
    it('maps projects and drops mainStatistics', () => {
      const res = toSlimProjectList({
        projects: [fullProject],
        totalProjects: 1,
        totalPages: 1,
        mainStatistics: { riskProjectsCritical: 1 },
      } as never);

      expect(res).toEqual({
        projects: [
          {
            projectId: 'p1',
            name: 'api-microservices',
            teamName: 'Backend',
            cyberRiskLevel: 'critical',
            cyberRiskScore: 5801,
            issuesCount: { critical: 4, high: 10, medium: 29, low: 0 },
          },
        ],
        totalProjects: 1,
        totalPages: 1,
      });
      expect(res).not.toHaveProperty('mainStatistics');
    });
  });
});
