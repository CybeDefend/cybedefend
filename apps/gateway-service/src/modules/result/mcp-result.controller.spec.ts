import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { McpResultController } from './mcp-result.controller';
import { ResultService } from './result.service';
import { MCP_LIST_MAX_PAGE_SIZE } from './mcp-result.mapper';

function buildController() {
  const resultService = {
    findAllSast: jest.fn(),
    findAllIac: jest.fn(),
    findAllCicd: jest.fn(),
    findAllSecret: jest.fn(),
    findAllContainer: jest.fn(),
    findAllSca: jest.fn(),
    findOneSast: jest.fn(),
    findOneIac: jest.fn(),
    findOneCicd: jest.fn(),
    findOneSecret: jest.fn(),
    findOneContainer: jest.fn(),
    findOneSca: jest.fn(),
  };
  const controller = new McpResultController(
    resultService as unknown as ResultService,
  );
  return { controller, resultService };
}

const baseFamilyResponse = {
  page: 1,
  limit: 50,
  total: 88,
  totalPages: 2,
  vulnerabilities: [
    {
      dataFlowItems: [],
      base: {
        id: 'b1',
        currentSeverity: 'high',
        currentPriority: 'urgent',
        currentState: 'to_verify',
        path: 'docker-compose.yml',
        vulnerableStartLine: 1,
        vulnerableEndLine: 1,
        vulnerability: { name: 'Rule', shortDescription: 's', cwe: ['CWE-1'] },
        autofixRecords: [{ diff: 'BIG' }],
        hasCybeAutofix: false,
        hasCybeAnalysis: false,
      },
    },
  ],
};

describe('McpResultController', () => {
  it('clamps an over-large pageSizeNumber to the hard max for SAST', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllSast.mockResolvedValue(baseFamilyResponse);

    const result = await controller.listVulnerabilities('p1', 'sast', {
      pageSizeNumber: 1000,
    } as never);

    expect(resultService.findAllSast).toHaveBeenCalledTimes(1);
    const req = resultService.findAllSast.mock.calls[0][0];
    expect(req.projectId).toBe('p1');
    expect(req.pageSizeNumber).toBe(MCP_LIST_MAX_PAGE_SIZE);
    expect(req.pageNumber).toBe(1);

    expect(result.scanner).toBe('sast');
    expect(result.total).toBe(88);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].id).toBe('b1');
    expect(result.vulnerabilities[0]).not.toHaveProperty('autofixRecords');
  });

  // The MCP list asks analysis-reporting for the page
  // only, without the dashboard's project Get, counters, facet and history.
  it.each(['sast', 'iac', 'cicd', 'secret'])(
    'asks analysis-reporting for a slim %s list',
    async (family) => {
      const { controller, resultService } = buildController();
      const lister = {
        sast: resultService.findAllSast,
        iac: resultService.findAllIac,
        cicd: resultService.findAllCicd,
        secret: resultService.findAllSecret,
      }[family];
      lister.mockResolvedValue(baseFamilyResponse);

      await controller.listVulnerabilities('p1', family, {} as never);

      expect(lister.mock.calls[0][0].slim).toBe(true);
    },
  );

  it('asks analysis-reporting for a slim sca list', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllSca.mockResolvedValue({
      vulnerabilities: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });

    await controller.listVulnerabilities('p1', 'sca', {} as never);

    expect(resultService.findAllSca.mock.calls[0][0].slim).toBe(true);
  });

  it('asks analysis-reporting for a slim container list', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllContainer.mockResolvedValue({
      vulnerabilities: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });

    await controller.listVulnerabilities('p1', 'container', {} as never);

    expect(resultService.findAllContainer.mock.calls[0][0].slim).toBe(true);
  });

  it('defaults the page size to 20 when omitted', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllIac.mockResolvedValue(baseFamilyResponse);

    await controller.listVulnerabilities('p1', 'iac', {} as never);

    expect(resultService.findAllIac.mock.calls[0][0].pageSizeNumber).toBe(20);
  });

  it('routes sca through findAllSca with a clamped limit', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllSca.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 5,
      totalPages: 1,
      vulnerabilities: [
        {
          base: {
            id: 's1',
            currentSeverity: 'critical',
            currentState: 'to_verify',
          },
          library: { packageName: 'lodash', packageVersion: '4.17.20' },
          metadata: { cve: 'CVE-1', summary: 'sum', cwes: [] },
          hasAutofix: false,
          hasCybeAnalysis: false,
        },
      ],
    });

    const result = await controller.listVulnerabilities('p1', 'sca', {
      limit: 1000,
    } as never);

    const req = resultService.findAllSca.mock.calls[0][0];
    expect(req.limit).toBe(MCP_LIST_MAX_PAGE_SIZE);
    expect(result.scanner).toBe('sca');
    expect(result.vulnerabilities[0].packageName).toBe('lodash');
    expect(result.vulnerabilities[0]).not.toHaveProperty('metadata');
  });

  it('routes container through findAllContainer with a clamped limit', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllContainer.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 3,
      totalPages: 1,
      vulnerabilities: [
        {
          id: 'c1',
          vulnerabilityIdentifier: 'CVE-2',
          currentSeverity: 'high',
          currentState: 'to_verify',
          package: { name: 'openssl', version: '1.0' },
          vuln: { title: 'overflow', cweIds: ['CWE-120'], description: 'LONG' },
        },
      ],
    });

    const result = await controller.listVulnerabilities('p1', 'container', {
      limit: 80,
    } as never);

    expect(resultService.findAllContainer.mock.calls[0][0].limit).toBe(
      MCP_LIST_MAX_PAGE_SIZE,
    );
    expect(result.scanner).toBe('container');
    expect(result.vulnerabilities[0].title).toBe('overflow');
    expect(result.vulnerabilities[0]).not.toHaveProperty('vuln');
  });

  it('rejects an unsupported scanner with 400 and calls no service', async () => {
    const { controller, resultService } = buildController();

    await expect(
      controller.listVulnerabilities('p1', 'bogus', {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(resultService.findAllSast).not.toHaveBeenCalled();
    expect(resultService.findAllSca).not.toHaveBeenCalled();
    expect(resultService.findAllContainer).not.toHaveBeenCalled();
  });

  it('propagates the advertised hasAutofix filter (parsed from its string form)', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllSast.mockResolvedValue(baseFamilyResponse);
    resultService.findAllSca.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
      vulnerabilities: [],
    });
    resultService.findAllContainer.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
      vulnerabilities: [],
    });

    await controller.listVulnerabilities('p1', 'sast', {
      hasAutofix: 'true',
    } as never);
    expect(resultService.findAllSast.mock.calls[0][0].hasAutofix).toBe(true);

    await controller.listVulnerabilities('p1', 'sca', {
      hasAutofix: 'false',
    } as never);
    expect(resultService.findAllSca.mock.calls[0][0].hasAutofix).toBe(false);

    await controller.listVulnerabilities('p1', 'container', {} as never);
    expect(
      resultService.findAllContainer.mock.calls[0][0].hasAutofix,
    ).toBeUndefined();
  });

  it('forwards the container imageId filter', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllContainer.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
      vulnerabilities: [],
    });

    await controller.listVulnerabilities('p1', 'container', {
      imageId: 'img-9',
    } as never);

    expect(resultService.findAllContainer.mock.calls[0][0].imageId).toBe(
      'img-9',
    );
  });

  it('does not crash when a base-family item has no base (filters it out)', async () => {
    const { controller, resultService } = buildController();
    resultService.findAllSast.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 2,
      totalPages: 1,
      vulnerabilities: [
        { base: undefined, dataFlowItems: [] },
        baseFamilyResponse.vulnerabilities[0],
      ],
    });

    const result = await controller.listVulnerabilities(
      'p1',
      'sast',
      {} as never,
    );

    // The base-less item is dropped, the valid one survives — no 500.
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].id).toBe('b1');
  });

  describe('authorization posture (regression guard)', () => {
    it('guards listVulnerabilities with read_scan_result on the project + PermissionsGuard', () => {
      const fn = McpResultController.prototype.listVulnerabilities;
      expect(Reflect.getMetadata('permissions', fn)).toEqual(
        expect.arrayContaining(['read_scan_result']),
      );
      expect(Reflect.getMetadata('subjectTypes', fn)).toEqual(
        expect.arrayContaining(['project']),
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []).toContain(
        PermissionsGuard,
      );
    });

    it('guards getVulnerability with read_scan_result on the project + PermissionsGuard', () => {
      const fn = McpResultController.prototype.getVulnerability;
      expect(Reflect.getMetadata('permissions', fn)).toEqual(
        expect.arrayContaining(['read_scan_result']),
      );
      expect(Reflect.getMetadata('subjectTypes', fn)).toEqual(
        expect.arrayContaining(['project']),
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []).toContain(
        PermissionsGuard,
      );
    });

    // `container` findings are feature-gated (container_scanning). The REST
    // surface and the dashboard gate them; this multiplexed route must too,
    // resolved from the :scanner param at runtime.
    it.each(['listVulnerabilities', 'getVulnerability'])(
      'plan-gates the container family on %s via FeatureGuard + @FeatureByRouteParam',
      (handler) => {
        const fn = (McpResultController.prototype as any)[handler];
        expect(Reflect.getMetadata('featureByRouteParam', fn)).toEqual({
          param: 'scanner',
          map: { container: 'container_scanning' },
        });
        const guards: unknown[] =
          Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
        expect(guards).toContain(FeatureGuard);
        // PermissionsGuard first, FeatureGuard second.
        expect(guards.indexOf(PermissionsGuard)).toBeGreaterThanOrEqual(0);
        expect(guards.indexOf(PermissionsGuard)).toBeLessThan(
          guards.indexOf(FeatureGuard),
        );
      },
    );

    it('applies the auth + rate-limit guard at the controller class level', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, McpResultController),
      ).toContain(CombinedAuthRateLimitGuard);
    });
  });

  describe('getVulnerability (detail)', () => {
    it('routes sast detail through findOneSast and returns a slim, truncated detail', async () => {
      const { controller, resultService } = buildController();
      resultService.findOneSast.mockResolvedValue({
        sast: {
          base: {
            id: 'b1',
            currentSeverity: 'high',
            currentState: 'to_verify',
            vulnerability: {
              name: 'R',
              description: 'X'.repeat(2000),
              cwe: ['CWE-1'],
              references: [],
            },
            autofixRecords: [
              { prUrl: 'http://pr', status: 'open', diff: 'BIG' },
            ],
          },
          dataFlowItems: [],
        },
      });

      const d = await controller.getVulnerability('p1', 'sast', 'v1');

      expect(resultService.findOneSast.mock.calls[0][0]).toEqual({
        projectId: 'p1',
        vulnerabilityId: 'v1',
      });
      expect(d.id).toBe('b1');
      expect(d.description?.endsWith('… [truncated]')).toBe(true);
      expect(d.autofix).toEqual({
        prUrl: 'http://pr',
        status: 'open',
        hasFullDiff: true,
      });
      expect(d).not.toHaveProperty('autofixRecords');
    });

    it('routes sca detail through findOneSca', async () => {
      const { controller, resultService } = buildController();
      resultService.findOneSca.mockResolvedValue({
        sca: {
          base: {
            id: 's1',
            currentSeverity: 'critical',
            currentState: 'to_verify',
          },
          library: { packageName: 'lodash', packageVersion: '1.0' },
          metadata: {
            cve: 'CVE-1',
            summary: 'sum',
            details: 'd',
            references: [],
            cwes: [],
          },
        },
      });

      const d = await controller.getVulnerability('p1', 'sca', 'v1');

      expect(d.scanner).toBe('sca');
      expect(d.packageName).toBe('lodash');
    });

    it('routes container detail through findOneContainer', async () => {
      const { controller, resultService } = buildController();
      resultService.findOneContainer.mockResolvedValue({
        detection: {
          id: 'c1',
          vulnerabilityIdentifier: 'CVE-2',
          currentSeverity: 'high',
          currentState: 'to_verify',
          vuln: { title: 't', description: 'x', cweIds: [], references: [] },
          package: { name: 'p', version: '1' },
          fixedVersion: '2',
        },
      });

      const d = await controller.getVulnerability('p1', 'container', 'v1');

      expect(d.scanner).toBe('container');
      expect(d.fixedVersion).toBe('2');
    });

    it('throws 404 when the vulnerability is absent', async () => {
      const { controller, resultService } = buildController();
      resultService.findOneSast.mockResolvedValue({});

      await expect(
        controller.getVulnerability('p1', 'sast', 'v1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unsupported scanner with 400', async () => {
      const { controller } = buildController();

      await expect(
        controller.getVulnerability('p1', 'bogus', 'v1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
