import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A project of the ranked list opens on its AppSec page, under the prefix,
// exactly once per click (the row and the name both answer the click).

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

// The cloud's rail: « See all » goes to the AppSec home, which is the project
// list there. The Community Edition's list has its own URL (its home is « Get
// started »): ProjectsAtRisk.community.test.tsx checks both editions.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({
  useNavigate: () => h.navigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import ProjectsAtRisk from './ProjectsAtRisk';

const data = {
  topVulnerableProjects: [
    { projectId: 'proj-1', projectName: 'Payment service', teamName: 'Core', vulnerabilityCount: 12, criticalCount: 2, highCount: 3 },
    { projectId: 'proj-2', projectName: 'Web storefront', teamName: 'Platform', vulnerabilityCount: 8, criticalCount: 0, highCount: 1 },
  ],
  // The payload's own shape (result.proto): `cyberRiskLevel` and the 7-day moves on projectsSummary.
  projectsSummary: [
    { projectId: 'proj-1', projectName: 'Payment service', teamId: 't1', teamName: 'Core', cyberRiskLevel: 'high', criticalCount: 2, highCount: 3, mediumCount: 4, lowCount: 3, totalVulnerabilities: 12, newLast7Days: 4, resolvedLast7Days: 1 },
  ],
};

beforeEach(() => {
  h.navigate.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('ProjectsAtRisk', () => {
  it('opens a project on its AppSec page, once', async () => {
    render(<ProjectsAtRisk data={data} />);
    // One row per project at every width (a grid from md, stacked below): the name is rendered once.
    await userEvent.click(screen.getByText('Payment service'));
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith('/appsec/project/proj-1');
  });

  it('writes the risk as a word, the seven-day move with its sign, and « Unavailable » where the page says nothing', () => {
    render(<ProjectsAtRisk data={data} />);
    const rows = screen.getAllByTestId('project-at-risk');
    expect(rows[0]).toHaveTextContent('High');
    expect(rows[0]).toHaveTextContent('+3');
    expect(rows[1]).toHaveTextContent('Not rated');
    expect(rows[1]).toHaveTextContent('Unavailable');
  });

  it('sends « See all » to the AppSec projects list', () => {
    render(<ProjectsAtRisk data={data} />);
    expect(screen.getByRole('link', { name: /See all projects/ })).toHaveAttribute('href', '/appsec');
  });
});
