import { PolicyEvaluationProcessor } from './policy-evaluation.processor';
import {
  PolicyRule,
  RuleOperator,
  RuleType,
  ViolationAction,
} from '@entities/security-policy.entity';

/**
 * Severity rules with an ordered operator (gt, gte, lt, lte) must compare
 * severities by rank, INFO < LOW < MEDIUM < HIGH < CRITICAL, never by the
 * alphabetical order of their names. These cases run the processor's own
 * rule evaluation, not a copy of it.
 */
describe('PolicyEvaluationProcessor - severity order', () => {
  const LEVELS = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

  const processor = new PolicyEvaluationProcessor(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  type SimpleResult = { matches: boolean };
  const evaluate = (
    severity: string,
    operator: RuleOperator,
    value: unknown,
  ): boolean => {
    const rule: PolicyRule = {
      id: 'r1',
      name: 'severity rule',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.SEVERITY,
      operator,
      value: value as PolicyRule['value'],
    };
    const result = (
      processor as unknown as {
        evaluateSimpleRule: (
          rule: PolicyRule,
          vuln: unknown,
          ctx: unknown,
        ) => SimpleResult;
      }
    ).evaluateSimpleRule(
      rule,
      { id: 'v1', name: 'finding', severity, scannerType: 'SAST' },
      { scanId: 's1' },
    );
    return result.matches;
  };

  const ordered: Array<[RuleOperator, (a: number, e: number) => boolean]> = [
    [RuleOperator.GT, (a, e) => a > e],
    [RuleOperator.GTE, (a, e) => a >= e],
    [RuleOperator.LT, (a, e) => a < e],
    [RuleOperator.LTE, (a, e) => a <= e],
    [RuleOperator.EQUALS, (a, e) => a === e],
    [RuleOperator.NOT_EQUALS, (a, e) => a !== e],
  ];

  const table: Array<[string, RuleOperator, string, boolean]> = [];
  for (const [operator, expectFn] of ordered) {
    LEVELS.forEach((actual, a) => {
      LEVELS.forEach((expected, e) => {
        table.push([actual, operator, expected, expectFn(a, e)]);
      });
    });
  }

  it.each(table)(
    'finding %s, rule severity %s %s -> %s',
    (actual, operator, expected, shouldMatch) => {
      expect(evaluate(actual, operator, expected)).toBe(shouldMatch);
    },
  );

  it('"gte HIGH" matches CRITICAL and HIGH, not MEDIUM, LOW or INFO', () => {
    expect(evaluate('CRITICAL', RuleOperator.GTE, 'HIGH')).toBe(true);
    expect(evaluate('HIGH', RuleOperator.GTE, 'HIGH')).toBe(true);
    expect(evaluate('MEDIUM', RuleOperator.GTE, 'HIGH')).toBe(false);
    expect(evaluate('LOW', RuleOperator.GTE, 'HIGH')).toBe(false);
    expect(evaluate('INFO', RuleOperator.GTE, 'HIGH')).toBe(false);
  });

  it('"gt CRITICAL" never matches', () => {
    for (const level of LEVELS) {
      expect(evaluate(level, RuleOperator.GT, 'CRITICAL')).toBe(false);
    }
  });

  it('compares case-insensitively on both sides', () => {
    expect(evaluate('critical', RuleOperator.GTE, 'high')).toBe(true);
    expect(evaluate('Medium', RuleOperator.GTE, 'High')).toBe(false);
    expect(evaluate('low', RuleOperator.EQUALS, 'LOW')).toBe(true);
    expect(evaluate('HIGH', RuleOperator.IN, ['critical', 'high'])).toBe(true);
    expect(evaluate('low', RuleOperator.NOT_IN, ['CRITICAL', 'HIGH'])).toBe(
      true,
    );
  });

  it('an unranked severity never satisfies an ordered comparison', () => {
    for (const operator of [
      RuleOperator.GT,
      RuleOperator.GTE,
      RuleOperator.LT,
      RuleOperator.LTE,
    ]) {
      expect(evaluate('UNKNOWN', operator, 'LOW')).toBe(false);
      expect(evaluate('HIGH', operator, 'BANANA')).toBe(false);
    }
  });
});
