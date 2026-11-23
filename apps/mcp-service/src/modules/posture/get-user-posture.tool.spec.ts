import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetUserPostureTool } from './get-user-posture.tool';

function makeGatewayStub(overviewPayload: unknown = {}) {
  const getOrganizationOverview = jest.fn(async () => overviewPayload);
  const gateway = {
    getOrganizationOverview,
  } as unknown as GatewayClientService;
  return { gateway, getOrganizationOverview };
}

describe('buildGetUserPostureTool', () => {
  it('advertises the canonical name with organizationId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetUserPostureTool(gateway);
    expect(tool.name).toBe('get_user_posture');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['organizationId'],
    });
  });

  it('throws when accessToken is missing', async () => {
    const { gateway, getOrganizationOverview } = makeGatewayStub();
    const tool = buildGetUserPostureTool(gateway);
    await expect(
      tool.run({ organizationId: 'org-1' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(getOrganizationOverview).not.toHaveBeenCalled();
  });

  it('throws when organizationId is missing', async () => {
    const { gateway, getOrganizationOverview } = makeGatewayStub();
    const tool = buildGetUserPostureTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/organizationId is required/i);
    expect(getOrganizationOverview).not.toHaveBeenCalled();
  });

  it('forwards the org id and branches to the gateway and maps the response', async () => {
    const { gateway, getOrganizationOverview } = makeGatewayStub({
      totalProjects: 3,
      criticalIssues: 4,
      highIssues: 2,
      mediumIssues: 1,
      lowIssues: 0,
      totalByAnalysisType: [
        { analysisType: 'SAST', count: 3 },
        { analysisType: 'sca', count: 1 },
      ],
      topVulnerableProjects: [
        {
          projectId: 'p-1',
          projectName: 'frontend',
          criticalCount: 3,
          highCount: 1,
          vulnerabilityCount: 5,
          riskLevel: 'critical',
        },
        {
          projectId: 'p-2',
          criticalCount: 0,
          highCount: 1,
          vulnerabilityCount: 1,
        },
      ],
      projectsSummary: [
        { projectId: 'p-1', totalVulnerabilities: 5 },
        { projectId: 'p-2', totalVulnerabilities: 1 },
        { projectId: 'p-3', totalVulnerabilities: 0 },
      ],
    });
    const tool = buildGetUserPostureTool(gateway);
    const result = (await tool.run(
      { organizationId: 'org-1', branches: ['main', 'release/1.0'] },
      { userId: 'u', accessToken: 'tok' },
    )) as Record<string, unknown>;

    expect(getOrganizationOverview).toHaveBeenCalledWith(
      'org-1',
      ['main', 'release/1.0'],
      'tok',
    );
    expect(result.totalProjectsAccessible).toBe(3);
    expect(result.projectsScanned).toBe(2);
    expect(result.totalsBySeverity).toEqual({
      critical: 4,
      high: 2,
      medium: 1,
      low: 0,
    });
    expect(result.totalsByScanner).toEqual({ sast: 3, sca: 1 });
    expect(result.topProjects).toEqual([
      {
        projectId: 'p-1',
        projectName: 'frontend',
        criticalHigh: 4,
        total: 5,
        riskLevel: 'critical',
      },
      { projectId: 'p-2', criticalHigh: 1, total: 1 },
    ]);
    expect(result.errors).toBe(0);
    expect(typeof result.generatedAt).toBe('string');
  });

  it('omits the branches query param when not provided', async () => {
    const { gateway, getOrganizationOverview } = makeGatewayStub({});
    const tool = buildGetUserPostureTool(gateway);
    await tool.run(
      { organizationId: 'org-2' },
      { userId: 'u', accessToken: 'tok' },
    );
    expect(getOrganizationOverview).toHaveBeenCalledWith(
      'org-2',
      undefined,
      'tok',
    );
  });

  it('reads severity totals from scalar fields', async () => {
    const gateway = {
      getOrganizationOverview: jest.fn().mockResolvedValue({
        totalProjects: 2,
        criticalIssues: 5,
        highIssues: 4,
        mediumIssues: 3,
        lowIssues: 2,
        totalByAnalysisType: [{ analysisType: 'SAST', count: 14 }],
        topVulnerableProjects: [],
        projectsSummary: [],
      }),
    } as any;
    const tool = buildGetUserPostureTool(gateway);

    const res: any = await tool.run({ organizationId: 'org-1' }, {
      accessToken: 'jwt',
      userId: 'u',
    } as any);

    expect(res.totalsBySeverity).toEqual({
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
    });
  });
});
