import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBatchProjectsBranchesMock = vi.fn();

vi.mock('@/server/services/resultService', () => ({
  getBatchProjectsBranches: (...args: unknown[]) =>
    getBatchProjectsBranchesMock(...args),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import OrganizationBranchSelector from './OrganizationBranchSelector';

const mkProject = (id: string, name = `proj-${id}`) =>
  ({
    projectId: id,
    name,
  }) as any;

beforeEach(() => {
  getBatchProjectsBranchesMock.mockReset();
  getBatchProjectsBranchesMock.mockResolvedValue({
    projects: [
      { projectId: 'p1', branches: ['main'] },
      { projectId: 'p2', branches: ['main', 'develop'] },
      { projectId: 'p3', branches: [] },
    ],
  });
});

describe('OrganizationBranchSelector — batch fetch on dropdown open', () => {
  // On the organization overview page, the selector used to fire one
  // GET per project (active + archived branches). The batch endpoint
  // collapses that to a single request scoped to the org, with no
  // archived branches surfaced.

  it('does NOT fetch branches at mount even with multiple projects', async () => {
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1'), mkProject('p2'), mkProject('p3')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    await Promise.resolve();
    expect(getBatchProjectsBranchesMock).not.toHaveBeenCalled();
  });

  it('issues exactly ONE batch request on the first dropdown open, regardless of project count', async () => {
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1'), mkProject('p2'), mkProject('p3')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1);
    });
    expect(getBatchProjectsBranchesMock).toHaveBeenCalledWith('org-1', [
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('does NOT refetch when the dropdown is closed and reopened (cache hits)', async () => {
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button');
    fireEvent.click(trigger); // open
    await waitFor(() =>
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // reopen — must NOT refetch the same project set

    await new Promise((r) => setTimeout(r, 10));
    expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1);
  });

  it('does not include any archived-branch UI affordances in the dropdown', async () => {
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1),
    );

    // No "Show archived", "Hide archived", "Archive", or "Unarchive"
    // affordances should ship anymore — the dropdown is now a pure
    // multi-select on active branch names.
    expect(screen.queryByText(/archived/i)).toBeNull();
    expect(screen.queryByText(/archive/i)).toBeNull();
  });
});

describe('OrganizationBranchSelector — reference-branch default selection', () => {
  // The org overview used to auto-check EVERY branch the first time the
  // dropdown opened, so vulnerability stats were aggregated across every
  // feature branch. The default is now the reference branches only — each
  // project's main/master (the ★ ones). Users can still widen to "all".

  it('auto-selects only the reference (main/master) branches by default when the dropdown first opens', async () => {
    const onChange = vi.fn();
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1'), mkProject('p2'), mkProject('p3')]}
        selectedBranches={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1),
    );

    // Only the ★ (main/master) branches are checked by default — not every branch.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['p1::main', 'p2::main']),
    );

    // The non-reference branch must never be part of the default selection.
    const everSelected = onChange.mock.calls.flatMap((c) => c[0] as string[]);
    expect(everSelected).not.toContain('p2::develop');
  });

  it('falls back to selecting every branch when no project exposes a reference branch', async () => {
    getBatchProjectsBranchesMock.mockResolvedValue({
      projects: [{ projectId: 'p1', branches: ['develop', 'feature/x'] }],
    });
    const onChange = vi.fn();
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1),
    );

    // No main/master anywhere → don't leave the overview empty, select all.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['p1::develop', 'p1::feature/x']),
    );
  });
});

describe('OrganizationBranchSelector — the reference branch is the project\'s default branch, main/master otherwise', () => {
  // "Reference branch" means the branch the project is configured on
  // (`defaultBranch`, e.g. `develop` for a GitFlow repo), which the batch
  // endpoint now returns per project. Only when a project has none — or its
  // default branch was never scanned — do we fall back to the main/master
  // naming convention.
  it('checks the project default branch by default, not main, when the project declares one', async () => {
    getBatchProjectsBranchesMock.mockResolvedValue({
      projects: [
        { projectId: 'p1', branches: ['main', 'develop'], defaultBranch: 'develop' },
        { projectId: 'p2', branches: ['main', 'feature/x'], defaultBranch: '' },
      ],
    });
    const onChange = vi.fn();
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1'), mkProject('p2')]}
        selectedBranches={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['p1::develop', 'p2::main']),
    );
    const everSelected = onChange.mock.calls.flatMap((c) => c[0] as string[]);
    expect(everSelected).not.toContain('p1::main');
  });

  it('falls back to main/master when the declared default branch was never scanned', async () => {
    getBatchProjectsBranchesMock.mockResolvedValue({
      projects: [
        { projectId: 'p1', branches: ['master', 'feature/y'], defaultBranch: 'release' },
      ],
    });
    const onChange = vi.fn();
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['p1::master']));
  });

  it('marks the project default branch with the reference star, not main', async () => {
    getBatchProjectsBranchesMock.mockResolvedValue({
      projects: [
        { projectId: 'p1', branches: ['main', 'develop'], defaultBranch: 'develop' },
      ],
    });
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={['p1::develop']}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('develop')).toBeInTheDocument());
    const developRow = screen.getByText('develop').closest('label, li, div')!;
    expect(developRow.textContent).toContain('★');
    const mainRow = screen.getByText('main').closest('label, li, div')!;
    expect(mainRow.textContent).not.toContain('★');
  });
});

// Regression: on the organization overview page the branch selector
// trigger rendered its selected value with the page's inherited (dark) text
// colour on the selector's dark surface (`dark:bg-neutral-900`), so the value
// showed near-black-on-black and was unreadable — the same defect the reports
// BranchSelector had. The trigger value must carry an explicit dark-mode text
// colour somewhere in its style chain.
describe('OrganizationBranchSelector — dark mode text colour', () => {
  // Walk from the text node up through its ancestors looking for a `dark:text-*`
  // class. Robust to whether the colour sits on the text span or a styled parent.
  const hasDarkTextColour = (start: HTMLElement | null): boolean => {
    for (let node: HTMLElement | null = start; node; node = node.parentElement) {
      if (/dark:text-/.test(node.className || '')) return true;
    }
    return false;
  };

  it('renders the trigger label with a dark-mode text colour', () => {
    render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );
    // With no branches fetched yet the trigger shows "All branches"; it sits on
    // the dark trigger background and must stay readable.
    expect(hasDarkTextColour(screen.getByText('All branches'))).toBe(true);
  });
});

describe('OrganizationBranchSelector — a refused batch', () => {
  // The batch route refuses the whole request (403) when one project is not
  // readable by the caller. The selector then shows no branch rather than
  // the previous project set's, and the refusal is not left unhandled.
  it('drops the branches it showed and does not leave the refusal unhandled', async () => {
    getBatchProjectsBranchesMock.mockResolvedValueOnce({
      projects: [{ projectId: 'p1', branches: ['main'] }],
    });
    const { rerender } = render(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.queryAllByText('main').length).toBeGreaterThan(0));

    getBatchProjectsBranchesMock.mockRejectedValueOnce({
      statusCode: 403,
      message: 'You do not have access to one or more requested projects',
    });
    rerender(
      <OrganizationBranchSelector
        organizationId="org-1"
        projects={[mkProject('p1'), mkProject('p9')]}
        selectedBranches={[]}
        onChange={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(screen.queryAllByText('main')).toHaveLength(0));
  });
});
