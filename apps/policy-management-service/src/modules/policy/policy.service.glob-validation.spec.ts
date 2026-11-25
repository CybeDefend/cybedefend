import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { PolicyService } from './policy.service';
import { PolicyYamlService } from './policy-yaml.service';
import { PolicyValidationService } from './policy-validation.service';
import { SecurityPolicy } from '@entities/security-policy.entity';

/**
 * Exclusion patterns and branch patterns are matched against every finding
 * of every evaluation. A new pattern that cannot be matched in bounded time,
 * or past the caps, is refused when the policy is created or updated, so the
 * author learns it at once. A pattern the policy already holds does not block
 * an update that leaves it unchanged.
 */
describe('PolicyService - create and update check glob patterns', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  let service: PolicyService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  const severityRule =
    '{name: r, type: severity, operator: gte, value: HIGH, action: block}';

  const policyYaml = (parts: {
    patterns?: string[];
    rule?: string;
    name?: string;
  }): string =>
    [
      "version: '1.0'",
      `name: ${parts.name ?? 'p1'}`,
      'scope: ORGANIZATION',
      'rules:',
      `  - ${parts.rule ?? severityRule}`,
      ...(parts.patterns === undefined
        ? []
        : [
            'exclusions:',
            ...parts.patterns.flatMap((pattern) => [
              `  - pattern: ${JSON.stringify(pattern)}`,
              '    reason: generated code',
            ]),
          ]),
    ].join('\n');

  const branchRule = (value: string, operator = 'equals'): string =>
    `{name: b, type: branch, operator: ${operator}, value: ${value}, action: block}`;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'pol-1', ...v })),
    };
    const module = await Test.createTestingModule({
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
  });

  const create = (yamlContent: string) =>
    service.createPolicyFromYaml({
      organizationId: orgId,
      yamlContent,
      createdBy: 'u1',
    });

  /** Updates a stored policy that holds the given patterns. */
  const update = (
    yamlContent: string,
    stored: { exclusions?: string[]; branchValue?: string } = {},
  ) => {
    const exclusions = (stored.exclusions ?? []).map((pattern) => ({
      pattern,
      reason: 'old',
    }));
    const rules = stored.branchValue
      ? [
          {
            id: 'b',
            name: 'b',
            isEnabled: true,
            type: 'branch',
            operator: 'not_in',
            value: ['main', stored.branchValue],
            action: 'BLOCK',
          },
        ]
      : [];
    repo.findOne.mockImplementation(async ({ where }) =>
      where.id === 'pol-1'
        ? ({
            id: 'pol-1',
            organizationId: orgId,
            name: 'p1',
            scope: 'ORGANIZATION',
            isEnabled: true,
            rules: { rules, exclusions },
            exclusions,
          } as unknown as SecurityPolicy)
        : null,
    );
    return service.updatePolicyFromYaml({
      policyId: 'pol-1',
      organizationId: orgId,
      yamlContent,
      updatedBy: 'u1',
    });
  };

  const expectRefused = async (
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

  const refused: Array<[string, Parameters<typeof policyYaml>[0], RegExp]> = [
    [
      'a chain of wildcards past the cap',
      { patterns: ['*a*a*a*a*a*a*a*a*a*a*b'] },
      /exclusions\[0\]\.pattern .*more than 10 wildcards/,
    ],
    [
      'a pattern past the length cap',
      { patterns: [`src/${'a'.repeat(300)}`] },
      /exclusions\[0\]\.pattern .*longer than 256 characters/,
    ],
    [
      'an invalid character range',
      { patterns: ['[z-a]'] },
      /exclusions\[0\]\.pattern .*not a valid pattern/,
    ],
    [
      'a back reference',
      { patterns: ['(a)\\1'] },
      /exclusions\[0\]\.pattern .*back references/,
    ],
    [
      'an unsupported branch pattern',
      { rule: branchRule(JSON.stringify('(a)\\1')) },
      /rules\[0\]\.value .*back references/,
    ],
    [
      'an unsupported branch pattern in a list',
      { rule: branchRule('[main, "*a*a*a*a*a*a*a*a*a*a*b"]', 'in') },
      /rules\[0\]\.value\[1\] .*more than 10 wildcards/,
    ],
  ];

  it.each(refused)('create refuses %s', async (_label, parts, message) => {
    await expectRefused(create(policyYaml(parts)), message);
  });

  it.each(refused)(
    'update refuses %s when it is new',
    async (_label, parts, message) => {
      await expectRefused(update(policyYaml(parts)), message);
    },
  );

  it.each([
    'tests/**',
    '**/*.test.ts',
    '**.min.js',
    '**/*.{ts,js}',
    '{src,lib}/generated/**',
    '*a*a*a*a*b',
    '[!.]*',
    '!(vendor)/**',
    '{main}',
    'v{1..3}/**',
    '+(*a)',
  ])('stores the pattern %s', async (pattern) => {
    await create(policyYaml({ patterns: [pattern] }));
    await update(policyYaml({ patterns: [pattern] }));
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it.each([
    [branchRule('"release/*"')],
    [branchRule('"@(main|develop)"')],
    [branchRule('["main", "feature/**"]', 'in')],
  ])('stores the branch rule %s', async (rule) => {
    await create(policyYaml({ rule }));
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('caps the number of exclusions of one policy at 30', async () => {
    const patterns = (n: number) =>
      Array.from({ length: n }, (_, i) => `generated/${i}/**`);
    await create(policyYaml({ patterns: patterns(30) }));
    expect(repo.save).toHaveBeenCalledTimes(1);
    repo.save.mockClear();
    await expectRefused(
      create(policyYaml({ patterns: patterns(31) })),
      /more than 30 exclusions/,
    );
  });

  describe('a pattern the policy already holds', () => {
    const old = '(a)\\1';
    const longOld = `src/${'a'.repeat(300)}`;

    it('does not block an update that keeps it unchanged', async () => {
      await update(policyYaml({ name: 'renamed', patterns: [old, longOld] }), {
        exclusions: [old, longOld],
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.save.mock.calls[0][0].exclusions).toEqual([
        expect.objectContaining({ pattern: old }),
        expect.objectContaining({ pattern: longOld }),
      ]);
    });

    it('does not block an update that keeps an old branch pattern', async () => {
      await update(
        policyYaml({
          rule: branchRule(`[main, ${JSON.stringify(old)}]`, 'not_in'),
        }),
        { branchValue: old },
      );
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('refuses an update that changes it into another unsupported one', async () => {
      await expectRefused(
        update(policyYaml({ patterns: ['(b)\\1'] }), { exclusions: [old] }),
        /exclusions\[0\]\.pattern .*back references/,
      );
    });

    it('refuses an update that adds a new unsupported pattern next to it', async () => {
      await expectRefused(
        update(policyYaml({ patterns: [old, '[z-a]'] }), { exclusions: [old] }),
        /exclusions\[1\]\.pattern .*not a valid pattern/,
      );
    });

    it('is still refused when a new policy copies it', async () => {
      await expectRefused(
        create(policyYaml({ patterns: [old] })),
        /back references/,
      );
    });
  });
});
