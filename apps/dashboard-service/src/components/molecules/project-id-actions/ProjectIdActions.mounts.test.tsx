import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Where the project actions are mounted, and which mount carries the state pill.
 *
 * The AppSec settings page shows them twice: in the page header, and in the
 * « Project ID » box of the form. The pill is the bridge of the header; with
 * both mounts carrying it the page showed two pills. The box keeps its copy
 * action and opts out.
 */
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/components/molecules/wrapper/ProjectSectionNav', () => ({
  default: () => <nav data-testid="section-nav" />,
}));
vi.mock('@/components/molecules/breadcrumbs/BreadcrumbProjectContext', () => ({
  usePublishProjectName: () => {},
}));

// Each mount of the actions records the props it was given.
const mounts = vi.hoisted(() => ({ props: [] as Array<{ projectId: string; statePill?: boolean }> }));
vi.mock('@/components/molecules/project-id-actions/ProjectIdActions', () => ({
  default: (props: { projectId: string; statePill?: boolean }) => {
    mounts.props.push(props);
    return <div data-testid="project-id-actions" data-state-pill={String(props.statePill !== false)} />;
  },
}));

import ProjectTemplateWrapper from '@/components/molecules/wrapper/ProjectTemplateWrapper';
import GeneralSettings from '@/components/organismes/project-settings/GeneralSettings';

const PROJECT = '11111111-2222-4333-8444-555555555555';

const settingsProps = {
  projectName: 'My Project',
  teamName: 'Team A',
  teamId: 'team-1',
  projectId: PROJECT,
  applicationType: 'web_application',
  onApplicationTypeChange: vi.fn(),
  onDisableProject: vi.fn(),
  onDeleteProject: vi.fn(),
  loading: false,
  isProjectLinkedToGithub: false,
  onUnlinkGithubProject: vi.fn(),
  isProjectLinkedToGitlab: false,
  onUnlinkGitlabProject: vi.fn(),
  branches: [],
  referenceBranch: null,
  onReferenceBranchChange: vi.fn(),
} as unknown as React.ComponentProps<typeof GeneralSettings>;

beforeEach(() => {
  mounts.props = [];
});

describe('where the state pill is mounted', () => {
  it('the project header carries it', () => {
    render(
      <MemoryRouter initialEntries={[`/project/${PROJECT}/settings`]}>
        <ProjectTemplateWrapper projectId={PROJECT} projectTitle="My Project" selectedTab="settings">
          <div />
        </ProjectTemplateWrapper>
      </MemoryRouter>,
    );
    expect(mounts.props).toHaveLength(1);
    expect(mounts.props[0].projectId).toBe(PROJECT);
    expect(mounts.props[0].statePill).not.toBe(false);
  });

  it('the « Project ID » box of the settings form does not', () => {
    render(
      <MemoryRouter initialEntries={[`/project/${PROJECT}/settings`]}>
        <GeneralSettings {...settingsProps} />
      </MemoryRouter>,
    );
    expect(mounts.props).toHaveLength(1);
    expect(mounts.props[0].projectId).toBe(PROJECT);
    expect(mounts.props[0].statePill).toBe(false);
  });

  it('the settings page, with its header and its form, shows one pill', () => {
    render(
      <MemoryRouter initialEntries={[`/project/${PROJECT}/settings`]}>
        <ProjectTemplateWrapper projectId={PROJECT} projectTitle="My Project" selectedTab="settings">
          <GeneralSettings {...settingsProps} />
        </ProjectTemplateWrapper>
      </MemoryRouter>,
    );
    const withPill = screen
      .getAllByTestId('project-id-actions')
      .filter((element) => element.getAttribute('data-state-pill') === 'true');
    expect(screen.getAllByTestId('project-id-actions')).toHaveLength(2);
    expect(withPill).toHaveLength(1);
  });
});
