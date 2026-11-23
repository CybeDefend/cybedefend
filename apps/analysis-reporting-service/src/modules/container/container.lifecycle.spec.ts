import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContainerService } from './container.service';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { VulnerabilityOsv } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';

/**
 * Task 6 — the container family's half of "keep the lifecycle correct going
 * forward". The columns the backfill just populated decay from day one unless
 * every write path maintains them.
 */
describe('ContainerService — GRC lifecycle maintenance', () => {
  let service: ContainerService;
  let detRepo: MockType<any>;
  let histRepo: MockType<any>;
  let pkgRepo: MockType<any>;

  const image = {
    id: 'img-1',
    projectId: 'p1',
    artifactName: 'registry/app:1.0.0',
    branch: 'main',
  } as any;

  const pkg = {
    id: 'pkg-1',
    projectId: 'p1',
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    target: 'registry/app:1.0.0 (debian 12.5)',
    class: 'os-pkgs',
    arch: 'x86_64',
  } as any;

  const osvStub = { id: 'CVE-2021-1234' } as any;
  const vulnDto = {
    vulnerabilityId: 'CVE-2021-1234',
    severity: 'high',
    fixedVersion: '1.1.1l',
  } as any;

  beforeEach(async () => {
    detRepo = createMockRepository();
    histRepo = createMockRepository();
    pkgRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: pkgRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: histRepo },
        {
          provide: getRepositoryToken(VulnerabilityOsv),
          useValue: createMockRepository(),
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn(),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', priorityScore: 0.5 }),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 8.1 }),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ContainerService);
    detRepo.save!.mockImplementation(async (x: any) => x);
    histRepo.save!.mockImplementation(async (x: any) => x);
    histRepo.create!.mockImplementation((x: any) => x);
  });

  // ── handleUpdateContainer ─────────────────────────────────────────

  it('handleUpdateContainer stamps the triage on the same clock as its history rows', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      status: 'ignored',
      comment: 'accepted risk',
      // An `ignored` now REQUIRES a reason. `comment` is NOT it: a
      // comment is free-form and may accompany any status, the reason is the
      // auditable justification for this one transition.
      dismissalReason: 'accepted risk — base image pinned by policy',
    } as any);

    expect(vuln.triagedByType).toBe('user');
    expect(vuln.triagedBy).toBe('u1');
    const statusRow = vuln.historyItems.find(
      (h: any) => h.type === 'status_change',
    );
    expect(statusRow).toBeDefined();
    // backfill-lifecycle.ts joins a dismissal comment to its transition on
    // equality to the second; a second clock here would break that join.
    expect(vuln.triagedAt).toBe(statusRow.date);
  });

  // ── the dismissal guard is WIRED into handleUpdateContainer ──
  //
  // Container matters more than the rest here: it has no
  // `vulnerability_detection_history` trail, so an unjustified dismissal on
  // this family is unrecoverable — there is nothing for backfill-lifecycle.ts
  // to reconstruct a reason from.

  it('handleUpdateContainer refuses an ignore with no reason and writes nothing', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
      triagedAt: null,
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await expect(
      service.handleUpdateContainer(vuln, {
        projectId: 'p1',
        vulnerabilityId: 'v1',
        userId: 'u1',
        status: 'ignored',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }), // INVALID_ARGUMENT
    });

    expect(vuln.currentState).toBe('to_verify');
    expect(vuln.triagedAt).toBeNull();
    expect(vuln.historyItems).toHaveLength(0);
    expect(detRepo.save).not.toHaveBeenCalled();
  });

  it('handleUpdateContainer refuses an ignore whose reason is only whitespace', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await expect(
      service.handleUpdateContainer(vuln, {
        projectId: 'p1',
        vulnerabilityId: 'v1',
        userId: 'u1',
        status: 'ignored',
        dismissalReason: '   ',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }),
    });
  });

  it('handleUpdateContainer persists the dismissal reason it was given', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      status: 'ignored',
      dismissalReason: 'accepted risk',
    } as any);

    expect(vuln.currentState).toBe('ignored');
    expect(vuln.dismissalReason).toBe('accepted risk');
  });

  it('handleUpdateContainer sets resolved_at when the analyst resolves', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      status: 'resolved',
    } as any);

    expect(vuln.resolvedAt).toBe(vuln.triagedAt);
  });

  it('handleUpdateContainer leaves the lifecycle alone on a comment-only update', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
      triagedAt: null,
      triagedBy: null,
      triagedByType: null,
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      comment: 'just a note',
    } as any);

    expect(vuln.triagedAt).toBeNull();
    expect(vuln.triagedByType).toBeNull();
  });

  // ── upsertDetection (the family's sighting funnel) ────────────────

  const upsert = () =>
    (service as any).upsertDetection(
      'p1',
      image,
      pkg,
      osvStub,
      vulnDto,
      'main',
    );

  it('stamps first/last_detected_at on a brand-new detection', async () => {
    detRepo.findOne!.mockResolvedValue(null);
    detRepo.create!.mockImplementation((e: any) => ({ ...e, id: 'det-new' }));

    const saved = await upsert();

    expect(saved.firstDetectedAt).toBeInstanceOf(Date);
    expect(saved.lastDetectedAt).toBe(saved.firstDetectedAt);
  });

  it('moves last_detected_at forward on re-detection without touching first_detected_at', async () => {
    const first = new Date('2026-01-01T00:00:00Z');
    const existing = {
      id: 'det-1',
      currentState: 'to_verify',
      fingerprint: null,
      firstDetectedAt: first,
      lastDetectedAt: first,
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert();

    expect(existing.firstDetectedAt).toBe(first);
    expect(existing.lastDetectedAt).not.toBe(first);
    expect(existing.lastDetectedAt.getTime()).toBeGreaterThan(first.getTime());
  });

  it('does not reset a stored triage when a scan re-detects the finding', async () => {
    const triagedAt = new Date('2026-02-02T00:00:00Z');
    const existing = {
      id: 'det-1',
      currentState: 'ignored',
      stateManuallyModified: true,
      fingerprint: null,
      firstDetectedAt: triagedAt,
      lastDetectedAt: triagedAt,
      triagedAt,
      triagedBy: 'u1',
      triagedByType: 'user',
      dismissalReason: 'accepted risk',
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert();

    expect(existing.triagedAt).toBe(triagedAt);
    expect(existing.triagedBy).toBe('u1');
    expect(existing.triagedByType).toBe('user');
    expect(existing.dismissalReason).toBe('accepted risk');
  });

  it('drops resolved_at when a resolved detection reappears', async () => {
    const existing = {
      id: 'det-1',
      currentState: 'resolved',
      fingerprint: null,
      firstDetectedAt: new Date('2026-01-01T00:00:00Z'),
      lastDetectedAt: new Date('2026-01-01T00:00:00Z'),
      resolvedAt: new Date('2026-01-05T00:00:00Z'),
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert();

    expect(existing.currentState).toBe('to_verify');
    expect(existing.resolvedAt).toBeNull();
  });

  // ── markMissingPackagesResolved (auto-resolve) ────────────────────

  it('files the auto-resolve as the machine, on the detection and on its history row', async () => {
    pkgRepo.find!.mockResolvedValue([
      { id: 'pkg-gone', packageName: 'left-pad', packageVersion: '1.0.0' },
    ]);
    const det = { id: 'det-1', currentState: 'to_verify' } as any;
    detRepo.find!.mockResolvedValue([det]);

    await (service as any).markMissingPackagesResolved(image, 'scan-2', 'main');

    expect(det.currentState).toBe('resolved');
    expect(det.triagedByType).toBe('system');
    expect(det.triagedBy).toBeNull();
    expect(det.resolvedAt).toEqual(det.triagedAt);

    // A null userId with no source reads as "unknown user" downstream; saying
    // 'system' out loud is what stops that for every future row.
    const historyRow = histRepo.save!.mock.calls[0][0];
    expect(historyRow.source).toBe('system');
  });

  /**
   * Resolving a finding does not merely change its state: it overwrites
   * `triaged_by`, `triaged_by_type` and `dismissal_reason` with the machine's
   * own. For a dismissal that loses the justification for good: container has
   * no `vulnerability_detection_history` trail, and its reason lives on the
   * detection alone. A confirm carries no justification, and the person who
   * confirmed stays on the `status_change` row their triage wrote.
   */
  const autoResolve = (det: any) => {
    pkgRepo.find!.mockResolvedValue([
      { id: 'pkg-gone', packageName: 'left-pad', packageVersion: '1.0.0' },
    ]);
    detRepo.find!.mockResolvedValue([det]);
    return (service as any).markMissingPackagesResolved(
      image,
      'scan-2',
      'main',
    );
  };

  it('leaves a human-ignored finding alone when its package disappears', async () => {
    const triagedAt = new Date('2026-02-02T00:00:00Z');
    const det = {
      id: 'det-1',
      currentState: 'ignored',
      stateManuallyModified: true,
      triagedAt,
      triagedBy: 'u1',
      triagedByType: 'user',
      dismissalReason: 'accepted risk',
    } as any;

    await autoResolve(det);

    expect(det.currentState).toBe('ignored');
    expect(det.triagedBy).toBe('u1');
    expect(det.triagedByType).toBe('user');
    expect(det.dismissalReason).toBe('accepted risk');
    expect(det.resolvedAt).toBeUndefined();
    expect(histRepo.save).not.toHaveBeenCalled();
  });

  it('closes a human-confirmed finding as the machine when its package disappears', async () => {
    const det = {
      id: 'det-1',
      currentState: 'confirmed',
      stateManuallyModified: true,
      triagedBy: 'u1',
      triagedByType: 'user',
    } as any;

    await autoResolve(det);

    expect(det.currentState).toBe('resolved');
    expect(det.triagedByType).toBe('system');
    expect(det.triagedBy).toBeNull();
    expect(detRepo.save).toHaveBeenCalledWith(det);
    expect(histRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status_change',
        value: 'resolved',
        source: 'system',
      }),
    );
  });

  it('keeps the confirm row of a finding it closes', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });
    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      status: 'confirmed',
    } as any);

    await autoResolve(vuln);

    expect(vuln.currentState).toBe('resolved');
    // The confirm row is the family's only record of who confirmed: the
    // auto-resolve appends its own row and leaves that one as it was.
    expect(vuln.historyItems).toEqual([
      expect.objectContaining({
        type: 'status_change',
        value: 'confirmed',
        userId: 'u1',
      }),
    ]);
    const saves = histRepo.save!.mock.calls;
    const machineRow = saves[saves.length - 1][0];
    expect(machineRow).toMatchObject({ value: 'resolved', source: 'system' });
    expect(machineRow.userId).toBeUndefined();
  });

  // ── the freeze flag itself ────────────────────────────────────────

  it.each([
    ['confirmed', true],
    ['ignored', true],
    // `to_verify` is the undecided, scan-managed state the modal offers to
    // revert an accidental confirm: it records no decision to freeze.
    ['to_verify', false],
  ])(
    'handleUpdateContainer records status=%p as manually modified: %p',
    async (statusValue, expected) => {
      const vuln = {
        id: 'v1',
        historyItems: [],
        currentState: 'resolved',
        currentPriority: 'normal',
      } as any;
      jest
        .spyOn(service as any, 'getContainerVulnerabilityById')
        .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

      await service.handleUpdateContainer(vuln, {
        projectId: 'p1',
        vulnerabilityId: 'v1',
        userId: 'u1',
        status: statusValue,
        // The subject here is stateManuallyModified, not the dismissal rule.
        // Supplied unconditionally so the 'ignored' row of this table satisfies
        // assertDismissalReason; every other status ignores it.
        dismissalReason: 'fixture: not the subject of this test',
      } as any);

      expect(vuln.stateManuallyModified).toBe(expected);
    },
  );

  it('drops the freeze when a manually resolved finding is detected again', async () => {
    const existing = {
      id: 'det-1',
      currentState: 'resolved',
      stateManuallyModified: true,
      fingerprint: null,
      firstDetectedAt: new Date('2026-01-01T00:00:00Z'),
      lastDetectedAt: new Date('2026-01-01T00:00:00Z'),
    } as any;
    detRepo.findOne!.mockResolvedValue(existing);

    await upsert();

    expect(existing.currentState).toBe('to_verify');
    expect(existing.stateManuallyModified).toBe(false);
  });
});
