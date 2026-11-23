import { Logger } from 'nestjs-pino';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

/**
 * Tenant scoping of policies.
 *
 * The gateway resolves `organizationId` / `projectId` from the guard-verified
 * path and must forward them into the gRPC requests so policy-management can
 * scope every lookup by tenant. These tests lock in that forwarding.
 */
describe('Gateway PolicyController - tenant scoping', () => {
  let controller: PolicyController;
  let policyService: {
    getPolicy: jest.Mock;
    updatePolicy: jest.Mock;
    exportPolicyYaml: jest.Mock;
    getScanViolations: jest.Mock;
  };

  const organizationId = '11111111-1111-1111-1111-111111111111';
  const projectId = 'pppppppp-pppp-pppp-pppp-pppppppppppp';
  const policyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const scanId = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
  const userSub = '22222222-2222-2222-2222-222222222222';

  const fakeProtoPolicy = {
    id: policyId,
    scope: 1,
    organizationId,
    projectIds: [],
    teamIds: [],
    name: 'p',
    description: '',
    priority: 1,
    configJson: JSON.stringify({ rules: [], exclusions: [] }),
    isEnabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: userSub,
    updatedBy: userSub,
  };

  beforeEach(() => {
    policyService = {
      getPolicy: jest.fn().mockResolvedValue({ policy: fakeProtoPolicy }),
      updatePolicy: jest.fn().mockResolvedValue({ policy: fakeProtoPolicy }),
      exportPolicyYaml: jest
        .fn()
        .mockResolvedValue({ yamlContent: 'yaml: content' }),
      getScanViolations: jest
        .fn()
        .mockResolvedValue({ violations: [], total: 0, page: 1, pageSize: 50 }),
    };

    const logger = { log: jest.fn() } as unknown as Logger;

    controller = new PolicyController(
      policyService as unknown as PolicyService,
      logger,
    );
  });

  it('getPolicy forwards organizationId', async () => {
    await controller.getPolicy(organizationId, policyId);

    expect(policyService.getPolicy).toHaveBeenCalledWith({
      policyId,
      organizationId,
    });
  });

  it('updatePolicy forwards organizationId', async () => {
    await controller.updatePolicy(
      organizationId,
      policyId,
      { yamlContent: 'y' },
      { user: { sub: userSub } },
    );

    expect(policyService.updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ policyId, organizationId }),
    );
  });

  it('exportPolicyYaml forwards organizationId', async () => {
    await controller.exportPolicyYaml(organizationId, policyId);

    expect(policyService.exportPolicyYaml).toHaveBeenCalledWith({
      policyId,
      organizationId,
    });
  });

  it('getScanViolations forwards projectId', async () => {
    await controller.getScanViolations(projectId, scanId, 1, 50);

    expect(policyService.getScanViolations).toHaveBeenCalledWith(
      expect.objectContaining({ scanId, projectId }),
    );
  });
});

/**
 * The organization compliance overview aggregates
 * the violations of every project global-management lets the caller READ
 * (GetReadableProjectsInOrganization: org creator/administrator see every
 * project, anyone else the projects of their teams, read_only included). The
 * per-project violation routes require read_policy_violation, which read_only
 * does not hold. The overview stays within that scope only because it requires
 * manage_policy (creator/administrator: every project anyway). Opening it to
 * read_policy or to a manager would show violation counts of projects whose
 * violations that user may not read: change policy-management's scope first.
 */
describe('Gateway PolicyController - compliance overview gate', () => {
  it('keeps the organization compliance overview behind manage_policy', () => {
    const handler =
      PolicyController.prototype.getOrganizationComplianceOverview;

    expect(Reflect.getMetadata('permissions', handler)).toEqual([
      'manage_policy',
    ]);
    expect(Reflect.getMetadata('subjectTypes', handler)).toEqual([
      'organization',
    ]);
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    expect(guards).toContain(PermissionsGuard);
  });
});
