import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { translate as t } from '@/test/i18n-mock';

const h = vi.hoisted(() => ({
  forbidden: false,
  roleAccess: undefined as boolean | undefined,
  toastError: vi.fn(),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: h.toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('react-redux', () => ({ useDispatch: () => () => undefined, useSelector: () => undefined }));
vi.mock('@/server/services/projectService', () => ({
  fetchProject: vi.fn().mockResolvedValue({ name: 'Api', teamName: 'Core' }),
}));
vi.mock('@/server/hooks/useProjectRoleAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/hooks/useProjectRoleAccess')>()),
  useProjectRoleAccess: () => h.roleAccess,
}));
vi.mock('@/server/hooks/useProjectReports', () => ({
  useProjectReports: () => ({
    owaspReportData: null,
    cweReportData: null,
    loading: false,
    cweLoading: false,
    error: null,
    forbidden: h.forbidden,
    generateOwasp: vi.fn(),
    generateCwe: vi.fn(),
    clearOwaspReport: vi.fn(),
    clearCweReport: vi.fn(),
    downloadOwaspReport: vi.fn(),
    downloadCweReport: vi.fn(),
  }),
}));
vi.mock('@/server/hooks/useProjectBranchesList', () => ({
  useProjectBranchesList: () => ({
    loading: false,
    branches: [],
    defaultBranch: '',
    setSearch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    searching: false,
    loadingMore: false,
    includeArchived: false,
    toggleArchived: vi.fn(),
  }),
}));
vi.mock('@/server/hooks/useDisabledFeatures', () => ({ default: () => new Set<string>() }));
vi.mock('@/edition/entitlements', () => ({ useEditionEntitlements: () => ({ writesBlocked: false }) }));
vi.mock('@/components/organismes/stored-reports/useReportDeepLink', () => ({
  useReportDeepLink: () => ({ reportId: null, key: 0 }),
}));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ refreshBackgroundTasks: () => ({ type: 'noop' }) }));
vi.mock('./ProjectReportsTemplate', () => ({ default: () => <p>reports template</p> }));

import ProjectReportsPage from './ProjectReportsPage';

const PROJECT = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

const mount = () =>
  render(
    <MemoryRouter initialEntries={[`/appsec/project/${PROJECT}/reports`]}>
      <Routes>
        <Route path="/appsec/project/:projectId/reports" element={<ProjectReportsPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProjectReportsPage, for a role the gateway refuses the reports', () => {
  beforeEach(() => {
    h.toastError.mockReset();
  });

  it('shows the not-allowed state instead of the report cards', () => {
    h.forbidden = true;
    mount();
    expect(screen.getByText(t('errors.api.notAllowed'))).toBeInTheDocument();
    expect(screen.queryByText('reports template')).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('shows the report cards otherwise', () => {
    h.forbidden = false;
    mount();
    expect(screen.getByText('reports template')).toBeInTheDocument();
  });

  it('shows the not-allowed state to a member without the report roles (a developer), before any call', () => {
    h.forbidden = false;
    h.roleAccess = false;
    mount();
    expect(screen.getByText(t('errors.api.notAllowed'))).toBeInTheDocument();
    expect(screen.queryByText('reports template')).toBeNull();
    h.roleAccess = undefined;
  });

  it('shows the report cards to a member with them (a team manager)', () => {
    h.forbidden = false;
    h.roleAccess = true;
    mount();
    expect(screen.getByText('reports template')).toBeInTheDocument();
    h.roleAccess = undefined;
  });
});
