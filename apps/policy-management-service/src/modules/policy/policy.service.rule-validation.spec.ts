import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { PolicyService } from './policy.service';
import { PolicyYamlService } from './policy-yaml.service';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyController } from './policy.controller';
import { SecurityPolicy } from '@entities/security-policy.entity';

/**
 * Create and update run the same rule validation as the validate route, so a
 * policy whose rules can never match (or whose priority does not fit the
 * column) is refused with INVALID_ARGUMENT instead of being stored.
 */
describe('PolicyService - create and update validate the policy', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';
  let service: PolicyService;
  let controller: PolicyController;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  const yaml = (extra: {
    rule?: string;
    header?: string;
    scope?: string;
    version?: string;
  }): string =>
    [
      `version: ${extra.version ?? "'1.0'"}`,
      'name: p1',
      `scope: ${extra.scope ?? 'ORGANIZATION'}`,
      extra.header ?? '',
      'rules:',
      `  - ${extra.rule ?? '{name: r, type: severity, operator: gte, value: HIGH, action: block}'}`,
    ]
      .filter((line) => line !== '')
      .join('\n');

  const existing = (): SecurityPolicy =>
    ({
      id: 'pol-1',
      organizationId: orgId,
      name: 'p1',
      scope: 'ORGANIZATION',
      isEnabled: true,
    }) as unknown as SecurityPolicy;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'pol-1', ...v })),
    };
    const module = await Test.createTestingModule({
      controllers: [PolicyController],
      providers: [
        PolicyService,
        PolicyYamlService,
        PolicyValidationService,
        { provide: getRepositoryToken(SecurityPolicy), useValue: repo },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();
    service = module.get(PolicyService);
    controller = module.get(PolicyController);
  });

  const create = (yamlContent: string) =>
    service.createPolicyFromYaml({
      organizationId: orgId,
      yamlContent,
      createdBy: 'u1',
    });

  const update = (yamlContent: string) => {
    repo.findOne.mockImplementation(async ({ where }) =>
      where.id === 'pol-1' ? existing() : null,
    );
    return service.updatePolicyFromYaml({
      policyId: 'pol-1',
      organizationId: orgId,
      yamlContent,
      updatedBy: 'u1',
    });
  };

  const expectInvalid = async (
    promise: Promise<unknown>,
    message: RegExp,
  ): Promise<void> => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcException);
    const payload = (error as RpcException).getError() as {
      code: number;
      message: string;
    };
    expect(payload.code).toBe(GrpcStatus.INVALID_ARGUMENT);
    expect(payload.message).toMatch(message);
    expect(repo.save).not.toHaveBeenCalled();
  };

  const invalid: Array<[string, Parameters<typeof yaml>[0], RegExp]> = [
    [
      'a non-numeric cvss value',
      {
        rule: '{name: r, type: cvss_score, operator: gte, value: abc, action: block}',
      },
      /rules\[0\]\.value must be a number for CVSS score rules/,
    ],
    [
      'a cvss value above 10',
      {
        rule: '{name: r, type: cvss_score, operator: gte, value: 99, action: block}',
      },
      /rules\[0\]\.value for CVSS must be between 0 and 10/,
    ],
    [
      'an unknown severity',
      {
        rule: '{name: r, type: severity, operator: equals, value: BANANA, action: warn}',
      },
      /rules\[0\]\.value "BANANA" is not a recognized severity/,
    ],
    [
      'an unknown severity in a list',
      {
        rule: '{name: r, type: severity, operator: in, value: [HIGH, BANANA], action: warn}',
      },
      /rules\[0\]\.value\[1\] "BANANA" is not a recognized severity/,
    ],
    [
      'a negative age',
      {
        rule: '{name: r, type: vulnerability_age_days, operator: gt, value: -5, action: warn}',
      },
      /rules\[0\]\.value must be a non-negative number for age rules/,
    ],
    [
      'a composite rule without sub-rules',
      { rule: '{name: r, type: composite_and, value: 1, action: warn}' },
      /rules\[0\]\.criteria is required for composite rules/,
    ],
    [
      'an unsupported version',
      { version: "'9.9'" },
      /version '9\.9' is not supported/,
    ],
    [
      'projectIds on an ORGANIZATION policy',
      { header: `projectIds: [${projectId}]` },
      /projectIds is only allowed with PROJECT scope/,
    ],
    [
      'teamIds on an ORGANIZATION policy',
      { header: `teamIds: [${projectId}]` },
      /teamIds is only allowed with TEAM scope/,
    ],
    [
      'a priority below the 32-bit range',
      { header: 'priority: -99999999999' },
      /priority must be an integer between -2147483648 and 2147483647/,
    ],
    [
      'a priority above the 32-bit range',
      { header: 'priority: 3000000000' },
      /priority must be an integer between -2147483648 and 2147483647/,
    ],
    [
      'a fractional priority',
      { header: 'priority: 1.5' },
      /priority must be an integer/,
    ],
    [
      'a non-numeric priority',
      { header: 'priority: high' },
      /priority must be an integer/,
    ],
  ];

  describe('create', () => {
    it.each(invalid)('refuses %s', async (_label, parts, message) => {
      await expectInvalid(create(yaml(parts)), message);
    });

    it('stores a valid policy', async () => {
      await create(yaml({ header: 'priority: 10' }));
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.save.mock.calls[0][0].priority).toBe(10);
    });

    it('accepts the bounds of the 32-bit range', async () => {
      await create(yaml({ header: 'priority: 2147483647' }));
      await create(yaml({ header: 'priority: -2147483648' }));
      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        'lower case',
        '{name: r, type: severity, operator: gte, value: critical, action: block}',
      ],
      [
        'mixed case in a list',
        '{name: r, type: severity, operator: in, value: [critical, High], action: block}',
      ],
      [
        'surrounding spaces',
        '{name: r, type: severity, operator: equals, value: " high ", action: warn}',
      ],
      [
        'a lower-case value in a composite rule',
        '{name: r, type: composite_and, action: block, criteria: [{type: severity, operator: gte, value: high}, {type: scanner_type, operator: equals, value: sast}]}',
      ],
    ])(
      'accepts a known severity written in %s, as the evaluator matches it',
      async (_label, rule) => {
        await create(yaml({ rule }));
        expect(repo.save).toHaveBeenCalledTimes(1);
      },
    );

    it('accepts version 1.0 written as a number, and no version', async () => {
      await create(yaml({}).replace("version: '1.0'", 'version: 1.0'));
      await create(yaml({}).replace("version: '1.0'\n", ''));
      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it.each(invalid)('refuses %s', async (_label, parts, message) => {
      await expectInvalid(update(yaml(parts)), message);
    });

    it('stores a valid policy', async () => {
      await update(yaml({ header: 'priority: 10' }));
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('validate route', () => {
    it('reports the same priority error as create', async () => {
      const result = await controller.validatePolicy({
        organizationId: orgId,
        yamlContent: yaml({ header: 'priority: 3000000000' }),
      } as never);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(
        /priority must be an integer between -2147483648 and 2147483647/,
      );
    });

    it('reports an unknown severity as an error', async () => {
      const result = await controller.validatePolicy({
        organizationId: orgId,
        yamlContent: yaml({
          rule: '{name: r, type: severity, operator: equals, value: BANANA, action: warn}',
        }),
      } as never);
      expect(result.valid).toBe(false);
    });
  });
});
