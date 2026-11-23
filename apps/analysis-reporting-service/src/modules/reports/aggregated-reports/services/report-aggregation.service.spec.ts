import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';

import { ReportAggregationService } from './report-aggregation.service';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { ScaLicenseOverride } from 'src/entities/sca-license-override.entity';

const fakeRepo = (): any => ({
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ReportAggregationService — validateUserAccess (defense in depth)', () => {
  const orgRequested = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const orgOther = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const projectInOwnOrg = '11111111-1111-1111-1111-111111111111';
  const projectInOtherOrg = '22222222-2222-2222-2222-222222222222';
  const projectMissing = '33333333-3333-3333-3333-333333333333';
  const userId = 'user-1';

  let service: ReportAggregationService;
  let projectServiceClient: { Get: jest.Mock };
  let organizationServiceClient: { Get: jest.Mock };
  let teamServiceClient: { getTeam: jest.Mock };

  beforeEach(async () => {
    projectServiceClient = { Get: jest.fn() };
    organizationServiceClient = { Get: jest.fn() };
    teamServiceClient = { getTeam: jest.fn() };

    const grpcClient = {
      getService: jest.fn((name: string) => {
        if (name === 'ProjectService') return projectServiceClient;
        if (name === 'OrganizationService') return organizationServiceClient;
        if (name === 'TeamService') return teamServiceClient;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportAggregationService,
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: fakeRepo(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: fakeRepo(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: fakeRepo(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: fakeRepo(),
        },
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: fakeRepo(),
        },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: fakeRepo(),
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: grpcClient,
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ReportAggregationService);
    // Manually invoke onModuleInit since Test doesn't trigger it
    service.onModuleInit();
  });

  it('rejects with PERMISSION_DENIED when a projectId belongs to a different organization (cross-tenant exfiltration)', async () => {
    projectServiceClient.Get.mockImplementation(
      (req: { projectId: string }) => {
        if (req.projectId === projectInOwnOrg) {
          return of({
            projectId: projectInOwnOrg,
            name: 'Mine',
            organizationId: orgRequested,
          });
        }
        if (req.projectId === projectInOtherOrg) {
          // The other tenant's project — must be REJECTED
          return of({
            projectId: projectInOtherOrg,
            name: 'TheirSecret',
            organizationId: orgOther,
          });
        }
        return throwError(() => new Error('not found'));
      },
    );

    await expect(
      service.validateUserAccess(
        userId,
        [projectInOwnOrg, projectInOtherOrg],
        orgRequested,
      ),
    ).rejects.toBeInstanceOf(RpcException);

    // Verify error code is PERMISSION_DENIED
    try {
      await service.validateUserAccess(
        userId,
        [projectInOwnOrg, projectInOtherOrg],
        orgRequested,
      );
    } catch (err: any) {
      expect(err.error?.code ?? err.code).toBe(status.PERMISSION_DENIED);
      // Must NOT leak the offending projectId in the message
      expect(err.message || err.error?.message || '').not.toContain(
        projectInOtherOrg,
      );
    }
  });

  it('accepts when all projectIds belong to the requested organization (regression)', async () => {
    projectServiceClient.Get.mockImplementation(
      (req: { projectId: string }) => {
        return of({
          projectId: req.projectId,
          name: 'Project',
          organizationId: orgRequested,
        });
      },
    );

    await expect(
      service.validateUserAccess(
        userId,
        [projectInOwnOrg, projectMissing],
        orgRequested,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects with PERMISSION_DENIED when a projectId cannot be resolved (fail-closed)', async () => {
    projectServiceClient.Get.mockImplementation(
      (req: { projectId: string }) => {
        if (req.projectId === projectInOwnOrg) {
          return of({
            projectId: projectInOwnOrg,
            name: 'Mine',
            organizationId: orgRequested,
          });
        }
        // gRPC NOT_FOUND or any other error must NOT be silently allowed
        return throwError(() => ({
          code: status.NOT_FOUND,
          details: 'project not found',
        }));
      },
    );

    await expect(
      service.validateUserAccess(
        userId,
        [projectInOwnOrg, projectMissing],
        orgRequested,
      ),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('treats missing organizationId argument as INVALID_ARGUMENT (defense in depth)', async () => {
    await expect(
      service.validateUserAccess(userId, [projectInOwnOrg], ''),
    ).rejects.toBeInstanceOf(RpcException);
  });
});

// ── Report data contract (aggregated reports) ────────────────────
// The aggregated reports render what this service returns: every figure of a
// report must reconcile with the rows it lists, so the data layer maps,
// deduplicates and counts once, the same way as the per-project reports.

/** Chainable query-builder stub resolving to `rows`. */
const qb = (rows: unknown[]): any => {
  const chain: any = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'getMany' || prop === 'getRawMany') {
          return jest.fn().mockResolvedValue(rows);
        }
        return () => chain;
      },
    },
  );
  return chain;
};

const PROJECTS: Record<string, { name: string; team: string }> = {
  p1: { name: 'billing-service', team: 'Payments' },
  p2: { name: 'vitality-api', team: 'Platform' },
  p3: { name: 'ml-recommender', team: 'Data' },
};

function makeAggregation(opts: {
  sast?: unknown[];
  iac?: unknown[];
  sca?: unknown[];
  container?: unknown[];
  fixedEvents?: unknown[];
  packages?: unknown[];
}) {
  const repo = (rows: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => qb(rows)),
    ...extra,
  });
  const projectService = {
    Get: jest.fn(({ projectId }: { projectId: string }) =>
      of({
        projectId,
        name: PROJECTS[projectId]?.name ?? 'Unknown Project',
        teamId: `team-${projectId}`,
        teamName: PROJECTS[projectId]?.team ?? '',
        referenceBranch: 'main',
      }),
    ),
    getArchivedBranches: jest.fn(() => of({ branches: [] })),
  };
  const grpc = { getService: jest.fn(() => projectService) };
  const service = new ReportAggregationService(
    repo(opts.sast) as any,
    repo(opts.iac) as any,
    repo(opts.sca, {
      manager: {
        createQueryBuilder: jest.fn(() => qb(opts.fixedEvents ?? [])),
      },
    }) as any,
    repo(opts.container) as any,
    repo(opts.packages) as any,
    repo() as any,
    grpc as any,
    { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
  );
  service.onModuleInit();
  return service;
}

const sastRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  projectId: 'p1',
  branch: 'main',
  currentSeverity: 'HIGH',
  effectiveSeverity: null,
  currentState: 'to_verify',
  currentPriority: 'high',
  path: 'src/app.js',
  vulnerableStartLine: 12,
  vulnerableEndLine: 12,
  vulnerability: { name: 'Eval injection', cwe: ['CWE-95'], owaspTop10: [] },
  ...over,
});

describe('ReportAggregationService — OWASP / CWE data contract', () => {
  it('maps dependency (SCA) and container findings to A06, like the per-project OWASP report', async () => {
    const service = makeAggregation({
      sca: [
        {
          id: 'sca1',
          projectId: 'p1',
          branch: 'main',
          currentSeverity: 'CRITICAL',
          currentState: 'to_verify',
          scaDetectedPackage: { packageName: 'growl', packageVersion: '1.9.2' },
          vulnerability: {
            id: 'GHSA-qh2h-chj9-jffq',
            summary: 'Growl vulnerable to command injection',
            aliases: [{ alias: 'CVE-2017-16042' }],
          },
        },
      ],
      container: [
        {
          id: 'c1',
          projectId: 'p2',
          branch: 'main',
          currentSeverity: 'HIGH',
          currentState: 'to_verify',
          vulnerabilityIdentifier: 'CVE-2026-48712',
          detectedPackage: {
            packageName: 'protobufjs',
            packageVersion: '8.0.0',
            class: 'lang-pkgs',
          },
          fixedVersion: '8.4.1',
          vulnerability: { summary: 'Prototype pollution', aliases: [] },
        },
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1', 'p2'], 'owasp');
    const a06 = data.categories.find((c: any) => c.categoryData.id === 'A06');
    expect(a06.vulnerabilities.map((v: any) => v.id).sort()).toEqual([
      'c1',
      'sca1',
    ]);
  });

  it('uses the rule OWASP classification first, then the CWE mapping', async () => {
    const service = makeAggregation({
      sast: [
        sastRow({
          id: 'classified',
          vulnerability: {
            name: 'SQL injection',
            cwe: ['CWE-89'],
            owaspTop10: ['A01:2017 - Injection', 'A03:2021 - Injection'],
          },
        }),
        sastRow({
          id: 'by-cwe',
          vulnerability: { name: 'CSRF', cwe: ['CWE-352'], owaspTop10: [] },
        }),
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    const ids = (id: string) =>
      data.categories
        .find((c: any) => c.categoryData.id === id)
        .vulnerabilities.map((v: any) => v.id);
    expect(ids('A03')).toEqual(['classified']);
    expect(ids('A01')).toEqual(['by-cwe']);
  });

  it('places each finding in exactly one category, like the per-project OWASP report, and leaves an unmapped one out', async () => {
    const service = makeAggregation({
      sast: [
        sastRow({
          id: 'two-labels',
          vulnerability: {
            name: 'Session cookie without Secure flag',
            cwe: ['CWE-522'],
            owaspTop10: [
              'A02:2017 - Broken Authentication',
              'A04:2021 - Insecure Design',
              'A07:2021 - Identification and Authentication Failures',
            ],
          },
        }),
        sastRow({
          id: 'two-cwes',
          vulnerability: {
            name: 'Path traversal',
            cwe: ['CWE-22', 'CWE-89'],
            owaspTop10: [],
          },
        }),
      ],
      iac: [
        sastRow({
          id: 'unmapped',
          vulnerability: {
            name: 'Privileged container',
            cwe: [],
            owaspTop10: ['A06:2017 - Security Misconfiguration'],
          },
        }),
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    const where = (id: string) =>
      data.categories
        .filter((c: any) => c.vulnerabilities.some((v: any) => v.id === id))
        .map((c: any) => c.categoryData.id);
    expect(where('two-labels')).toEqual(['A04']);
    expect(where('two-cwes')).toEqual(['A01']);
    expect(where('unmapped')).toEqual([]);
    // Still in the finding list: the report counts it as not mapped.
    expect(data.vulnerabilities.map((v: any) => v.id)).toContain('unmapped');
  });

  it('returns all ten OWASP categories in order, empty ones included (the matrix lists them)', async () => {
    const service = makeAggregation({ sast: [sastRow()] });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    expect(data.categories.map((c: any) => c.categoryData.id)).toEqual([
      'A01',
      'A02',
      'A03',
      'A04',
      'A05',
      'A06',
      'A07',
      'A08',
      'A09',
      'A10',
    ]);
    expect(
      data.categories.find((c: any) => c.categoryData.id === 'A09').count,
    ).toBe(0);
  });

  it('returns the 25 CWE Top 25 entries by rank, empty ones included', async () => {
    const service = makeAggregation({
      sast: [
        sastRow({
          vulnerability: { name: 'XSS', cwe: ['CWE-79'], owaspTop10: [] },
        }),
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'cwe');
    expect(data.categories).toHaveLength(25);
    expect(data.categories[0].cweData.id).toBe('CWE-79');
    expect(data.categories[0].count).toBe(1);
    expect(data.categories.map((c: any) => c.cweData.rank)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it('uses the effective severity, never invents a branch and keeps a single line number', async () => {
    const service = makeAggregation({
      sast: [
        sastRow({
          effectiveSeverity: 'critical',
          branch: '',
          vulnerableStartLine: 31,
          vulnerableEndLine: 31,
        }),
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    const v = data.vulnerabilities[0];
    expect(v.severity).toBe('critical');
    expect(v.branch).toBe('');
    expect(v.line).toBe('31');
  });

  it('carries the advisory id and the installed-aware fixed version of an SCA finding', async () => {
    const service = makeAggregation({
      sca: [
        {
          id: 'sca1',
          projectId: 'p1',
          branch: 'main',
          currentSeverity: 'HIGH',
          currentState: 'to_verify',
          scaDetectedPackage: {
            packageName: 'lodash',
            packageVersion: '4.17.4',
          },
          vulnerability: {
            id: 'GHSA-p6mc-m468-83gw',
            summary: 'Prototype pollution in lodash',
            aliases: [],
          },
        },
      ],
      fixedEvents: [
        { osvId: 'GHSA-p6mc-m468-83gw', fixedVersion: '4.17.19' },
        { osvId: 'GHSA-p6mc-m468-83gw', fixedVersion: '3.0.0' },
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    const v = data.vulnerabilities[0];
    expect(v.advisoryId).toBe('GHSA-p6mc-m468-83gw');
    expect(v.fixedVersion).toBe('4.17.19');
  });

  it('exposes the installed version of a container package', async () => {
    const service = makeAggregation({
      container: [
        {
          id: 'c1',
          projectId: 'p1',
          branch: 'main',
          currentSeverity: 'HIGH',
          currentState: 'to_verify',
          vulnerabilityIdentifier: 'CVE-2026-1',
          detectedPackage: {
            packageName: 'openssl',
            packageVersion: '3.0.1',
            class: 'os-pkgs',
          },
          fixedVersion: '3.0.2',
          vulnerability: { summary: 'Overflow', aliases: [] },
        },
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    expect(data.vulnerabilities[0]).toEqual(
      expect.objectContaining({
        packageName: 'openssl',
        packageVersion: '3.0.1',
        advisoryId: 'CVE-2026-1',
      }),
    );
  });

  it('says which dependency advisories their publisher withdrew (OSV record), like the per-project OWASP report', async () => {
    const withdrawnAt = new Date('2025-11-03T00:00:00Z');
    const sca = (id: string, osv: Record<string, unknown>) => ({
      id,
      projectId: 'p1',
      branch: 'main',
      currentSeverity: 'LOW',
      currentState: 'to_verify',
      scaDetectedPackage: { packageName: 'express', packageVersion: '4.16.4' },
      vulnerability: { summary: 'An advisory', aliases: [], ...osv },
    });
    const service = makeAggregation({
      sca: [
        sca('withdrawn', { id: 'GHSA-pj86-cfqh-vqx6', withdrawnAt }),
        sca('live', { id: 'GHSA-qw6h-vgh9-j6wx', withdrawnAt: null }),
      ],
      container: [
        {
          id: 'c1',
          projectId: 'p1',
          branch: 'main',
          currentSeverity: 'HIGH',
          currentState: 'to_verify',
          vulnerabilityIdentifier: 'CVE-2026-1',
          detectedPackage: { packageName: 'openssl', packageVersion: '3.0.1' },
          vulnerability: { summary: 'Overflow', aliases: [], withdrawnAt },
        },
      ],
    });
    const data = await service.aggregateVulnerabilities(['p1'], 'owasp');
    const flag = (id: string) =>
      data.vulnerabilities.find((v: any) => v.id === id).withdrawn;
    expect(flag('withdrawn')).toBe(true);
    expect(flag('live')).toBe(false);
    expect(flag('c1')).toBe(true);
  });
});

describe('ReportAggregationService — dependency and container advisories, pass 3', () => {
  const scaRow = (databaseSpecific: unknown) => ({
    id: 'sca1',
    projectId: 'p1',
    branch: 'main',
    currentSeverity: 'HIGH',
    currentState: 'to_verify',
    scaDetectedPackage: { packageName: 'tar', packageVersion: '4.4.1' },
    vulnerability: {
      id: 'GHSA-r628-mhmh-qjhw',
      summary: 'Arbitrary file overwrite in tar',
      aliases: [],
      databaseSpecific,
    },
  });
  const containerRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    projectId: 'p2',
    branch: '',
    currentSeverity: 'HIGH',
    currentState: 'to_verify',
    vulnerabilityIdentifier: 'CVE-2026-25965',
    detectedPackage: { packageName: 'imagemagick', packageVersion: '6.9.11' },
    detectedImage: { artifactName: 'ghcr.io/acme-corp/thumbnailer:2.4.1' },
    vulnerability: {
      summary: 'Path traversal',
      aliases: [],
      databaseSpecific: { cwe_ids: ['CWE-22'] },
    },
    ...over,
  });

  it('maps the CWE of a dependency or container advisory (OSV database_specific), as the per-project CWE report does', async () => {
    const service = makeAggregation({
      sca: [scaRow({ cwe_ids: ['CWE-22', 'cwe-59'] })],
      container: [containerRow()],
    });
    const data = await service.aggregateVulnerabilities(['p1', 'p2'], 'cwe');
    const ids = (cwe: string) =>
      data.categories
        .find((c) => c.cweData.id === cwe)
        .vulnerabilities.map((v) => v.id)
        .sort();
    // « dependency and container advisories carry no CWE » was false: the
    // per-project CWE report counts them, the organization report did not.
    expect(ids('CWE-22')).toEqual(['c1', 'sca1']);
    const sca = data.vulnerabilities.find((v) => v.id === 'sca1');
    expect(sca.cwe).toEqual(['CWE-22', 'CWE-59']);
    // OWASP keeps them in A06 whatever their CWE.
    const owasp = await makeAggregation({
      sca: [scaRow({ cwe_ids: ['CWE-22'] })],
    }).aggregateVulnerabilities(['p1'], 'owasp');
    expect(
      owasp.categories
        .find((c) => c.categoryData.id === 'A06')
        .vulnerabilities.map((v) => v.id),
    ).toEqual(['sca1']);
    // Without a CWE list, none (never a crash).
    const bare = await makeAggregation({
      sca: [scaRow(null)],
    }).aggregateVulnerabilities(['p1'], 'cwe');
    expect(bare.vulnerabilities[0].cwe).toEqual([]);
  });

  it('names the image a container finding was found in, as the per-project reports do', async () => {
    const service = makeAggregation({ container: [containerRow()] });
    const data = await service.aggregateVulnerabilities(['p2'], 'owasp');
    expect(data.vulnerabilities[0].image).toBe(
      'ghcr.io/acme-corp/thumbnailer:2.4.1',
    );
    const none = await makeAggregation({
      container: [containerRow({ detectedImage: null })],
    }).aggregateVulnerabilities(['p2'], 'owasp');
    expect(none.vulnerabilities[0].image).toBeUndefined();
  });
});

describe('ReportAggregationService — license data contract', () => {
  const pkg = (over: Record<string, unknown>) => ({
    projectId: 'p1',
    branch: 'main',
    ecosystem: 'npm',
    packageName: 'x',
    packageVersion: '1.0.0',
    licenses: ['MIT'],
    licenseExpression: null,
    isDev: false,
    isTransitive: true,
    ...over,
  });

  it('counts each distinct package once, in its effective category, so the categories add up to the total', async () => {
    const service = makeAggregation({
      packages: [
        pkg({ packageName: 'a' }),
        pkg({ packageName: 'a', projectId: 'p2' }),
        pkg({
          packageName: 'dual',
          licenses: ['GPL-3.0', 'MIT'],
          licenseExpression: 'GPL-3.0 OR MIT',
        }),
        pkg({ packageName: 'nolicense', licenses: [] }),
        pkg({ packageName: 'strong', licenses: ['GPL-3.0'] }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1', 'p2', 'p3']);
    const { summary } = data;
    expect(summary.totalPackages).toBe(4);
    expect(summary.packageOccurrences).toBe(5);
    expect(summary.byCategory).toEqual({
      permissive: 2,
      weakCopyleft: 0,
      strongCopyleft: 1,
      unknown: 1,
    });
    const b = summary.byCategory;
    expect(b.permissive + b.weakCopyleft + b.strongCopyleft + b.unknown).toBe(
      summary.totalPackages,
    );
  });

  it('lists a package once per effective license, with the projects using it', async () => {
    const service = makeAggregation({
      packages: [
        pkg({ packageName: 'a' }),
        pkg({ packageName: 'a', projectId: 'p2' }),
        pkg({
          packageName: 'dual',
          licenses: ['GPL-3.0', 'MIT'],
          licenseExpression: 'GPL-3.0 OR MIT',
        }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1', 'p2']);
    const mit = data.licenseCategories.PERMISSIVE.find(
      (l: any) => l.spdxId === 'MIT',
    );
    expect(mit.packages.map((p: any) => p.packageName).sort()).toEqual([
      'a',
      'dual',
    ]);
    expect(
      mit.packages.find((p: any) => p.packageName === 'a').projects,
    ).toEqual(['billing-service', 'vitality-api']);
    expect(data.licenseCategories.STRONG_COPYLEFT).toEqual([]);
  });

  it('normalises the AFLv2.1 alias to the permissive AFL-2.1 license', async () => {
    const service = makeAggregation({
      packages: [pkg({ packageName: 'json-schema', licenses: ['AFLv2.1'] })],
    });
    const data = await service.aggregateLicenseData(['p1']);
    expect(data.summary.byCategory.unknown).toBe(0);
    expect(data.licenseCategories.PERMISSIVE[0].spdxId).toBe('AFL-2.1');
  });

  it('describes every project in scope, including one without a dependency inventory', async () => {
    const service = makeAggregation({
      packages: [
        pkg({ packageName: 'a' }),
        pkg({ packageName: 'b', licenses: [] }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1', 'p3']);
    expect(data.projectRows).toEqual([
      expect.objectContaining({
        projectName: 'billing-service',
        packages: 2,
        byCategory: expect.objectContaining({ permissive: 1, unknown: 1 }),
      }),
      expect.objectContaining({ projectName: 'ml-recommender', packages: 0 }),
    ]);
    expect(data.summary.projectsWithPackages).toBe(1);
  });

  it('counts a package once whatever its versions, and its versions apart', async () => {
    const service = makeAggregation({
      packages: [
        pkg({ packageName: 'a', packageVersion: '1.0.0' }),
        pkg({ packageName: 'a', packageVersion: '2.0.0', projectId: 'p2' }),
        pkg({ packageName: 'b', licenses: [] }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1', 'p2']);
    expect(data.summary.totalPackages).toBe(2);
    expect(data.summary.totalVersions).toBe(3);
    expect(data.summary.byCategory).toEqual({
      permissive: 1,
      weakCopyleft: 0,
      strongCopyleft: 0,
      unknown: 1,
    });
    expect(
      data.projectRows.find((r: any) => r.projectName === 'billing-service'),
    ).toEqual(
      expect.objectContaining({
        packages: 2,
        byCategory: expect.objectContaining({ permissive: 1, unknown: 1 }),
      }),
    );
  });

  it('reads a pinned requirement (==0.3.0) as the version it pins, never as another version', async () => {
    const service = makeAggregation({
      packages: [
        pkg({
          ecosystem: 'pip',
          packageName: 'anthropic',
          packageVersion: '==0.3.0',
        }),
        pkg({
          ecosystem: 'pip',
          packageName: 'anthropic',
          packageVersion: '0.3.0',
        }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1']);
    expect(data.summary.totalPackages).toBe(1);
    expect(data.summary.totalVersions).toBe(1);
    expect(data.packages).toHaveLength(1);
    expect(data.packages[0].packageVersion).toBe('0.3.0');
    expect(data.projectRows[0].packages).toBe(1);
  });

  it('merges a GitHub Actions tag (v2) with the version it resolves to', async () => {
    const service = makeAggregation({
      packages: [
        pkg({
          ecosystem: 'github',
          packageName: 'actions/cache',
          packageVersion: 'v2',
        }),
        pkg({
          ecosystem: 'github_actions',
          packageName: 'actions/cache',
          packageVersion: '2.0.0',
        }),
        pkg({
          ecosystem: 'github',
          packageName: 'actions/labeler',
          packageVersion: 'v4',
        }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1']);
    expect(
      data.packages.map((p: any) => [
        p.ecosystem,
        p.packageName,
        p.packageVersion,
      ]),
    ).toEqual([
      ['github_actions', 'actions/cache', '2.0.0'],
      ['github_actions', 'actions/labeler', 'v4'],
    ]);
    expect(data.summary.totalPackages).toBe(2);
  });

  it('never invents a branch for a package without one', async () => {
    const service = makeAggregation({ packages: [pkg({ branch: '' })] });
    const data = await service.aggregateLicenseData(['p1']);
    expect(data.packages[0].branches).toEqual([]);
  });

  it('names the projects of a package by id too: two teams may each have a project of the same name', async () => {
    const service = makeAggregation({
      packages: [
        pkg({ packageName: 'a', projectId: 'p2' }),
        pkg({ packageName: 'a' }),
        pkg({ packageName: 'b' }),
      ],
    });
    const data = await service.aggregateLicenseData(['p1', 'p2']);
    expect(
      data.packages.map((p: { packageName: string; projectIds: string[] }) => [
        p.packageName,
        p.projectIds,
      ]),
    ).toEqual([
      ['a', ['p1', 'p2']],
      ['b', ['p1']],
    ]);
  });
});
