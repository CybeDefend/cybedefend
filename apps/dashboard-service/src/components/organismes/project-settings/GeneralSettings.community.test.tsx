import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * « Scan on every commit » starts a scanner on each push of a linked
 * repository. An import-only Community instance runs no scanner: a push starts
 * no scan, results come by import, so it offers no such setting. A
 * Community instance that runs scans on a connected cluster (`useScansRun()`
 * true) offers it, as the cloud, for a project linked to GitHub or GitLab.
 * The component reads `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string, scansRun: false }));
vi.mock('@/edition/community/instanceCapabilities', () => ({
  // As the real hook: true outside the Community Edition.
  useScansRun: () => ed.edition !== 'community' || ed.scansRun,
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-rebac', () => ({ AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/components/molecules/project-id-actions/ProjectIdActions', () => ({ default: () => null }));

const props = {
  projectName: 'payments-api',
  teamName: 'Core',
  teamId: 'team-1',
  projectId: 'proj-1',
  applicationType: 'web_application',
  onApplicationTypeChange: vi.fn(),
  onDisableProject: vi.fn(),
  onDeleteProject: vi.fn(),
  loading: false,
  isProjectLinkedToGithub: true,
  onUnlinkGithubProject: vi.fn(),
  isProjectLinkedToGitlab: false,
  onUnlinkGitlabProject: vi.fn(),
  branches: [],
  referenceBranch: null,
  onReferenceBranchChange: vi.fn(),
  scanOnCommitEnabled: true,
  onScanOnCommitToggle: vi.fn(),
};

const renderIn = async (edition: string, scansRun = false, linked = { isProjectLinkedToGithub: true, isProjectLinkedToGitlab: false }) => {
  ed.edition = edition;
  ed.scansRun = scansRun;
  vi.resetModules();
  const GeneralSettings = (await import('./GeneralSettings')).default;
  render(
    <MemoryRouter initialEntries={['/appsec/project/proj-1/settings']}>
      <GeneralSettings {...props} {...linked} />
    </MemoryRouter>,
  );
};

describe('GeneralSettings — scan on every commit per edition', () => {
  it('the Community Edition offers no scan on every commit, even for a project linked to GitHub', async () => {
    await renderIn('community');
    expect(screen.queryByTestId('scan-on-commit-setting')).not.toBeInTheDocument();
    // The rest of the form is there.
    expect(screen.getByText('Reference Branch')).toBeInTheDocument();
  });

  it('a Community instance with a cluster offers the scan on every commit of a project linked to GitHub', async () => {
    await renderIn('community', true);
    expect(screen.getByTestId('scan-on-commit-setting')).toBeInTheDocument();
  });

  it('a Community instance with a cluster offers it for a project linked to GitLab', async () => {
    await renderIn('community', true, { isProjectLinkedToGithub: false, isProjectLinkedToGitlab: true });
    expect(screen.getByTestId('scan-on-commit-setting')).toBeInTheDocument();
  });

  it('a Community instance with a cluster offers none for a project linked to no repository', async () => {
    await renderIn('community', true, { isProjectLinkedToGithub: false, isProjectLinkedToGitlab: false });
    expect(screen.queryByTestId('scan-on-commit-setting')).not.toBeInTheDocument();
  });

  it('the cloud keeps the scan on every commit of a project linked to GitHub', async () => {
    await renderIn('cloud');
    expect(screen.getByTestId('scan-on-commit-setting')).toBeInTheDocument();
  });
});
