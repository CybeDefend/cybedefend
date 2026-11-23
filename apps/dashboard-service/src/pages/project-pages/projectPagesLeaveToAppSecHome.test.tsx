import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import ProjectOverviewPage from './project-overview-page/ProjectOverviewPage';
import ProjectReportsPage from './project-reports-page/ProjectReportsPage';
import ProjectCompliancePage from './project-compliance-page/ProjectCompliancePage';
import { fetchProject } from '@/server/services/projectService';

/*
  The overview, reports and compliance pages of a project are AppSec pages
  (the code map page is a closed extension). When the project cannot be loaded they leave for the AppSec
  home: the root would hand the account to the landing rule, which may pick
  another product space. Each page's body is stubbed; only the leaving is under test.
*/

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useParams: () => ({ projectId: 'p1' }),
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/server/services/projectService', () => ({ fetchProject: vi.fn() }));

vi.mock('@/components/molecules/wrapper/ProjectTemplateWrapper', () => ({ default: () => null }));
vi.mock('./project-overview-page/ProjectOverviewTemplate', () => ({ default: () => null }));
vi.mock('./project-reports-page/ProjectReportsTemplate', () => ({ default: () => null }));

vi.mock('@/server/hooks/useProjectOverview', () => ({
  useProjectOverview: () => ({ data: null, loading: false, error: null, branches: [], selectedBranch: null }),
}));
vi.mock('@/server/hooks/useOnboardingProgress', () => ({ useOnboardingProgress: () => ({ complete: vi.fn() }) }));
vi.mock('@/server/hooks/useProjectPageData', () => ({ useProjectPageData: () => ({ selectedBranch: '' }) }));
// Reports and policies off: their pages then fetch nothing of their own.
vi.mock('@/server/hooks/useDisabledFeatures', () => ({ default: () => new Set(['reports', 'policies']) }));
vi.mock('../../server/hooks/useProjectReports', () => ({ useProjectReports: () => ({}) }));
vi.mock('@/server/hooks/useProjectBranchesList', () => ({
  useProjectBranchesList: () => ({ loading: true, branches: [] }),
}));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ refreshBackgroundTasks: () => ({ type: 'noop' }) }));
vi.mock('@/server/hooks/useCompliance', () => ({ useCompliance: () => ({}) }));
vi.mock('@/server/hooks/useViolations', () => ({ useViolations: () => ({}) }));

const store = configureStore({ reducer: () => ({ organization: { selectedOrganization: { id: 'org-1' } } }) });

describe('an AppSec project page whose project cannot be loaded', () => {
  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(fetchProject).mockReset().mockRejectedValue(new Error('not found'));
  });

  it.each([
    ['overview', ProjectOverviewPage],
    ['reports', ProjectReportsPage],
    ['compliance', ProjectCompliancePage],
  ])('leaves the %s page for the AppSec home, never the root', async (_page, Page) => {
    render(
      <Provider store={store}>
        {/* The reports page reads its ?reportId= deep link from the router. */}
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </Provider>,
    );

    // Replaced, not pushed: pushed, every Back would land on the project again, which leaves again.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/appsec', { replace: true }));
    expect(navigate).not.toHaveBeenCalledWith('/');
    expect(navigate).not.toHaveBeenCalledWith('/', expect.anything());
  });
});
