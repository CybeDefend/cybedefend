import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyYamlService } from './policy-yaml.service';
import { SecurityPolicy, PolicyScope } from '@entities/security-policy.entity';

/**
 * Tenant isolation of policies.
 *
 * The gRPC controller must forward the org scope carried on the request down
 * to the tenant-scoped service methods (`getPolicyForOrganization` /
 * `updatePolicyFromYaml`), never the removed unscoped `getPolicy(id)`.
 */
describe('PolicyController - inter-org tenant isolation', () => {
  let controller: PolicyController;
  let policyService: {
    getPolicyForOrganization: jest.Mock;
    updatePolicyFromYaml: jest.Mock;
    getPolicy: jest.Mock;
  };
  let yamlService: { exportToYaml: jest.Mock };

  const organizationId = '11111111-1111-1111-1111-111111111111';
  const policyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const fakePolicy = {
    id: policyId,
    scope: PolicyScope.ORGANIZATION,
    organizationId,
    projectIds: [],
    teamIds: [],
    name: 'p',
    description: '',
    priority: 1,
    rules: { rules: [], exclusions: [] },
    exclusions: [],
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'u',
    updatedBy: 'u',
  } as unknown as SecurityPolicy;

  beforeEach(() => {
    policyService = {
      getPolicyForOrganization: jest.fn().mockResolvedValue(fakePolicy),
      updatePolicyFromYaml: jest.fn().mockResolvedValue(fakePolicy),
      // Present only so we can assert it is NEVER used by the read paths.
      getPolicy: jest.fn(),
    };
    yamlService = { exportToYaml: jest.fn().mockReturnValue('yaml: content') };

    controller = new PolicyController(
      policyService as unknown as PolicyService,
      {} as unknown as PolicyValidationService,
      yamlService as unknown as PolicyYamlService,
    );
  });

  it('getPolicy resolves via the org-scoped lookup', async () => {
    await controller.getPolicy({ policyId, organizationId });

    expect(policyService.getPolicyForOrganization).toHaveBeenCalledWith(
      policyId,
      organizationId,
    );
    expect(policyService.getPolicy).not.toHaveBeenCalled();
  });

  it('exportPolicyYaml resolves via the org-scoped lookup', async () => {
    await controller.exportPolicyYaml({ policyId, organizationId });

    expect(policyService.getPolicyForOrganization).toHaveBeenCalledWith(
      policyId,
      organizationId,
    );
    expect(policyService.getPolicy).not.toHaveBeenCalled();
  });

  it('updatePolicy forwards organizationId to the service for scoping', async () => {
    await controller.updatePolicy({
      policyId,
      organizationId,
      yamlContent: 'y',
      updatedBy: 'u',
    });

    expect(policyService.updatePolicyFromYaml).toHaveBeenCalledWith(
      expect.objectContaining({ policyId, organizationId }),
    );
  });
});
