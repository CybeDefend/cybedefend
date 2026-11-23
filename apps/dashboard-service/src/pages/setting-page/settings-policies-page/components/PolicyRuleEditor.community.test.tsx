import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RuleOperator, RuleType, ViolationAction } from '@/server/interfaces/Policy';

/**
 * The rule types of a policy per edition: licence management is the cloud's
 *, and a SARIF import carries no licence, so the Community
 * Edition offers neither « License Type » nor « License Name ». The editor
 * reads `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
const seen = vi.hoisted(() => ({ labels: [] as string[] }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/components/atoms/select/Select', () => ({
  default: ({ options }: { options: Array<{ label: string }> }) => {
    seen.labels.push(...options.map((option) => option.label));
    return null;
  },
}));

const rule = (type: RuleType) => ({
  name: 'r',
  type,
  operator: type === RuleType.COMPOSITE_AND ? undefined : RuleOperator.EQUALS,
  value: 'CRITICAL',
  criteria: type === RuleType.COMPOSITE_AND ? [{ type: RuleType.SEVERITY, operator: RuleOperator.EQUALS, value: 'CRITICAL' }] : undefined,
  action: ViolationAction.BLOCK,
  isEnabled: true,
});

const labelsIn = async (edition: string, type: RuleType) => {
  ed.edition = edition;
  seen.labels = [];
  vi.resetModules();
  const PolicyRuleEditor = (await import('./PolicyRuleEditor')).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<PolicyRuleEditor rule={rule(type) as any} index={0} onChange={vi.fn()} onRemove={vi.fn()} />);
  return seen.labels;
};

describe('PolicyRuleEditor — licence rule types per edition', () => {
  it('the Community Edition offers no licence rule type', async () => {
    const labels = await labelsIn('community', RuleType.SEVERITY);
    expect(labels).toContain('Severity');
    expect(labels).not.toContain('License Type');
    expect(labels).not.toContain('License Name');
  });

  it('the Community Edition offers no licence criterion in a composite rule', async () => {
    const labels = await labelsIn('community', RuleType.COMPOSITE_AND);
    expect(labels).not.toContain('License Type');
    expect(labels).not.toContain('License Name');
  });

  it('the cloud offers both licence rule types', async () => {
    const labels = await labelsIn('cloud', RuleType.SEVERITY);
    expect(labels).toContain('License Type');
    expect(labels).toContain('License Name');
  });
});
