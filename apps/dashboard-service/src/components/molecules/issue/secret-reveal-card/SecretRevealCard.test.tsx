import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const reveal = vi.hoisted(() => ({
  state: {
    data: null as { secret: string; revealedAt: string } | null,
    error: null as { status: number; key: string } | null,
  },
}));
vi.mock('@/server/hooks/useSecretActions', () => ({
  useRevealSecret: () => ({ data: reveal.state.data, loading: false, error: reveal.state.error, reveal: vi.fn(), hide: vi.fn() }),
}));

import SecretRevealCard from './SecretRevealCard';

afterEach(() => {
  cleanup();
  reveal.state.data = null;
  reveal.state.error = null;
});

/**
 * A revealed secret is the customer's credential: the element that shows it
 * carries the `secret` marker, so nothing observing the page records its text.
 */
describe('SecretRevealCard', () => {
  it('marks the revealed secret as a secret', () => {
    reveal.state.data = { secret: 'AKIAEXAMPLEKEY123', revealedAt: '2026-11-14T00:00:00Z' };
    render(<SecretRevealCard projectId="p1" vulnerabilityId="v1" hasStoredValue />);

    const value = screen.getByText('AKIAEXAMPLEKEY123');
    expect(value.closest('[data-sensitive="secret"]')).not.toBeNull();
  });

  it('keeps the card around it, its title and its buttons, unmarked', () => {
    reveal.state.data = { secret: 'AKIAEXAMPLEKEY123', revealedAt: '2026-11-14T00:00:00Z' };
    const { container } = render(<SecretRevealCard projectId="p1" vulnerabilityId="v1" hasStoredValue />);

    expect(container.querySelectorAll('[data-sensitive]')).toHaveLength(1);
    expect(container.querySelector('h4')!.closest('[data-sensitive]')).toBeNull();
  });

  it('shows a refused reveal as its fixed sentence, never the server text', () => {
    reveal.state.error = { status: 403, key: 'errors.api.notAllowed' };
    render(<SecretRevealCard projectId="p1" vulnerabilityId="v1" hasStoredValue />);

    expect(screen.getByText('You are not allowed to do this.')).toBeTruthy();
  });
});
