import { PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-scan-settings.binding';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';

import { OrganizationManager } from './organizationManager';
import { Scan } from '../../../entities/scan.entity';

/**
 * A `running` scan stops holding its organisation slot, and its place under
 * the platform cap, once all its scanner containers are closed: its AI phase
 * (waiting for the code parse, then the analysis) must not keep the
 * organisation's queue still. One count serves every capacity decision, and
 * `SCAN_SLOT_RELEASE_ENABLED=false` gives back the former numbers.
 */
describe('OrganizationManager slot counting', () => {
  let manager: OrganizationManager;
  let scanRepo: { find: jest.Mock; count: jest.Mock };
  let env: Record<string, string>;

  const scan = (
    id: string,
    org: string | null,
    containers: object[],
    isDiffScan = false,
  ) => ({
    id,
    organizationId: org,
    isDiffScan,
    containers,
  });
  const sast = (status: string) => ({
    id: `sast-${status}`,
    status,
    image: 'cybedefend-scanners/sast',
    podName: 'sast',
  });
  const sca = (status: string) => ({
    id: `sca-${status}`,
    status,
    image: 'cybedefend-scanners/sca',
    podName: 'sca',
  });
  const agent = (status: string) => ({
    id: `agent-${status}`,
    status,
    image: 'agent-service',
    podName: 'agent',
  });

  const build = async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrganizationManager,
        ...PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS,
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => env[key]) },
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
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
      ],
    }).compile();
    manager = module.get(OrganizationManager);
  };

  /**
   * What the database answers: `queued` counts the organisation's queued
   * scans, and the former admission query (`running + queued`) also counts
   * the running ones, so a test can tell the two rules apart.
   */
  const stubCounts = ({ running = 0, queued = 0 }) =>
    scanRepo.count.mockImplementation(
      async (opts: { where?: { state?: unknown } }) =>
        opts?.where?.state === 'queued' ? queued : running + queued,
    );

  beforeEach(async () => {
    env = {};
    scanRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    await build();
  });

  describe('getSlotHoldingScansCount', () => {
    it('counts only the running scans whose scanners are not all closed', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running'), agent('running')]),
        // AI phase: every scanner closed, the slot is released.
        scan('s2', 'A', [sast('completed'), agent('running')]),
        // Still creating its containers: it keeps its slot.
        scan('s3', 'B', []),
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 2,
        byOrganization: { A: 1, B: 1 },
      });
    });

    it('loads the running scans with the container fields the rule reads', async () => {
      await manager.getSlotHoldingScansCount();

      expect(scanRepo.find).toHaveBeenCalledTimes(1);
      expect(scanRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: 'running' },
          relations: ['containers'],
          select: {
            id: true,
            organizationId: true,
            isDiffScan: true,
            isGraphOnly: true,
            importFormat: true,
            containers: { id: true, status: true, image: true, podName: true },
          },
        }),
      );
    });

    it.each([
      ['a scanner still queued', [sca('queued'), agent('starting')], 1],
      [
        'every scanner closed, whatever its result',
        [
          sast('completed'),
          sca('failed'),
          sast('completed_degraded'),
          agent('parsing_completed'),
        ],
        0,
      ],
      ['an agent-only scan', [agent('running')], 1],
      ['no container yet', [], 1],
    ])('applies the slot rule to %s', async (_label, containers, expected) => {
      scanRepo.find.mockResolvedValue([scan('s1', 'A', containers)]);

      const { total, byOrganization } =
        await manager.getSlotHoldingScansCount();

      expect(total).toBe(expected);
      expect(byOrganization.A ?? 0).toBe(expected);
    });

    it('counts a scan without an organisation in the platform total only', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', null, [sast('running')]),
        scan('s2', 'A', [sast('running')]),
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 2,
        byOrganization: { A: 1 },
      });
    });

    it('counts every running scan when SCAN_SLOT_RELEASE_ENABLED=false', async () => {
      env.SCAN_SLOT_RELEASE_ENABLED = 'false';
      await build(); // the constructor reads the switch
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running'), agent('running')]),
        scan('s2', 'A', [sast('completed'), agent('running')]),
        scan('s3', 'B', []),
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 3,
        byOrganization: { A: 2, B: 1 },
      });
    });

    // A diff scan leaves the
    // organisation's concurrency limit. It still runs pods, so it stays in
    // the platform total.
    it("keeps diff scans out of the organisation's count, not out of the platform total", async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running')]),
        scan('d1', 'A', [sast('running')], true),
        scan('d2', 'B', [sast('running')], true),
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 3,
        byOrganization: { A: 1 },
      });
    });
    // A graph-only scan (a repository import) stays running, with only its
    // agent container, until the parse is over. It runs no scanner pod, so it holds no slot at all: neither in
    // its organisation's limit nor under the platform cap. An agent-only
    // scan otherwise keeps its slot.
    it('never counts a graph-only scan, neither for its organisation nor the platform', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running')]),
        { ...scan('g1', 'A', [agent('running')]), isGraphOnly: 1 },
        { ...scan('g2', 'B', []), isGraphOnly: true },
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 1,
        byOrganization: { A: 1 },
      });
    });

    // An import scan is a `running` scan with no container. It holds
    // no slot — neither its organisation's nor the platform's; the import
    // watchdog owns its lifecycle.
    it('counts no slot for a running import scan', async () => {
      scanRepo.find.mockResolvedValue([
        { id: 'i', organizationId: 'o', importFormat: 'sarif', containers: [] },
        scan('s1', 'A', [sast('running')]),
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 1,
        byOrganization: { A: 1 },
      });
      const select = scanRepo.find.mock.calls[0][0].select as Record<
        string,
        unknown
      >;
      expect(select.importFormat).toBe(true);
    });

    it('counts no slot for a running import scan alone', async () => {
      scanRepo.find.mockResolvedValue([
        { id: 'i', organizationId: 'o', importFormat: 'sarif', containers: [] },
      ]);

      await expect(manager.getSlotHoldingScansCount()).resolves.toEqual({
        total: 0,
        byOrganization: {},
      });
    });
  });

  // Admission counts the organisation's queue, the dequeue does
  // not. Both now count the slot-holding running scans.
  describe('shouldQueueScan (admission)', () => {
    it('starts a scan while the only running scan of the organisation is in its AI phase', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s2', 'A', [sast('completed'), agent('running')]),
      ]);
      stubCounts({ running: 1, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(false);
      expect(scanRepo.count).toHaveBeenCalledWith({
        where: { organizationId: 'A', state: 'queued', isDiffScan: false },
      });
    });

    it('queues behind a running scan that still holds the slot', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running'), agent('running')]),
      ]);
      stubCounts({ running: 1, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(true);
    });

    it('queues behind scans already waiting, so a burst cannot jump the line', async () => {
      scanRepo.find.mockResolvedValue([]);
      stubCounts({ running: 0, queued: 1 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(true);
    });

    it("does not queue behind the organisation's running diff scans", async () => {
      scanRepo.find.mockResolvedValue([
        scan('d1', 'A', [sast('running')], true),
        scan('d2', 'A', [sast('running')], true),
      ]);
      stubCounts({ running: 0, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(false);
    });

    it('ignores the running scans of other organisations', async () => {
      scanRepo.find.mockResolvedValue([
        scan('s1', 'B', [sast('running')]),
        scan('s2', 'B', [sast('running')]),
      ]);
      stubCounts({ running: 0, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(false);
    });

    // Admission runs on every StartScan: it loads only the organisation's
    // running scans (IDX_scan_organizationId_state), not the platform's.
    it("scopes its slot count to the organisation's running scans, an AI-phase scan still holding no slot", async () => {
      scanRepo.find.mockResolvedValue([
        scan('s2', 'A', [sast('completed'), agent('running')]),
      ]);
      stubCounts({ running: 1, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(false);
      expect(scanRepo.find).toHaveBeenCalledTimes(1);
      expect(scanRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: 'running', organizationId: 'A' },
          relations: ['containers'],
        }),
      );
    });

    it('still counts every running scan of the organisation when SCAN_SLOT_RELEASE_ENABLED=false', async () => {
      env.SCAN_SLOT_RELEASE_ENABLED = 'false';
      await build();
      scanRepo.find.mockResolvedValue([
        scan('s1', 'A', [sast('running'), agent('running')]),
        scan('s2', 'A', [sast('completed'), agent('running')]),
      ]);
      stubCounts({ running: 2, queued: 0 });

      await expect(manager.shouldQueueScan('A', 2)).resolves.toBe(true);
      await expect(manager.shouldQueueScan('A', 3)).resolves.toBe(false);
    });

    it('counts running plus queued, as before, when SCAN_SLOT_RELEASE_ENABLED=false', async () => {
      env.SCAN_SLOT_RELEASE_ENABLED = 'false';
      await build();
      scanRepo.find.mockResolvedValue([
        scan('s2', 'A', [sast('completed'), agent('running')]),
      ]);
      stubCounts({ running: 1, queued: 0 });

      await expect(manager.shouldQueueScan('A', 1)).resolves.toBe(true);
      await expect(manager.shouldQueueScan('A', 2)).resolves.toBe(false);
    });
  });
});

/**
 * `getProjectInformation` serves createScan, startScan, the
 * queued path and the container path. It reads only the project's own
 * settings, so it asks global-management for the lean read: no
 * vulnerability count in analysis-reporting, no integration status, no
 * security context. It is read afresh on every call, so a setting changed
 * between createScan and startScan (enabledScanTypes, hasCodeGraph) is the one
 * the scan runs with.
 */
describe('OrganizationManager.getProjectInformation', () => {
  let manager: OrganizationManager;
  let projectGet: jest.Mock;

  const project = (overrides: Record<string, unknown> = {}) => ({
    projectId: 'p1',
    organizationId: 'org-1',
    sastEnabled: true,
    iacEnabled: false,
    scaEnabled: false,
    secretEnabled: false,
    aibomEnabled: false,
    containerEnabled: true,
    sastSeverities: ['critical', 'high'],
    iacSeverities: [],
    scaSeverities: ['critical'],
    secretSeverities: [],
    containerSeverities: ['high'],
    sastFastScanEnabled: true,
    scaDevelopmentDependenciesEnabled: false,
    scaTransitiveDependenciesEnabled: true,
    improvingResultsEnabled: true,
    securityChampionEnabled: false,
    scaReachabilityPriorityEnabled: false,
    scaReachabilityStatusEnabled: true,
    parsedBranches: [],
    ...overrides,
  });

  beforeEach(async () => {
    projectGet = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        OrganizationManager,
        ...PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS,
        {
          provide: getRepositoryToken(Scan),
          useValue: { find: jest.fn(), count: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: jest.fn().mockReturnValue({ get: projectGet }),
          },
        },
      ],
    }).compile();
    manager = module.get(OrganizationManager);
    manager.onModuleInit();
  });

  it('asks global-management for the lean read', async () => {
    projectGet.mockReturnValue(of(project()));

    await manager.getProjectInformation('p1');

    expect(projectGet).toHaveBeenCalledTimes(1);
    expect(projectGet).toHaveBeenCalledWith({
      projectId: 'p1',
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    });
  });

  it('maps the settings the scan pipeline reads', async () => {
    projectGet.mockReturnValue(
      of(
        project({
          parsedBranches: [{ branch: 'main', status: 2 }],
          referenceBranch: 'develop',
        }),
      ),
    );

    await expect(manager.getProjectInformation('p1')).resolves.toEqual({
      enabledScanTypes: ['sast'],
      vulnerabilityTypesByScan: { sast: 'critical,high' },
      sastFastScanEnabled: true,
      organizationId: 'org-1',
      scaDevelopmentDependenciesEnabled: false,
      scaTransitiveDependenciesEnabled: true,
      containerEnabled: true,
      containerSeverities: ['high'],
      scaReachabilityPriorityEnabled: false,
      scaReachabilityStatusEnabled: true,
      hasCodeGraph: true,
      referenceBranch: 'develop',
    });
  });

  // The AI-BOM scan and the AI settings belong to closed features: the
  // community settings run the AppSec scanners only and carry no AI setting,
  // whatever the project row says.
  it('adds no closed scan type nor AI setting', async () => {
    projectGet.mockReturnValue(
      of(
        project({
          aibomEnabled: true,
          improvingResultsEnabled: true,
          securityChampionEnabled: true,
        }),
      ),
    );

    const settings = await manager.getProjectInformation('p1');

    expect(settings.enabledScanTypes).toEqual(['sast']);
    expect(settings).not.toHaveProperty('improvedSastEnabled');
    expect(settings).not.toHaveProperty('securityChampionEnabled');
  });

  it('reads a project without a reference branch as ""', async () => {
    projectGet.mockReturnValue(of(project({ referenceBranch: undefined })));

    const settings = await manager.getProjectInformation('p1');

    expect(settings.referenceBranch).toBe('');
  });

  it('reads the project afresh on every call: a change between createScan and startScan is taken into account', async () => {
    // createScan reads the project with SAST only…
    projectGet.mockReturnValueOnce(of(project()));
    // …the owner enables SCA and the first parse lands before startScan.
    projectGet.mockReturnValueOnce(
      of(
        project({
          scaEnabled: true,
          parsedBranches: [{ branch: 'main', status: 2 }],
        }),
      ),
    );

    const atCreate = await manager.getProjectInformation('p1');
    const atStart = await manager.getProjectInformation('p1');

    expect(projectGet).toHaveBeenCalledTimes(2);
    expect(atCreate.enabledScanTypes).toEqual(['sast']);
    expect(atCreate.hasCodeGraph).toBe(false);
    expect(atStart.enabledScanTypes).toEqual(['sast', 'sca']);
    expect(atStart.hasCodeGraph).toBe(true);
  });
});
