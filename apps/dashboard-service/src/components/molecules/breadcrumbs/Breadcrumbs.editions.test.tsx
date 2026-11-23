import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

/**
 * `/editions` is a Community page: its crumb reads the
 * page's translated name, never the raw segment. The cloud has no such page,
 * and its trail is left exactly as it was.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as 'community' | 'cloud' }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

import { Breadcrumbs } from './Breadcrumbs';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );

describe('Breadcrumbs on /editions', () => {
  beforeEach(() => {
    ed.edition = 'community';
  });
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', 'Editions'],
    ['fr', 'Éditions'],
  ])('community, %s: the crumb is the translated page name', async (language, label) => {
    await i18n.changeLanguage(language);
    const { container } = at('/editions');
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/editions/);
  });

  it('cloud: /editions keeps its raw segment and the other crumbs are unchanged', async () => {
    ed.edition = 'cloud';
    await i18n.changeLanguage('fr');
    const { container } = at('/editions');
    expect(container.textContent).toContain('editions');
    expect(screen.queryByText('Éditions')).toBeNull();
    at('/organization/settings/integrations');
    expect(screen.getByText('Intégrations')).toBeInTheDocument();
  });
});
