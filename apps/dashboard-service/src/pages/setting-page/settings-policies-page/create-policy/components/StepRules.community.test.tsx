import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The rules step of a new policy per edition: licence management is the
 * cloud's, so the Community Edition offers no « Block
 * Copyleft Licenses » template and lists no `license_check` rule type. The
 * step reads `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('../../components/PolicyRuleEditor', () => ({ default: () => null }));

const formData = {
  name: 'p',
  description: '',
  scope: 'organization',
  targetId: 'org-1',
  targetIds: [],
  priority: 0,
  isEnabled: true,
  rules: [],
  exclusions: [],
};

const renderIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const StepRules = (await import('./StepRules')).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<StepRules formData={formData as any} onChange={vi.fn()} errors={[]} />);
};

describe('StepRules — licence rules per edition', () => {
  it('the Community Edition offers no copyleft template and lists no licence rule type', async () => {
    await renderIn('community');
    expect(screen.queryByText('Block Copyleft Licenses')).not.toBeInTheDocument();
    expect(screen.queryByText('license_check')).not.toBeInTheDocument();
    expect(screen.getByText('severity')).toBeInTheDocument();
  });

  it('the cloud offers both', async () => {
    await renderIn('cloud');
    expect(screen.getByText('Block Copyleft Licenses')).toBeInTheDocument();
    expect(screen.getByText('license_check')).toBeInTheDocument();
  });
});
