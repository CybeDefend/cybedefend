import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultService } from './result.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { HistoryItem as HistoryItemEntity } from '../../entities/history-item.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ContainerService } from '../container/container.service';
import { ScaService } from '../sca/sca.service';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { CyberRiskService } from '../cyber-risk/cyber-risk.service';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ActiveVulnFetcher } from '../cyber-risk/active-vuln-fetcher.service';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { OrganizationOverviewService } from './organization-overview.service';
import { PriorityCalculatorService } from './priority-calculator.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import {
  BatchUpdateResultRequest,
  UpdateResultRequest,
} from '@grpc/analysis-reporting/result';
import { createMockRepository } from '../../test-utils/typeorm-mock.util';

/**
 * A finding a person or the agent resolves, ignores or reverts is
 * reported to Linear, whose external-integrations side closes, comments on or
 * reopens the ticket that tracks it. The status change never waits for
 * Linear and never fails because of it.
 */
describe('ResultService — handled findings reported to Linear', () => {
  let service: ResultService;
  let sastFindOne: jest.Mock;
  let handleUpdateSast: jest.Mock;
  let syncLinearFindingStates: jest.Mock;

  beforeEach(async () => {
    // Every id is a SAST finding of the project; the container lookup, which
    // runs first, finds nothing (createMockRepository answers undefined).
    sastFindOne = jest.fn(
      ({ where }: { where: { id: string; projectId: string } }) =>
        Promise.resolve({ id: where.id, projectId: where.projectId }),
    );
    handleUpdateSast = jest.fn((vuln: { id: string; projectId: string }) =>
      Promise.resolve({ projectId: vuln.projectId, vulnerabilityId: vuln.id }),
    );
    syncLinearFindingStates = jest.fn().mockResolvedValue(undefined);

    const repositories = [
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      SecretVulnerabilityDetections,
      ScaVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
      ScaDetectedPackages,
      ContainerDetectedImage,
      ContainerDetectedPackage,
      HistoryItemEntity,
      AutoFixRecord,
    ].map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: createMockRepository(),
    }));
    // Not used by a status update: inert stubs, for DI only.
    const unused = [
      ContainerService,
      ScaService,
      SastIacService,
      OrganizationOverviewService,
      PriorityCalculatorService,
      CvssCalculatorService,
      CvssExplainerService,
      SecurityContextCacheService,
      CyberRiskService,
      ProjectCyberRiskRepository,
      ActiveVulnFetcher,
      ReferenceBranchResolver,
      CyberiskRecomputeEnqueuer,
    ].map((token) => ({ provide: token, useValue: {} }));
    const clients = [
      'SECURITY_SCANNING_SERVICE',
      'AGENT_SERVICE',
      'BILLING_SERVICE',
      'GLOBAL_MANAGEMENT_SERVICE',
    ].map((token) => ({
      provide: token,
      useValue: { getService: () => ({}) },
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResultService,
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: { ...createMockRepository(), findOne: sastFindOne },
        },
        ...repositories,
        ...unused,
        ...clients,
        { provide: SastIacUtilsService, useValue: { handleUpdateSast } },
        {
          provide: IssueIntegrationService,
          useValue: { syncLinearFindingStates },
        },
      ],
    }).compile();

    service = moduleRef.get(ResultService);
  });

  const update = (fields: Partial<UpdateResultRequest>): UpdateResultRequest =>
    ({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      status: '',
      priority: '',
      comment: '',
      dismissalReason: '',
      ...fields,
    }) as UpdateResultRequest;

  it('updateScanResult reports a manual resolve, ignore and revert without waiting for Linear', async () => {
    // Linear never answers: the updates below must still complete.
    syncLinearFindingStates.mockReturnValue(new Promise(() => undefined));

    await expect(
      service.updateScanResult(
        update({ vulnerabilityId: 'v1', status: 'resolved' }),
      ),
    ).resolves.toEqual({ projectId: 'p1', vulnerabilityId: 'v1' });
    await service.updateScanResult(
      update({
        vulnerabilityId: 'v2',
        status: 'ignored',
        dismissalReason: 'Test fixture, never deployed',
      }),
    );
    await service.updateScanResult(
      update({ vulnerabilityId: 'v3', status: 'to_verify' }),
    );
    await service.updateScanResult(
      update({ vulnerabilityId: 'v4', status: 'confirmed' }),
    );

    expect(syncLinearFindingStates.mock.calls).toEqual([
      ['p1', ['v1'], 'fixed', undefined],
      ['p1', ['v2'], 'ignored', 'Test fixture, never deployed'],
      ['p1', ['v3'], 'reopened', undefined],
      ['p1', ['v4'], 'reopened', undefined],
    ]);
  });

  it('a Linear failure never fails the update, and is logged', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    syncLinearFindingStates.mockRejectedValueOnce(new Error('linear down'));
    await expect(
      service.updateScanResult(update({ status: 'resolved' })),
    ).resolves.toEqual({ projectId: 'p1', vulnerabilityId: 'v1' });

    syncLinearFindingStates.mockImplementationOnce(() => {
      throw new Error('client not ready');
    });
    await expect(
      service.updateScanResult(update({ status: 'resolved' })),
    ).resolves.toEqual({ projectId: 'p1', vulnerabilityId: 'v1' });

    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('linear down'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('client not ready'),
    );
    warn.mockRestore();
  });

  it('updateScanResult sends nothing when the status does not change the outcome', async () => {
    await service.updateScanResult(update({ priority: 'urgent' }));
    await service.updateScanResult(update({ comment: 'Looked at it' }));
    await service.updateScanResult(update({ status: undefined }));

    expect(handleUpdateSast).toHaveBeenCalledTimes(3);
    expect(syncLinearFindingStates).not.toHaveBeenCalled();
  });

  it('sends nothing when the update itself fails', async () => {
    handleUpdateSast.mockRejectedValueOnce(new Error('deadlock'));

    await expect(
      service.updateScanResult(update({ status: 'resolved' })),
    ).rejects.toBeDefined();
    expect(syncLinearFindingStates).not.toHaveBeenCalled();
  });

  /**
   * Review Focus 3: the dashboard's or the agent's bulk dismissal of 50
   * findings of one ticket makes one comment and one closing, not 50.
   */
  it('a batch update sends one call per outcome after the batch', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `v${i + 1}`);
    const callsDuringTheLoop: number[] = [];
    const request: BatchUpdateResultRequest = {
      projectId: 'p1',
      userId: 'u1',
      items: ids.map((vulnerabilityId) => ({
        vulnerabilityId,
        status: 'ignored',
        priority: '',
        comment: '',
        dismissalReason: 'Accepted risk',
      })),
    } as BatchUpdateResultRequest;

    const response = await service.applyBatchUpdate(request, () => {
      callsDuringTheLoop.push(syncLinearFindingStates.mock.calls.length);
    });

    expect(response.successCount).toBe(50);
    expect(callsDuringTheLoop).toHaveLength(50);
    expect(callsDuringTheLoop.every((count) => count === 0)).toBe(true);
    expect(syncLinearFindingStates).toHaveBeenCalledTimes(1);
    expect(syncLinearFindingStates).toHaveBeenCalledWith(
      'p1',
      ids,
      'ignored',
      'Accepted risk',
    );
  });

  it('a batch groups its findings by outcome and reason, and leaves out the ones that failed', async () => {
    handleUpdateSast.mockImplementation((vuln: { id: string }) =>
      vuln.id === 'v-broken'
        ? Promise.reject(new Error('deadlock'))
        : Promise.resolve({ projectId: 'p1', vulnerabilityId: vuln.id }),
    );
    const item = (
      vulnerabilityId: string,
      status: string,
      dismissalReason = '',
    ) => ({
      vulnerabilityId,
      status,
      priority: '',
      comment: '',
      dismissalReason,
    });
    const request = {
      projectId: 'p1',
      userId: 'u1',
      items: [
        item('v1', 'resolved'),
        item('v2', 'ignored', 'Accepted risk'),
        item('v3', 'resolved'),
        item('v-broken', 'resolved'),
        item('v4', 'ignored', 'Test code'),
        item('v5', 'to_verify'),
        item('v6', 'confirmed'),
        { ...item('v7', ''), priority: 'urgent' },
      ],
    } as BatchUpdateResultRequest;

    const response = await service.applyBatchUpdate(request);

    expect(response.failureCount).toBe(1);
    expect(syncLinearFindingStates.mock.calls).toEqual(
      expect.arrayContaining([
        ['p1', ['v1', 'v3'], 'fixed', undefined],
        ['p1', ['v2'], 'ignored', 'Accepted risk'],
        ['p1', ['v4'], 'ignored', 'Test code'],
        ['p1', ['v5', 'v6'], 'reopened', undefined],
      ]),
    );
    expect(syncLinearFindingStates).toHaveBeenCalledTimes(4);
  });
});
