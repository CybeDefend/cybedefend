import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { PolicyService } from './policy.service';
import { PolicyYamlService } from './policy-yaml.service';
import { PolicyValidationService } from './policy-validation.service';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { of } from 'rxjs';

describe('PolicyService - org-wide count/delete', () => {
  let service: PolicyService;
  let policyRepo: jest.Mocked<Repository<SecurityPolicy>>;

  const orgId = 'org-1';

  beforeEach(async () => {
    policyRepo = {
      count: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<Repository<SecurityPolicy>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        { provide: PolicyYamlService, useValue: {} },
        PolicyValidationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    service = module.get(PolicyService);
  });

  describe('countPoliciesForOrg', () => {
    it('returns the number of policies for the organization', async () => {
      (policyRepo.count as jest.Mock).mockResolvedValue(7);
      const result = await service.countPoliciesForOrg(orgId);
      expect(result).toBe(7);
      expect(policyRepo.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
    });

    it('returns 0 when org has no policies', async () => {
      (policyRepo.count as jest.Mock).mockResolvedValue(0);
      const result = await service.countPoliciesForOrg(orgId);
      expect(result).toBe(0);
    });
  });

  describe('deleteAllPoliciesForOrg', () => {
    it('deletes all policies for the organization and returns count', async () => {
      (policyRepo.delete as jest.Mock).mockResolvedValue({ affected: 5 });
      const result = await service.deleteAllPoliciesForOrg(orgId);
      expect(result).toBe(5);
      expect(policyRepo.delete).toHaveBeenCalledWith({
        organizationId: orgId,
      });
    });

    it('returns 0 when nothing to delete', async () => {
      (policyRepo.delete as jest.Mock).mockResolvedValue({ affected: 0 });
      const result = await service.deleteAllPoliciesForOrg(orgId);
      expect(result).toBe(0);
    });

    it('handles undefined affected (TypeORM may not always return a count)', async () => {
      (policyRepo.delete as jest.Mock).mockResolvedValue({
        affected: undefined,
      });
      const result = await service.deleteAllPoliciesForOrg(orgId);
      expect(result).toBe(0);
    });
  });
});

/**
 * Security: prevent unbounded composite_and / composite_or nesting that can
 * blow the BullMQ worker stack at evaluation time.
 *
 * The depth validation lives in PolicyYamlService.parseFullYaml, which is
 * invoked by both createPolicyFromYaml and updatePolicyFromYaml. We use the
 * real PolicyYamlService here so the test exercises the actual validator
 * traversal rather than a mock.
 */
describe('PolicyService - composite criteria depth guard', () => {
  let service: PolicyService;
  let policyRepo: jest.Mocked<Repository<SecurityPolicy>>;
  const orgId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  /**
   * Build a YAML policy whose single rule is a composite_and chain with
   * `depth` levels of nested composite_and.criteria, terminated by a leaf
   * severity criterion.
   */
  function buildDeepCriteriaYaml(depth: number): string {
    const lines: string[] = [
      'version: "1.0"',
      'name: deep-criteria',
      'scope: ORGANIZATION',
      'priority: 20',
      'enabled: false',
      'rules:',
      '  - name: deep',
      '    type: composite_and',
      '    action: block',
      '    criteria:',
    ];
    let indent = '      ';
    for (let i = 0; i < depth; i++) {
      lines.push(`${indent}- type: composite_and`);
      lines.push(`${indent}  criteria:`);
      indent += '  ';
    }
    lines.push(`${indent}- type: severity`);
    lines.push(`${indent}  operator: equals`);
    lines.push(`${indent}  value: CRITICAL`);
    return lines.join('\n');
  }

  beforeEach(async () => {
    policyRepo = {
      count: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      remove: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn().mockImplementation((p) => p),
    } as unknown as jest.Mocked<Repository<SecurityPolicy>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        PolicyYamlService,
        PolicyValidationService,
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    service = module.get(PolicyService);
  });

  it('rejects createPolicyFromYaml when criteria nesting exceeds the depth limit (50 levels)', async () => {
    const yamlContent = buildDeepCriteriaYaml(50);

    await expect(
      service.createPolicyFromYaml({
        organizationId: orgId,
        yamlContent,
        createdBy: userId,
      }),
    ).rejects.toBeInstanceOf(RpcException);

    expect(policyRepo.save).not.toHaveBeenCalled();
  });

  it('rejects updatePolicyFromYaml when criteria nesting exceeds the depth limit', async () => {
    // Existing policy in DB so the update path reaches yaml parsing
    (policyRepo.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'policy-1',
      organizationId: orgId,
      name: 'old-name',
      isEnabled: false,
    });

    const yamlContent = buildDeepCriteriaYaml(50);

    await expect(
      service.updatePolicyFromYaml({
        policyId: 'policy-1',
        organizationId: orgId,
        yamlContent,
        updatedBy: userId,
      }),
    ).rejects.toBeInstanceOf(RpcException);

    expect(policyRepo.save).not.toHaveBeenCalled();
  });

  it('accepts createPolicyFromYaml with a moderate criteria nesting (5 levels) — regression check', async () => {
    const yamlContent = buildDeepCriteriaYaml(5);

    await expect(
      service.createPolicyFromYaml({
        organizationId: orgId,
        yamlContent,
        createdBy: userId,
      }),
    ).resolves.toBeDefined();

    expect(policyRepo.save).toHaveBeenCalledTimes(1);
  });
});

/**
 * Tenant isolation of policies.
 *
 * The update and read-by-id paths scope the lookup by `organizationId`, like
 * `deletePolicy`/`togglePolicy`: a policy id of another organization is not
 * found.
 */
describe('PolicyService - inter-org tenant isolation', () => {
  let service: PolicyService;
  let policyRepo: jest.Mocked<Repository<SecurityPolicy>>;

  const ownerOrgId = '11111111-1111-1111-1111-111111111111';
  const attackerOrgId = '99999999-9999-9999-9999-999999999999';
  const policyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    policyRepo = {
      count: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<Repository<SecurityPolicy>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        { provide: PolicyYamlService, useValue: {} },
        PolicyValidationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    service = module.get(PolicyService);
  });

  describe('updatePolicyFromYaml', () => {
    it('scopes the lookup by organizationId and rejects a cross-tenant policyId', async () => {
      // Cross-tenant caller: the scoped findOne yields null even though the
      // UUID exists globally, so the update never touches the victim policy.
      (policyRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updatePolicyFromYaml({
          policyId,
          organizationId: attackerOrgId,
          yamlContent:
            "version: '1.0'\nname: pwned\nscope: ORGANIZATION\nenabled: false\nrules: []\n",
          updatedBy: userId,
        }),
      ).rejects.toBeInstanceOf(RpcException);

      expect(policyRepo.findOne).toHaveBeenCalledWith({
        where: { id: policyId, organizationId: attackerOrgId },
      });
      expect(policyRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getPolicyForOrganization', () => {
    it('scopes the lookup by organizationId and rejects a cross-tenant policyId', async () => {
      (policyRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getPolicyForOrganization(policyId, attackerOrgId),
      ).rejects.toBeInstanceOf(RpcException);

      expect(policyRepo.findOne).toHaveBeenCalledWith({
        where: { id: policyId, organizationId: attackerOrgId },
      });
    });

    it('returns the policy when it belongs to the caller organization', async () => {
      const policy = {
        id: policyId,
        organizationId: ownerOrgId,
      } as SecurityPolicy;
      (policyRepo.findOne as jest.Mock).mockResolvedValue(policy);

      await expect(
        service.getPolicyForOrganization(policyId, ownerOrgId),
      ).resolves.toBe(policy);
    });
  });
});

// The effective policy needs the project's organization and team.
// GetOrganizationIdByProjectId returns both, so no full ProjectService/Get
// (vulnerability count in analysis-reporting included) is paid for the team.
describe('PolicyService.getEffectivePolicy hierarchy resolution', () => {
  let service: PolicyService;
  let getOrganizationIdByProjectId: jest.Mock;
  let projectGet: jest.Mock;
  let teamQueryParams: Array<Record<string, unknown>>;

  const projectId = 'project-1';
  const qb = () => {
    const builder: Record<string, jest.Mock> = {};
    for (const m of ['where', 'orderBy']) {
      builder[m] = jest.fn(() => builder);
    }
    builder.andWhere = jest.fn(
      (_sql: string, params?: Record<string, unknown>) => {
        if (params) teamQueryParams.push(params);
        return builder;
      },
    );
    builder.getMany = jest.fn().mockResolvedValue([]);
    return builder;
  };

  beforeEach(async () => {
    teamQueryParams = [];
    const policyRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(qb),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        { provide: PolicyYamlService, useValue: {} },
        PolicyValidationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();
    service = module.get(PolicyService);

    getOrganizationIdByProjectId = jest.fn();
    projectGet = jest.fn();
    (service as any).organizationService = { getOrganizationIdByProjectId };
    (service as any).projectService = { get: projectGet };
  });

  const teamIdsQueried = () =>
    teamQueryParams
      .filter((p) => 'teamIds' in p)
      .map((p) => JSON.parse(p.teamIds as string));

  it('takes the team from GetOrganizationIdByProjectId, without ProjectService/Get', async () => {
    getOrganizationIdByProjectId.mockReturnValue(
      of({ organizationId: 'org-1', teamId: 'team-1' }),
    );

    await service.getEffectivePolicy(projectId);

    expect(getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    expect(projectGet).not.toHaveBeenCalled();
    expect(teamIdsQueried()).toEqual([['team-1']]);
  });

  // A global-management that predates the field omits it: read the team the
  // former way, with the lean ProjectService/Get.
  it('falls back to the lean ProjectService/Get when the response has no teamId', async () => {
    getOrganizationIdByProjectId.mockReturnValue(
      of({ organizationId: 'org-1' }),
    );
    projectGet.mockReturnValue(of({ teamId: 'team-2' }));

    await service.getEffectivePolicy(projectId);

    expect(projectGet).toHaveBeenCalledTimes(1);
    expect(projectGet).toHaveBeenCalledWith({
      projectId,
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    });
    expect(teamIdsQueried()).toEqual([['team-2']]);
  });
});
