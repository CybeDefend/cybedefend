import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The Cursor install dialog's last step per edition. The cloud's says « Select
 * your region, authenticate via OAuth 2.0 … start scanning »; a Community
 * instance has no region, no OAuth sign-in (personal access tokens)
 * and no scanner (results come by import). The dialog reads `EDITION` once at
 * load, so each case re-imports it.
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

const renderIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const CursorInstallModal = (await import('./CursorInstallModal')).default;
  render(<CursorInstallModal onClose={vi.fn()} />);
};

describe('CursorInstallModal — the last step per edition', () => {
  it('community: a personal access token on this instance, findings from imports, no scan', async () => {
    await renderIn('community');
    expect(screen.queryByText(/start scanning/)).toBeNull();
    expect(screen.queryByText(/OAuth/)).toBeNull();
    expect(screen.getByText(/personal access token/)).toBeInTheDocument();
  });

  it('cloud: region, OAuth and scanning', async () => {
    await renderIn('cloud');
    expect(screen.getByText(/start scanning/)).toBeInTheDocument();
  });
});
