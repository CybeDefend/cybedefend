import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// « See all projects » leads to the project list in both editions: the cloud's
// AppSec home, Community's /appsec/projects (its home is « Get started »).

const ed = vi.hoisted(() => ({ edition: 'community' as 'community' | 'cloud' }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import ProjectsAtRisk from './ProjectsAtRisk';

const data = { topVulnerableProjects: [], projectsSummary: [] };

afterEach(() => {
  ed.edition = 'community';
});

describe('ProjectsAtRisk « See all projects » per edition', () => {
  it('community: the project list at /appsec/projects', () => {
    render(<ProjectsAtRisk data={data} />);
    expect(screen.getByRole('link', { name: /See all projects/ })).toHaveAttribute('href', '/appsec/projects');
  });

  it('cloud: the AppSec home, unchanged', () => {
    ed.edition = 'cloud';
    render(<ProjectsAtRisk data={data} />);
    expect(screen.getByRole('link', { name: /See all projects/ })).toHaveAttribute('href', '/appsec');
  });
});
