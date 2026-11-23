import React from 'react';
import { Navigate, Route } from 'react-router-dom';
import ShellPage from '@/components/organismes/layout/ShellPage';
import ProtectedRouteWrapper from '@/components/molecules/protected-route/ProtectedRouteWrapper';
import AppSecLegacyRedirect from '@/components/molecules/routing/AppSecLegacyRedirect';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import type { ProductRouteGuardProps } from '@/edition/extensions';
import HomePage from '@/pages/home-page/HomePage';
import GetStartedPage from '@/pages/get-started-page/GetStartedPage';
import { GenericProjectIntegrationOnboardingPage } from '@/pages/integrations-page/GenericProjectIntegrationOnboardingPage';
import { GenericProjectIntegrationCreateProjectsPage } from '@/pages/integrations-page/GenericProjectIntegrationCreateProjectsPage';
import { GenericProjectIntegrationLinkExistingPage } from '@/pages/integrations-page/GenericProjectIntegrationLinkExistingPage';
import OrganizationOverviewPage from '@/pages/organization-overview-page/OrganizationOverviewPage';
import ResultsIacPage from '@/pages/project-pages/analyse-list-page/iac-page/ResultsIacPage';
import ResultsCicdPage from '@/pages/project-pages/analyse-list-page/cicd-page/ResultsCicdPage';
import ResultsSecretPage from '@/pages/project-pages/analyse-list-page/secret-page/ResultsSecretPage';
import ResultsSastPage from '@/pages/project-pages/analyse-list-page/sast-page/ResultsSastPage';
import ResultsScaPage from '@/pages/project-pages/analyse-list-page/sca-page/ResultsScaPage';
import ResultsContainerPage from '@/pages/project-pages/analyse-list-page/container-page/ResultsContainerPage';
import LicenseDetailPage from '@/pages/project-pages/license-detail-page/LicenseDetailPage';
import IssueRedirect from '@/pages/project-pages/issue-page/IssueRedirect';
import ProjectOverviewPage from '@/pages/project-pages/project-overview-page/ProjectOverviewPage';
import ProjectReportsPage from '@/pages/project-pages/project-reports-page/ProjectReportsPage';
import ProjectSettingPage from '@/pages/project-pages/project-setting-page/ProjectSettingPage';
import ProjectCompliancePage from '@/pages/project-pages/project-compliance-page/ProjectCompliancePage';
import ReportsPage from '@/pages/reports-page/ReportsPage';
import { APPSEC_PROJECTS_PATH, appsecPath, productHome } from '@/utils/product';
import { EDITION, type Edition } from '@/edition/edition';

/**
 * With no registered guard (the Community Edition), every page renders as it
 * is: the organisation's products are not asked, no activation redirect.
 */
const PassThrough: React.FC<ProductRouteGuardProps> = ({ children }) => <>{children}</>;

/** The route guard of the active edition: the registered one when there is one, a pass-through otherwise. */
const Guard = ACTIVE_EXTENSIONS.ProductRouteGuard ?? PassThrough;

/** A page of the AppSec space: shown only while AppSec is active for the organisation. */
const guarded = (page: React.ReactElement, billingPage = false): React.ReactElement => (
  <Guard product="appsec" billingPage={billingPage}>
    {page}
  </Guard>
);

interface AppSecPage {
  /**
   * The page's former, unprefixed URL pattern. The page is served at
   * `appsecPath(path)`, and the former URL redirects there.
   */
  path: string;
  element: React.ReactElement;
}

const inShell = (currentPath: string, page: React.ReactNode): React.ReactElement => (
  <ShellPage currentPath={currentPath}>{page}</ShellPage>
);

const protectedInShell = (currentPath: string, page: React.ReactNode): React.ReactElement => (
  <ShellPage currentPath={currentPath} protect>
    {page}
  </ShellPage>
);

const protectedPage = (page: React.ReactNode): React.ReactElement => (
  <ProtectedRouteWrapper>{page}</ProtectedRouteWrapper>
);

/**
 * Every AppSec page but the home, by its former URL, with the element App.tsx
 * gave it. The pages common to both products (`/organization/settings/*`,
 * including the policies) and the URLs other systems hold (`/login`, the OAuth
 * callbacks, `/invite/:token`, …) stay in App.tsx, where they are.
 */
const LICENSE_DETAIL_PATH = '/project/:projectId/sca/license/:spdxId';

const APPSEC_PAGES: readonly AppSecPage[] = [
  { path: '/project/:projectId/sast', element: protectedInShell('Project Issues Sast', <ResultsSastPage />) },
  { path: '/project/:projectId/iac', element: protectedInShell('Project Issues IAC', <ResultsIacPage />) },
  { path: '/project/:projectId/cicd', element: protectedInShell('Project Issues CICD', <ResultsCicdPage />) },
  { path: '/project/:projectId/secret', element: protectedInShell('Project Issues Secret', <ResultsSecretPage />) },
  { path: '/project/:projectId/sca', element: protectedInShell('Project Issues SCA', <ResultsScaPage />) },
  // The AI-BOM pages are not here: their routes live in the closed tree,
  // exported through `eeRoutes`.
  // A licence's detail page: licence management is the cloud's,
  // so the Community Edition's table leaves it out (`pagesFor`).
  {
    path: LICENSE_DETAIL_PATH,
    element: protectedInShell('Project License Detail', <LicenseDetailPage />),
  },
  // The dedicated issue page is retired in favour of the quick-view drawer.
  // Old/deep links redirect to the list page with the drawer open. `IssuePage`
  // is kept in the codebase but no longer routed.
  { path: '/project/:projectId/:type/issue/:issueId', element: <IssueRedirect /> },
  {
    path: '/project/:projectId/container',
    element: protectedInShell('Project Issues Container', <ResultsContainerPage />),
  },
  { path: '/project/:projectId', element: protectedInShell('Project Overview', <ProjectOverviewPage />) },
  // The code map page is not here: its route lives in the closed tree,
  // exported through `eeRoutes`.
  { path: '/project/:projectId/reports', element: protectedInShell('Project Reports', <ProjectReportsPage />) },
  { path: '/project/:projectId/settings', element: protectedInShell('Project Settings', <ProjectSettingPage />) },
  { path: '/project/:projectId/compliance', element: protectedInShell('Project Compliance', <ProjectCompliancePage />) },
  // The organisation's policies live in its settings, the page the rail links to.
  { path: '/policies', element: <Navigate to="/organization/settings/policies" replace /> },
  { path: '/reports', element: inShell('Reports', <ReportsPage />) },
  // The AutoFix page is not here: its route lives in the closed tree,
  // exported through `eeRoutes`.
  { path: '/organization/overview', element: inShell('Organization Overview', <OrganizationOverviewPage />) },
  // Project creation through an integration (GitHub, GitLab).
  { path: '/project/integration/github', element: protectedPage(<GenericProjectIntegrationOnboardingPage />) },
  { path: '/project/integration/github/link', element: protectedPage(<GenericProjectIntegrationLinkExistingPage />) },
  { path: '/project/integration/github/create', element: protectedPage(<GenericProjectIntegrationCreateProjectsPage />) },
  { path: '/project/integration/gitlab', element: protectedPage(<GenericProjectIntegrationOnboardingPage />) },
  { path: '/project/integration/gitlab/create', element: protectedPage(<GenericProjectIntegrationCreateProjectsPage />) },
  { path: '/project/integration/gitlab/link', element: protectedPage(<GenericProjectIntegrationLinkExistingPage />) },
];

/**
 * Links other systems print to a project that no page of the dashboard ever
 * served. Each one is sent to the project's AppSec overview, its query string
 * and hash kept.
 */
const PROJECT_OVERVIEW_ALIASES: readonly string[] = [
  // The backend's link to a scan (Slack, e-mails), in its former form and in
  // the `/appsec` form it will print once it is updated.
  '/project/:projectId/scan/:scanId',
  appsecPath('/project/:projectId/scan/:scanId'),
  // The « Open in CybeDefend » link of the Jira issues created before it led
  // to the finding route. It does not say which scanner found the finding, so
  // no results page can be chosen: the overview is the honest target.
  '/project/:projectId/vulnerability/:vulnerabilityId',
];

/**
 * Every route of the AppSec space, plus the redirects from its former URLs.
 * One prefix, one file: every page is wrapped in the product guard of the
 * active edition, which sends an AppSec that is not active to its activation
 * page (the route of which lives in the edition's own routes). The former
 * URLs are not guarded: they redirect to their `/appsec` form first, and that
 * one is.
 *
 * The root `/` is not here: it is no page of any product, it only sends the
 * account to the home of one (`RootLanding`, mounted by App.tsx).
 *
 * React Router ranks routes by specificity, not by order: the former
 * project-tab URLs of the other space (`/project/:id/<its tab>`, …) end
 * in a static segment and outrank every former AppSec pattern here, which
 * never ends a project URL with a dynamic one.
 */
/** The AppSec pages an edition serves. */
const pagesFor = (edition: Edition): readonly AppSecPage[] =>
  edition === 'community' ? APPSEC_PAGES.filter(({ path }) => path !== LICENSE_DETAIL_PATH) : APPSEC_PAGES;

export const appsecRoutesFor = (edition: Edition): React.ReactElement => (
  <>
    {/* The product home. In the cloud it is the project list; in the
        Community Edition it is the « Get started » page, and the list is at its own URL, which the cloud
        serves too so a link to it holds in both editions. */}
    <Route
      path={productHome('appsec')}
      element={guarded(
        edition === 'community' ? inShell('Get started', <GetStartedPage />) : inShell('Projects', <HomePage />),
      )}
    />
    <Route path={APPSEC_PROJECTS_PATH} element={guarded(inShell('Projects', <HomePage />))} />
    {pagesFor(edition).map(({ path, element }) => (
      <Route key={path} path={appsecPath(path)} element={guarded(element)} />
    ))}
    {/* The Platform's « Usage & billing » and its former URL belong to the
        billing area of the edition (`eeRoutes`). */}

    {/* Former URLs, printed by e-mails, Slack, Jira, GitLab, pull requests and the CLI. */}
    {pagesFor(edition).map(({ path }) => (
      <Route key={`former:${path}`} path={path} element={<AppSecLegacyRedirect />} />
    ))}
    {/* URLs that never had a page of their own: the project's AppSec overview. */}
    {PROJECT_OVERVIEW_ALIASES.map((path) => (
      <Route key={`overview:${path}`} path={path} element={<AppSecLegacyRedirect to="project" />} />
    ))}
  </>
);

/** The routes of the edition this build runs. */
export const appsecRoutes = appsecRoutesFor(EDITION);

