import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { SlotRegistration } from '@/edition/slots';
import ProjectSectionNav from './ProjectSectionNav';
import { ProjectSectionTab } from './ProjectSectionTab';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const { slots } = vi.hoisted(() => ({ slots: { current: [] as SlotRegistration[] } }));
vi.mock('@/edition/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/active')>()),
  activeSlots: () => slots.current,
}));

const renderNav = ({ slots: registrations, path = '/appsec/project/p-1/sast' }: { slots: SlotRegistration[]; path?: string }) => {
  slots.current = registrations;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectSectionNav projectId="p-1" />
    </MemoryRouter>,
  );
};

const tabLabels = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('ProjectSectionNav and its project.tabs slot', () => {
  it('with no registration the AppSec tabs are the core five, in order', () => {
    renderNav({ slots: [] });
    expect(tabLabels()).toEqual(['Overview', 'Vulnerabilities', 'Reports', 'Compliance', 'Settings']);
  });

  it('a registered tab is placed by its order', () => {
    renderNav({
      slots: [
        {
          slot: 'project.tabs',
          id: 'code-graph',
          order: 30,
          render: (c) => (
            <ProjectSectionTab
              tabKey="code-graph"
              label="Code map"
              to={`/appsec/project/${c.projectId}/code-graph`}
              icon={null}
              active={false}
            />
          ),
        },
      ],
    });
    expect(tabLabels()).toEqual(['Overview', 'Vulnerabilities', 'Code map', 'Reports', 'Compliance', 'Settings']);
  });

  it('hands a registration the project and the product of the page', () => {
    const seen: unknown[] = [];
    renderNav({
      slots: [{ slot: 'project.tabs', id: 'x', order: 99, render: (c) => (seen.push(c), null) }],
    });
    expect(seen[0]).toEqual({ projectId: 'p-1', product: 'appsec' });
  });

  it('marks a registered tab current when the page names it', () => {
    slots.current = [
      {
        slot: 'project.tabs',
        id: 'code-graph',
        order: 30,
        render: () => <ProjectSectionTab tabKey="code-graph" label="Code map" to="/appsec/project/p-1/code-graph" icon={null} active />,
      },
    ];
    render(
      <MemoryRouter initialEntries={['/appsec/project/p-1/code-graph']}>
        <ProjectSectionNav projectId="p-1" active="code-graph" />
      </MemoryRouter>,
    );
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Code map']);
  });
});
