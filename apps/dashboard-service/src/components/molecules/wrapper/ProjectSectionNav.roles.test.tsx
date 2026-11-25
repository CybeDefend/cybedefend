import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const { access } = vi.hoisted(() => ({ access: { current: undefined as boolean | undefined } }));
vi.mock('@/server/hooks/useProjectRoleAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/hooks/useProjectRoleAccess')>()),
  useProjectRoleAccess: () => access.current,
}));

import ProjectSectionNav from './ProjectSectionNav';

const tabLabels = (value: boolean | undefined) => {
  access.current = value;
  render(
    <MemoryRouter initialEntries={['/appsec/project/p-1/sast']}>
      <ProjectSectionNav projectId="p-1" />
    </MemoryRouter>,
  );
  return screen.getAllByRole('link').map((a) => a.textContent);
};

/** The Reports tab follows the member's report roles on the project's team. */
describe('ProjectSectionNav, the Reports tab', () => {
  it('is hidden from a member without the report roles (a developer)', () => {
    expect(tabLabels(false)).toEqual(['Overview', 'Vulnerabilities', 'Compliance', 'Settings']);
  });

  it('is shown to a member with them (a team manager)', () => {
    expect(tabLabels(true)).toContain('Reports');
  });

  it('is shown while the roles are not known: the API stays the authority', () => {
    expect(tabLabels(undefined)).toContain('Reports');
  });
});
