import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import NotFoundPage from './NotFoundPage';
import { supportUrl } from '@/edition/support';

/**
 * The not-found page belongs to neither product: it is reached from any URL
 * nobody serves, and is rendered outside the shell. Its way home is the root
 * `/`, which sends the account to the home of its preferred product, never a
 * product home chosen here.
 */
describe('NotFoundPage', () => {
  it('leads home through the root', () => {
    render(
      <MemoryRouter initialEntries={['/appsec/project/p-1/nothing-here']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    const internal = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/'));
    expect(internal).toEqual(['/', '/']);
  });

  it('sends « Contact support » where the edition takes support', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    const external = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => !href?.startsWith('/'));
    expect(external).toEqual([supportUrl()]);
  });
});
