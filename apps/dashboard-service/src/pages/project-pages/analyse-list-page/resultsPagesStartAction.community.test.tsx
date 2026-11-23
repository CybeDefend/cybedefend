import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The start actions of the five results pages that a cluster can scan (sast,
 * sca, iac, secret, cicd), in the Community Edition. `AnalyseWrapper` is a
 * probe that keeps its props; the start-analysis hook and the import dialog
 * are stubs, so only each page's decision is under test:
 * - every page hands `AnalyseWrapper` the import callback (`onImportResultsClick`);
 * - the start action opens the start dialog only when scans run, the import
 *   dialog otherwise.
 */
const h = vi.hoisted(() => ({
  wrapper: { current: null as Record<string, unknown> | null },
  edition: 'community' as string,
  scansRun: false,
  open: vi.fn(),
  list: {
    vulnerabilities: [],
    groups: [],
    packages: [],
    projectName: '',
    total: 0,
    totalVulnerabilities: 0,
    totalGroups: 0,
    totalOccurrences: 0,
    totalPages: 1,
    currentPage: 1,
    vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
    loading: false,
    scanInfo: null,
    isProjectParsed: false,
    availableLanguages: [],
    reachabilityIgnoredCount: 0,
    malwareCount: 0,
    error: null,
    goToPage: () => undefined,
    refresh: () => undefined,
  },
  pageData: {
    isContentReady: true,
    isLoadingBranches: false,
    isBranchResolved: true,
    projectName: 'Demo',
    integrationInfo: { type: 'none', repositoryId: null },
    linkedGithubRepo: null,
    linkedGitlabRepo: null,
    isSecurityContextCustomized: true,
    securityContextUpdatedAt: null,
    isJiraLinked: false,
    branches: [],
    defaultBranch: '',
    selectedBranch: '',
    setSelectedBranch: () => undefined,
    refresh: () => undefined,
    handleArchiveBranch: () => undefined,
    handleUnarchiveBranch: () => undefined,
  },
  state: { organization: { selectedOrganization: { id: 'org-1' } } },
}));

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return h.edition;
  },
}));
vi.mock('@/edition/community/instanceCapabilities', () => ({
  // As the real hook: true outside the Community Edition.
  useScansRun: () => h.edition !== 'community' || h.scansRun,
}));
vi.mock('@/edition/active', async (importOriginal) => {
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  return {
    ...(await importOriginal<typeof import('@/edition/active')>()),
    activeSlots: () => [],
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_SLOTS: [],
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({
  default: (received: Record<string, unknown>) => {
    h.wrapper.current = received;
    return null;
  },
}));
vi.mock('@/components/molecules/import-results/ImportResultsDialog', () => ({
  default: () => <div data-testid="import-dialog" />,
}));
vi.mock('@/server/hooks/useStartAnalysis', () => ({
  useStartAnalysis: () => ({
    isOpen: false,
    open: h.open,
    close: vi.fn(),
    submit: vi.fn(),
    errors: {},
    setSelectedFile: vi.fn(),
    uploadProgress: 0,
    isStartingArchive: false,
    manualBranchName: '',
    setManualBranchName: vi.fn(),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(h.state),
  useDispatch: () => () => undefined,
}));
vi.mock('@/server/hooks/useProjectPageData', () => ({
  useProjectPageData: () => h.pageData,
  default: () => h.pageData,
}));
vi.mock('@/server/hooks/useProjectVulnerabilities', () => ({ default: () => h.list }));
vi.mock('@/server/hooks/useGroupedVulnerabilities', () => ({
  useGroupedVulnerabilities: () => h.list,
  default: () => h.list,
}));
vi.mock('@/server/hooks/useProjectPackages', () => ({ default: () => h.list }));
vi.mock('@/server/hooks/useLicenseSummary', () => ({
  default: () => ({ data: null, loading: false, error: null, refresh: () => undefined }),
}));
vi.mock('@/server/hooks/useProject', () => ({
  useProject: () => ({ project: { name: 'Demo' } }),
  default: () => ({ project: { name: 'Demo' } }),
}));
vi.mock('@/server/hooks/useIssueTracking', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssueTracking: () => undefined,
}));
vi.mock('@/server/hooks/useScanRealtime', () => ({ useScanRealtime: () => undefined }));
vi.mock('@/server/hooks/useBatchUpdateCompletion', () => ({ useBatchUpdateCompletion: () => undefined }));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ startBatchUpdate: vi.fn() }));
vi.mock('@/server/services/integrations/jiraIntegrationsService', () => ({
  getProjectJiraConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/server/services/scanService', () => ({
  default: { startScan: vi.fn(), uploadFileToSignedUrl: vi.fn(), getScanById: vi.fn(), cancelScan: vi.fn() },
}));
vi.mock('@/server/services/resultService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [name, typeof value === 'function' ? vi.fn().mockResolvedValue({}) : value]),
  );
});
vi.mock('@/components/molecules/selection-action-bar/SelectionActionBar', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/batch-update-modal/BatchUpdateModal', () => ({ default: () => null }));

import ResultsSastPage from './sast-page/ResultsSastPage';
import ResultsScaPage from './sca-page/ResultsScaPage';
import ResultsIacPage from './iac-page/ResultsIacPage';
import ResultsSecretPage from './secret-page/ResultsSecretPage';
import ResultsCicdPage from './cicd-page/ResultsCicdPage';

const PAGES: Array<[string, React.ComponentType]> = [
  ['sast', ResultsSastPage],
  ['sca', ResultsScaPage],
  ['iac', ResultsIacPage],
  ['secret', ResultsSecretPage],
  ['cicd', ResultsCicdPage],
];

const mount = (segment: string, Page: React.ComponentType) =>
  render(
    <MemoryRouter initialEntries={[`/appsec/project/p1/${segment}`]}>
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );

/** The callback named `name` the page handed `AnalyseWrapper`, narrowed: the test fails if it is not a function. */
const wrapperCallback = (name: string): (() => void) => {
  const value = h.wrapper.current?.[name];
  if (typeof value !== 'function') throw new Error(`the page handed AnalyseWrapper no ${name}`);
  return value as () => void;
};

beforeEach(() => {
  h.wrapper.current = null;
  h.open.mockReset();
  h.edition = 'community';
  h.scansRun = false;
});

describe.each(PAGES)('the %s results page in the Community Edition', (segment, Page) => {
  it('with a cluster: the start action opens the start dialog, the import callback opens the import dialog', () => {
    h.scansRun = true;
    mount(segment, Page);
    act(() => wrapperCallback('handleStartScanClick')());
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
    act(() => wrapperCallback('onImportResultsClick')());
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });

  it('without a cluster: the start action opens the import dialog, never the start dialog', () => {
    mount(segment, Page);
    expect(typeof h.wrapper.current?.onImportResultsClick).toBe('function');
    act(() => wrapperCallback('handleStartScanClick')());
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    expect(h.open).not.toHaveBeenCalled();
  });
});
