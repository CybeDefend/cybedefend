import { join } from 'path';
import * as protoLoader from '@grpc/proto-loader';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyYamlService } from './policy-yaml.service';
import { PolicyScope } from '@entities/security-policy.entity';
import { ListPoliciesRequest } from '@core/grpc/policy-management/policy';

/**
 * ListPolicies filters on the scope the gateway sends.
 *
 * The request is decoded here as the service decodes it (the loader options
 * of main.ts, `enums: String`): an enum arrives as its NAME, e.g.
 * 'POLICY_SCOPE_ORGANIZATION', never as a number. The former mapping only
 * knew numbers and filtered every scope as PROJECT.
 */
describe('PolicyController.listPolicies — scope filter', () => {
  const protoBasePath = join(__dirname, '../../../../../libs/protos');
  const definition = protoLoader.loadSync(
    join(protoBasePath, 'policy-management/policy_management.proto'),
    {
      includeDirs: [protoBasePath],
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    },
  );
  const service = Object.values(definition).find(
    (d) => 'ListPolicies' in d,
  ) as protoLoader.ServiceDefinition;
  const method = service.ListPolicies;

  /** What the service receives for a request the gateway encoded. */
  const asReceived = (request: Record<string, unknown>): ListPoliciesRequest =>
    method.requestDeserialize(
      method.requestSerialize(request),
    ) as ListPoliciesRequest;

  let controller: PolicyController;
  let policyService: { listPolicies: jest.Mock };

  beforeEach(() => {
    policyService = {
      listPolicies: jest
        .fn()
        .mockResolvedValue({ policies: [], total: 0, page: 1, pageSize: 20 }),
    };
    controller = new PolicyController(
      policyService as unknown as PolicyService,
      {} as unknown as PolicyValidationService,
      {} as unknown as PolicyYamlService,
    );
  });

  it.each([
    [1, PolicyScope.ORGANIZATION],
    [2, PolicyScope.TEAM],
    [3, PolicyScope.PROJECT],
  ])('filters the proto scope %s as %s', async (scope, expected) => {
    await controller.listPolicies(
      asReceived({ organizationId: 'org-1', scope, page: 1, pageSize: 20 }),
    );

    expect(policyService.listPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expected }),
    );
  });

  it.each([
    ['no scope', {}],
    ['an unspecified scope', { scope: 0 }],
  ])('does not filter on the scope for %s', async (_label, extra) => {
    await controller.listPolicies(
      asReceived({ organizationId: 'org-1', page: 1, pageSize: 20, ...extra }),
    );

    expect(policyService.listPolicies.mock.calls[0][0].scope).toBeUndefined();
  });

  it('keeps an explicit isEnabled=false', async () => {
    await controller.listPolicies(
      asReceived({ organizationId: 'org-1', isEnabled: false, page: 1 }),
    );

    expect(policyService.listPolicies.mock.calls[0][0].isEnabled).toBe(false);
  });
});
