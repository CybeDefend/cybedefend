import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The SCA page of the Community Edition: no extension adds a view
 * (`EMPTY_EXTENSIONS`), so the page offers the core views alone, opens the
 * vulnerabilities for a deep link to a view it does not have, and sends the
 * list routes no `malwareOnly` (unset means « exclude malware », what the
 * list route does with no feed). The template is a probe that keeps its props.
 */
const h = vi.hoisted(() => {
  const props = { current: null as Record<string, any> | null };
  return {
    props,
    probe: (received: Record<string, any>) => {
      props.current = received;
      return null;
    },
    /** When set, the probe renders this real template. */
    realTemplate: { current: null as React.ComponentType<any> | null },
    licenseOptions: [] as Array<Record<string, unknown>>,
    detailedOptions: [] as Array<Record<string, unknown>>,
    groupedOptions: [] as Array<Record<string, unknown>>,
    list: {
      vulnerabilities: [],
      groups: [],
      projectName: '',
      totalVulnerabilities: 0,
      totalGroups: 0,
      totalOccurrences: 0,
      totalPages: 1,
      currentPage: 1,
      vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
      loading: false,
      scanInfo: null,
      isProjectParsed: false,
      reachabilityIgnoredCount: 0,
      malwareCount: 3,
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
  };
});

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
/**
 * What a SARIF import never fills: the Community Edition shows no
 * licences tab, sends no licence summary request, and shows no
 * reachability-ignored banner. The page and its template read `EDITION` once
 * at load: those cases re-import them under each edition.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
// Each edition case re-imports its module tree after vi.resetModules(), slow under a parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('./ResultsScaTemplate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ResultsScaTemplate')>()),
  default: (received: Record<string, any>) => {
    h.probe(received);
    const Real = h.realTemplate.current;
    return Real ? <Real {...received} /> : null;
  },
}));
// The real template's children are stubs: only its tabs and banners are under test.
vi.mock('@/components/organismes/table/sca-table/ResultsScaTable', () => ({ ResultsScaTable: () => null }));
vi.mock('@/components/organismes/table/grouped-sca-table/GroupedResultsScaTable', () => ({ GroupedResultsScaTable: () => null }));
vi.mock('@/components/organismes/table/sca-table/ResultsScaPackagesTable', () => ({ default: () => null }));
vi.mock('@/components/organismes/table/sca-table/ResultsScaLicensesTable', () => ({
  default: () => <div data-testid="licenses-table" />,
}));
vi.mock('@/components/organismes/issue-drawer/IssueQuickViewHost', () => ({ default: () => null }));
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
vi.mock('@/server/hooks/useProjectVulnerabilities', () => ({
  default: (options: Record<string, unknown>) => {
    h.detailedOptions.push(options);
    return h.list;
  },
}));
vi.mock('@/server/hooks/useGroupedVulnerabilities', () => ({
  useGroupedVulnerabilities: (options: Record<string, unknown>) => {
    h.groupedOptions.push(options);
    return h.list;
  },
}));
vi.mock('@/server/hooks/useProjectPackages', () => ({
  default: () => ({ packages: [], total: 0, totalPages: 1, currentPage: 1, loading: false, error: null, goToPage: () => undefined, refresh: () => undefined }),
}));
vi.mock('@/server/hooks/useLicenseSummary', () => ({
  default: (options: Record<string, unknown>) => {
    h.licenseOptions.push(options);
    return { data: null, loading: false, error: null, refresh: () => undefined };
  },
}));
vi.mock('@/server/hooks/useProject', () => ({
  useProject: () => ({ project: { name: 'Demo' } }),
  default: () => ({ project: { name: 'Demo' } }),
}));
vi.mock('@/server/hooks/useIssueTracking', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useIssueTracking: () => undefined }));
vi.mock('@/server/hooks/useScanRealtime', () => ({ useScanRealtime: () => undefined }));
vi.mock('@/server/hooks/useBatchUpdateCompletion', () => ({ useBatchUpdateCompletion: () => undefined }));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ startBatchUpdate: vi.fn() }));
vi.mock('@/server/services/integrations/jiraIntegrationsService', () => ({ getProjectJiraConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('@/server/services/scanService', () => ({
  default: { startScan: vi.fn(), uploadFileToSignedUrl: vi.fn(), getScanById: vi.fn(), cancelScan: vi.fn() },
}));
vi.mock('@/server/services/resultService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [name, typeof value === 'function' ? vi.fn().mockResolvedValue({}) : value]),
  );
});
vi.mock('@/ee/chat/components/molecules/focus-top5/FocusTop5Overlay', () => ({ default: () => null }));
vi.mock('@/components/molecules/selection-action-bar/SelectionActionBar', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/batch-update-modal/BatchUpdateModal', () => ({ default: () => null }));
vi.mock('@/ee/ai/components/molecules/banners/ProjectStaleAnalysisBanner', () => ({ default: () => null }));

import ResultsScaPage from './ResultsScaPage';
import { CORE_SCA_VIEWS } from './ResultsScaTemplate';

const mount = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/appsec/project/p1/results/sca${search}`]}>
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<ResultsScaPage />} />
      </Routes>
    </MemoryRouter>,
  );

const props = () => h.props.current as Record<string, any>;

beforeEach(() => {
  localStorage.clear();
  h.props.current = null;
  h.realTemplate.current = null;
  h.list.reachabilityIgnoredCount = 0;
  h.licenseOptions.length = 0;
  h.detailedOptions.length = 0;
  h.groupedOptions.length = 0;
});

describe('ResultsScaPage in the Community Edition', () => {
  it('the list requests carry no malwareOnly', () => {
    mount();
    expect(h.detailedOptions.length).toBeGreaterThan(0);
    expect(h.groupedOptions.length).toBeGreaterThan(0);
    for (const options of [...h.detailedOptions, ...h.groupedOptions]) {
      expect(options).not.toHaveProperty('malwareOnly');
    }
  });

  it('the views are vulnerabilities, packages and licences, and there is no Malware tab', () => {
    mount();
    expect(CORE_SCA_VIEWS).toEqual(['vulnerabilities', 'packages', 'licenses']);
    expect(props().extensionViews).toEqual([]);
    expect(props().extensionCounts).toEqual({});
    expect(props().resultColumns).toEqual([]);
  });

  it('a ?tab=malware deep link opens the vulnerabilities', () => {
    mount('?tab=malware');
    expect(props().view).toBe('vulnerabilities');
  });

  it('a ?tab=packages deep link still opens the packages', () => {
    mount('?tab=packages');
    expect(props().view).toBe('packages');
  });
});

const mountUnder = async (edition: string, search = '') => {
  ed.edition = edition;
  vi.resetModules();
  // A mock factory's module is kept across resetModules: the real template is
  // loaded here, fresh, so that it reads the edition of this case.
  h.realTemplate.current = (await vi.importActual<typeof import('./ResultsScaTemplate')>('./ResultsScaTemplate')).default;
  const Page = (await import('./ResultsScaPage')).default;
  return render(
    <MemoryRouter initialEntries={[`/appsec/project/p1/results/sca${search}`]}>
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
};

const LICENSES_TAB = 'components.resultsScaTemplate.licenses';
const REACHABILITY_BANNER = 'components.resultsScaTemplate.reachabilityIgnoredBanner';
const REACHABILITY_TOGGLE = /components\.resultsScaTemplate\.reachability(Show|Hide)Ignored/;

describe('ResultsScaPage scanner-only pieces, by edition', () => {
  it('community: no licences tab', async () => {
    await mountUnder('community');
    expect(screen.getByText('components.resultsScaTemplate.vulnerabilities')).toBeInTheDocument();
    expect(screen.getByText('components.resultsScaTemplate.packages')).toBeInTheDocument();
    expect(screen.queryByText(LICENSES_TAB)).not.toBeInTheDocument();
  });

  it('community: a licences or malware deep link opens the vulnerabilities', async () => {
    await mountUnder('community', '?tab=licenses');
    expect(props().view).toBe('vulnerabilities');
    expect(screen.queryByTestId('licenses-table')).not.toBeInTheDocument();
    cleanup();
    await mountUnder('community', '?tab=malware');
    expect(props().view).toBe('vulnerabilities');
  });

  it('community: no licence summary request', async () => {
    await mountUnder('community', '?tab=licenses');
    expect(h.licenseOptions.length).toBeGreaterThan(0);
    for (const options of h.licenseOptions) expect(options.enabled).toBe(false);
  });

  it('community: no reachability-ignored banner or toggle, even with a count of 3', async () => {
    h.list.reachabilityIgnoredCount = 3;
    await mountUnder('community');
    expect(props().view).toBe('vulnerabilities');
    expect(screen.queryByText(REACHABILITY_BANNER)).not.toBeInTheDocument();
    expect(screen.queryByText(REACHABILITY_TOGGLE)).not.toBeInTheDocument();
  });

  it('cloud: the licences tab opens the licences table', async () => {
    await mountUnder('cloud');
    expect(screen.queryByTestId('licenses-table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(LICENSES_TAB));
    expect(screen.getByTestId('licenses-table')).toBeInTheDocument();
    expect(h.licenseOptions[h.licenseOptions.length - 1].enabled).toBe(true);
  });

  it('cloud: a licences deep link opens the licences table', async () => {
    await mountUnder('cloud', '?tab=licenses');
    expect(props().view).toBe('licenses');
    expect(screen.getByTestId('licenses-table')).toBeInTheDocument();
  });

  it('cloud: the reachability-ignored banner and its toggle are shown with a count of 3', async () => {
    h.list.reachabilityIgnoredCount = 3;
    await mountUnder('cloud');
    expect(screen.getByText(REACHABILITY_BANNER)).toBeInTheDocument();
    expect(screen.getByText(REACHABILITY_TOGGLE)).toBeInTheDocument();
  });
});
