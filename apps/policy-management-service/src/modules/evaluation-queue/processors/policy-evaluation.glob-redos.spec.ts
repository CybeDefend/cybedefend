import { PolicyEvaluationProcessor } from './policy-evaluation.processor';
import {
  PolicyExclusion,
  PolicyRule,
  RuleOperator,
  RuleType,
  ViolationAction,
} from '@entities/security-policy.entity';

/**
 * Exclusion patterns and branch rules are globs written by policy authors and
 * matched against paths and branch names from the scanned repository. A
 * repeated extglob such as `+(*a)` used to backtrack exponentially and block
 * the evaluation worker. These cases run the processor's own code.
 */
describe('PolicyEvaluationProcessor - glob patterns cannot stall evaluation', () => {
  const processor = new PolicyEvaluationProcessor(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  ) as unknown as {
    isExcluded: (vuln: unknown, exclusions: PolicyExclusion[]) => boolean;
    evaluateSimpleRule: (
      rule: PolicyRule,
      vuln: unknown,
      ctx: unknown,
    ) => { matches: boolean };
  };

  const hostile = 'a'.repeat(40) + '!';
  const timed = <T>(fn: () => T): { value: T; ms: number } => {
    const start = Date.now();
    const value = fn();
    return { value, ms: Date.now() - start };
  };

  const branchRule = (operator: RuleOperator, value: unknown): PolicyRule => ({
    id: 'r1',
    name: 'branch rule',
    isEnabled: true,
    action: ViolationAction.BLOCK,
    type: RuleType.BRANCH,
    operator,
    value: value as PolicyRule['value'],
  });

  it.each(['+(*a)', '*(*a)', '*([a]|?(a))'])(
    'exclusion pattern %s returns at once',
    (pattern) => {
      const { value, ms } = timed(() =>
        processor.isExcluded({ id: 'v1', name: 'f', filePath: hostile }, [
          { pattern } as PolicyExclusion,
        ]),
      );
      expect(value).toBe(false);
      expect(ms).toBeLessThan(200);
    },
  );

  it.each([
    [RuleOperator.EQUALS, '+(*a)'],
    [RuleOperator.NOT_EQUALS, '+(*a)'],
    [RuleOperator.IN, ['main', '*(*a)']],
    [RuleOperator.NOT_IN, ['*([a]|?(a))']],
  ])('branch rule %s %j returns at once', (operator, value) => {
    const { ms } = timed(() =>
      processor.evaluateSimpleRule(
        branchRule(operator, value),
        { id: 'v1', name: 'f', severity: 'HIGH' },
        { scanId: 's1', branch: hostile },
      ),
    );
    expect(ms).toBeLessThan(200);
  });

  it('keeps matching the ordinary patterns', () => {
    expect(
      processor.isExcluded(
        { id: 'v1', name: 'f', filePath: 'tests/unit/a.spec.ts' },
        [{ pattern: 'tests/**' } as PolicyExclusion],
      ),
    ).toBe(true);
    expect(
      processor.evaluateSimpleRule(
        branchRule(RuleOperator.IN, ['@(main|develop)', 'release/*']),
        { id: 'v1', name: 'f', severity: 'HIGH' },
        { scanId: 's1', branch: 'release/1.4' },
      ).matches,
    ).toBe(true);
  });
});
