import { RpcException } from '@nestjs/microservices';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { status as GrpcStatus } from '@grpc/grpc-js';

import type { EntitlementsPort } from '../../edition/ports/entitlements.port';
import { ISSUE_TRACKER_FEATURE } from '../issue/issue-tracker-feature';
import { LinearFindingStatesService } from './linear-finding-states.service';
import { LinearIssueService } from './linear-issue.service';
import { LinearIssueController } from './linear-issue.controller';

/**
 * The plan gate of Linear issue creation. Plans disable the issue
 * trackers under ONE billing key, `jira` (`features_disabled`, billing's
 * `getMinPlanForFeature`), which now covers Jira and Linear: a plan without
 * Jira has no Linear either. Only the two calls that put a ticket in a tracker
 * on the user's or the scan's behalf are gated, as Jira's are; reading the
 * project's tickets, syncing their status and the state sync analysis-reporting
 * sends when a finding is resolved or dismissed are not, so an organisation
 * that loses the feature does not leave its open tickets stale.
 */
describe('LinearIssueController plan gate', () => {
  const ORG = 'org-1';
  let billing: { assertFeatureAllowed: jest.Mock };
  let issues: {
    createIssues: jest.Mock;
    linkExistingIssue: jest.Mock;
    getProjectIssues: jest.Mock;
    syncIssueStatus: jest.Mock;
  };
  let findingStates: { applyFindingStates: jest.Mock };
  let controller: LinearIssueController;

  const denied = () =>
    new RpcException({
      code: GrpcStatus.PERMISSION_DENIED,
      message: 'Feature "jira" is not available on your current plan.',
    });

  beforeEach(() => {
    billing = { assertFeatureAllowed: jest.fn().mockResolvedValue(undefined) };
    issues = {
      createIssues: jest.fn().mockResolvedValue({ ok: 'create' }),
      linkExistingIssue: jest.fn().mockResolvedValue({ ok: 'link' }),
      getProjectIssues: jest.fn().mockResolvedValue({ ok: 'list' }),
      syncIssueStatus: jest.fn().mockResolvedValue({ ok: 'sync' }),
    };
    findingStates = {
      applyFindingStates: jest.fn().mockResolvedValue({ ok: 'states' }),
    };
    controller = new LinearIssueController(
      issues as unknown as LinearIssueService,
      findingStates as unknown as LinearFindingStatesService,
      billing as unknown as EntitlementsPort,
    );
  });

  it("uses the plans' `jira` key, shared by Jira and Linear", () => {
    expect(ISSUE_TRACKER_FEATURE).toBe('jira');
  });

  it('checks Linear issue creation against the issue tracker feature, then creates', async () => {
    const request = { organizationId: ORG, projectId: 'p1' } as any;

    const out = await controller.createIssues(request);

    expect(billing.assertFeatureAllowed).toHaveBeenCalledWith(
      ORG,
      ISSUE_TRACKER_FEATURE,
    );
    expect(issues.createIssues).toHaveBeenCalledWith(request);
    expect(out).toEqual({ ok: 'create' });
  });

  it('checks linking a Linear issue against the issue tracker feature, then links', async () => {
    const request = {
      organizationId: ORG,
      projectId: 'p1',
      issueRef: 'ENG-142',
    } as any;

    const out = await controller.linkExistingIssue(request);

    expect(billing.assertFeatureAllowed).toHaveBeenCalledWith(
      ORG,
      ISSUE_TRACKER_FEATURE,
    );
    expect(issues.linkExistingIssue).toHaveBeenCalledWith(request);
    expect(out).toEqual({ ok: 'link' });
  });

  it('CreateIssues and LinkExistingIssue are refused when the plan lacks the issue tracker feature', async () => {
    billing.assertFeatureAllowed.mockRejectedValue(denied());

    await expect(
      controller.createIssues({ organizationId: ORG, projectId: 'p1' } as any),
    ).rejects.toBeInstanceOf(RpcException);
    await expect(
      controller.linkExistingIssue({
        organizationId: ORG,
        projectId: 'p1',
        issueRef: 'ENG-142',
      } as any),
    ).rejects.toBeInstanceOf(RpcException);

    // Refused before any Linear call or database write.
    expect(issues.createIssues).not.toHaveBeenCalled();
    expect(issues.linkExistingIssue).not.toHaveBeenCalled();
  });

  it('GetProjectIssues, SyncIssueStatus and ApplyFindingStates are not gated', async () => {
    billing.assertFeatureAllowed.mockRejectedValue(denied());

    await expect(
      controller.getProjectIssues({
        organizationId: ORG,
        projectId: 'p1',
      } as any),
    ).resolves.toEqual({ ok: 'list' });
    await expect(
      controller.syncIssueStatus({
        organizationId: ORG,
        projectId: 'p1',
      } as any),
    ).resolves.toEqual({ ok: 'sync' });
    await expect(
      controller.applyFindingStates({
        organizationId: ORG,
        projectId: 'p1',
      } as any),
    ).resolves.toEqual({ ok: 'states' });

    expect(billing.assertFeatureAllowed).not.toHaveBeenCalled();
  });

  it('hands each ungated call to the service that owns it, request unchanged', async () => {
    const list = { projectId: 'p1' } as any;
    const sync = { projectId: 'p1' } as any;
    const states = { projectId: 'p1', outcome: 'resolved' } as any;

    await controller.getProjectIssues(list);
    await controller.syncIssueStatus(sync);
    await controller.applyFindingStates(states);

    expect(issues.getProjectIssues).toHaveBeenCalledWith(list);
    expect(issues.syncIssueStatus).toHaveBeenCalledWith(sync);
    expect(findingStates.applyFindingStates).toHaveBeenCalledWith(states);
  });

  // A handler registered under another service name, or not at all, serves
  // nothing and fails only in a pod, on the first call.
  it('serves the five LinearIssueService RPCs', () => {
    const handlers = [
      'createIssues',
      'linkExistingIssue',
      'getProjectIssues',
      'syncIssueStatus',
      'applyFindingStates',
    ];
    const served = handlers.map((method) =>
      Reflect.getMetadata(
        PATTERN_METADATA,
        (LinearIssueController.prototype as any)[method],
      ),
    );

    expect(served).toEqual(
      handlers.map((rpc) => [
        { service: 'LinearIssueService', rpc, streaming: 'no_stream' },
      ]),
    );
  });
});
