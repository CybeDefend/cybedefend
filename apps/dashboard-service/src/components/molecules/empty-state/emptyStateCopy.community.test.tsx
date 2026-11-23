import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The empty states that speak as Cybe, per edition. Cybe is the cloud's AI
 * agent: in the Community Edition an empty list shows the neutral
 * medallion instead of Cybe's avatar, and its sentence does not promise that
 * an agent will start working or keep monitoring. The modules read `EDITION`
 * once at load, so each case re-imports them.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('@/components/atoms/cybe-avatar/CybeAvatar', () => ({ CybeAvatar: () => <div data-testid="cybe-avatar" /> }));

const loadIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const { EmptyState } = await import('./EmptyState');
  const { EMPTY_STATE_COPY } = await import('./emptyStateCopy');
  const i18n = await import('@/test/i18n-mock');
  return { EmptyState, EMPTY_STATE_COPY, t: (key: string) => i18n.translate(key) };
};

describe('Empty states per edition', () => {
  it('community: no Cybe avatar, and sentences that promise no agent', async () => {
    const { EmptyState, EMPTY_STATE_COPY, t } = await loadIn('community');
    render(<EmptyState cybeMessage title={t(EMPTY_STATE_COPY.noVuln)} />);
    expect(screen.queryByTestId('cybe-avatar')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-state-visual')).toBeInTheDocument();
    expect(t(EMPTY_STATE_COPY.noVuln)).toBe('No vulnerabilities detected on this project.');
    expect(t(EMPTY_STATE_COPY.noProject)).toBe("You don't have any projects yet. Create one, then import your scanners' results.");
  });

  it('cloud: the Cybe avatar and its sentences', async () => {
    const { EmptyState, EMPTY_STATE_COPY, t } = await loadIn('cloud');
    render(<EmptyState cybeMessage title={t(EMPTY_STATE_COPY.noVuln)} />);
    expect(screen.getByTestId('cybe-avatar')).toBeInTheDocument();
    expect(t(EMPTY_STATE_COPY.noVuln)).toBe("No vulnerabilities detected on this project. I'll keep monitoring.");
    expect(t(EMPTY_STATE_COPY.noProject)).toBe("You don't have any projects yet. Connect your repo and I'll start working on it.");
  });
});
