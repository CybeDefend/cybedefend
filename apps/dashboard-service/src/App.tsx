import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRebac } from "react-rebac";
import { useDispatch, useSelector } from "react-redux";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import AppFailurePage from "@/components/organismes/app-failure/AppFailurePage";
import { appFailureVariant } from "@/components/organismes/app-failure/appFailureLogic";
import { escapeToSignIn, reloadPage } from "@/components/organismes/app-failure/appFailureActions";
import LoaderHome from "./components/atoms/loader/LoaderHome";
import { BreadcrumbProjectProvider } from '@/components/molecules/breadcrumbs/BreadcrumbProjectContext';
import ScrollToTopOnNavigate from "./components/atoms/scroll-to-top/ScrollToTopOnNavigate";
import ShellPage from "./components/organismes/layout/ShellPage";
import ProtectedRouteWrapper from "./components/molecules/protected-route/ProtectedRouteWrapper";
import RootLanding from "./components/molecules/routing/RootLanding";
import { IntegrationGithubPage } from "./pages/integrations-page/IntegrationGithubPage";
import { GitlabIntegrationPage } from "./pages/integrations-page/GitlabIntegrationPage";
import { IntegrationSlackCallbackPage } from "./pages/integrations-page/IntegrationSlackCallbackPage";
import { IntegrationJiraCallbackPage } from "./pages/integrations-page/IntegrationJiraCallbackPage";
import { IntegrationLinearCallbackPage } from "./pages/integrations-page/IntegrationLinearCallbackPage";
import LogoutPage from "./pages/LogoutPage";
import NotFoundPage from "./pages/NotFoundPage";
import OnBoardingPage from "./pages/on-boarding-page/OnBoardingPage";
import OrganizationInvitationPage from "./pages/OrganizationInvitationPage";
import { appsecRoutesFor } from "./routes/appsecRoutes";
import AccountPage from "./pages/profile-pages/account-page/AccountPage";
import PersonalAccessTokensPage from "./pages/profile-pages/pat-page/PersonalAccessTokensPage";
import OrganizationIntegrationPage from "./pages/setting-page/settings-organization-integration-page/SettingsOrganizationIntegrationPage";
import SettingsOrganizationPage from "./pages/setting-page/settings-organization-page/SettingsOragnizationPage";
import SettingsTeamsPage from "./pages/setting-page/settings-team-page/SettingsTeamsPage";
import SettingsPoliciesPage from "./pages/setting-page/settings-policies-page/SettingsPoliciesPage";
import CreatePolicyPage from "./pages/setting-page/settings-policies-page/create-policy/CreatePolicyPage";
import EditPolicyPage from "./pages/setting-page/settings-policies-page/edit-policy/EditPolicyPage";
import OrganizationComplianceOverviewPage from "./pages/organization-compliance-overview-page/OrganizationComplianceOverviewPage";
import { useAuth } from "@/edition/auth/useAuth";
import { ProfileOrganization } from "./server/interfaces/Organization";
import { Team } from "./server/interfaces/Team";
import { fetchMyProfile } from "./server/services/userService";
import { AppDispatch, RootState } from "./server/store";
import { setSelectedOrganization } from "./server/store/organizationSlice";
import { setUserProfile } from "./server/store/userSlice";
import {
  setInvitationContext,
  clearInvitationContext,
  clearNewlyJoinedOrgId,
} from "./server/store/invitationSlice";
import {
  startAppInitialization,
  completeAppInitialization,
  markDataUnstable,
  markDataStable
} from "./server/store/appSlice";
import store from "./server/store";
import SettingsLicensesPage from "./pages/setting-page/settings-licenses-page/SettingsLicensesPage";
import EditionsPage from "./pages/editions/EditionsPage";
import { useBackgroundTasks } from "./server/hooks/useBackgroundTasks";
import { useActiveScanTasksTracker } from "./server/hooks/useActiveScanTasksTracker";
import { BackgroundTasksPanel } from "./components/organismes/background-tasks/BackgroundTasksPanel";
import { appToastStyle } from "./components/organismes/background-tasks/toastPlacement";
import { selectTasksPanelShown } from "./server/store/backgroundTasksSlice";
import { ACTIVE_EXTENSIONS, activeEeRoutes } from "@/edition/active";
import { routeObjectsToRoutes } from "@/edition/routeObjects";
import { EDITION, type Edition } from "@/edition/edition";
import { getSetupStatus } from "@/edition/auth/community/authApi";
import {
  communityAuthRoutes,
  communitySignInRedirect,
  isCommunityPublicPath,
  loginPath,
} from "./routes/communityAuthRoutes";
import { isInvitationPagePath } from "@/lib/invite-token";

/**
 * The application's route table, the closed routes of the active edition
 * (`activeEeRoutes`) ranked among the core's, and in the Community Edition its
 * own sign-in pages (`communityAuthRoutes`) and `/editions`. A function of its own so that a
 * test can match a path against the table an edition serves
 * (`src/routes/routeTable.test.tsx`).
 */
export function appRouteTable(edition: Edition = EDITION): ReactElement {
  return (
    <Routes>
      {/* No page: sends the account to the home of its preferred product. */}
      <Route path="/" element={<RootLanding />} />
      {appsecRoutesFor(edition)}
      <Route
        path="/organization/settings/integrations"
        element={
          <ShellPage currentPath="Project Integrations">
            <OrganizationIntegrationPage />
          </ShellPage>
        }
      />
      {edition === "community" && routeObjectsToRoutes(communityAuthRoutes, "community-auth.")}
      {/* The comparison of the editions, which the Community Edition's upsells lead to. */}
      {edition === "community" && (
        <Route
          path="/editions"
          element={
            <ShellPage currentPath="Editions">
              <EditionsPage />
            </ShellPage>
          }
        />
      )}
      {routeObjectsToRoutes(activeEeRoutes(edition))}
      <Route
        path="/profile"
        element={
          <ShellPage currentPath="Profile">
            <AccountPage />
          </ShellPage>
        }
      />

      <Route
        path="/profile/personal-access-tokens"
        element={
          <ShellPage currentPath="Personal Access Tokens">
            <PersonalAccessTokensPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings"
        element={
          <ShellPage currentPath="Settings">
            <SettingsOrganizationPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings/teams"
        element={
          <ShellPage currentPath="Settings Teams">
            <SettingsTeamsPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings/policies"
        element={
          <ShellPage currentPath="Settings Policies" protect>
            <SettingsPoliciesPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings/policies/create"
        element={
          <ShellPage currentPath="Create Policy" protect>
            <CreatePolicyPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings/policies/:policyId/edit"
        element={
          <ShellPage currentPath="Edit Policy" protect>
            <EditPolicyPage />
          </ShellPage>
        }
      />
      <Route
        path="/organization/settings/policies/overview"
        element={
          <ShellPage currentPath="Compliance Overview" protect>
            <OrganizationComplianceOverviewPage />
          </ShellPage>
        }
      />
      {/* Licence management is the cloud's. */}
      {edition !== "community" && (
        <Route
          path="/organization/settings/licenses"
          element={
            <ShellPage currentPath="Settings Licenses" protect>
              <SettingsLicensesPage />
            </ShellPage>
          }
        />
      )}
      <Route
        path="/integrations/github/callback"
        element={
          <ProtectedRouteWrapper>
            <IntegrationGithubPage />
          </ProtectedRouteWrapper>
        }
      />
      {/* GitLab Integration Routes */}
      <Route
        path="/integrations/gitlab/callback"
        element={
          <ProtectedRouteWrapper>
            <GitlabIntegrationPage />
          </ProtectedRouteWrapper>
        }
      />
      {/* Slack Integration Routes */}
      <Route
        path="/integrations/slack/callback"
        element={
          <ProtectedRouteWrapper>
            <IntegrationSlackCallbackPage />
          </ProtectedRouteWrapper>
        }
      />
      {/* Jira Integration Routes */}
      <Route
        path="/integrations/jira/callback"
        element={
          <ProtectedRouteWrapper>
            <IntegrationJiraCallbackPage />
          </ProtectedRouteWrapper>
        }
      />
      {/* Linear Integration Routes */}
      <Route
        path="/integrations/linear/callback"
        element={
          <ProtectedRouteWrapper>
            <IntegrationLinearCallbackPage />
          </ProtectedRouteWrapper>
        }
      />
      <Route path="/invite/:token" element={<OrganizationInvitationPage />} />
      {/* The Community invitation link, `/invite#token=…`: the token rides the fragment, which no server receives. */}
      {edition === "community" && <Route path="/invite" element={<OrganizationInvitationPage />} />}
      <Route
        path="/logout"
        element={
          <ShellPage currentPath="Logout">
            <LogoutPage />
          </ShellPage>
        }
      />
      <Route path="/on-boarding" element={<OnBoardingPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/** The effects the active edition mounts once inside the router; none in the Community Edition. */
const AppEffects = ACTIVE_EXTENSIONS.AppEffects;

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthenticated = useSelector(
    (state: RootState) => state.auth.isAuthenticated
  );
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const userProfile = useSelector((state: RootState) => state.user);
  const appState = useSelector((state: RootState) => state.app);
  const invitationState = useSelector((state: RootState) => state.invitation);
  // The toasts move aside while the background-tasks dropdown is open (toastPlacement.ts).
  const tasksPanelShown = useSelector(selectTasksPanelShown);

  const { loading, authError, retryAuth } = useAuth();
  const { setUser } = useRebac();

  // Mount the background-task SSE lifecycle once at app root (inside Provider).
  // The panel renders as a global overlay, persisting across route changes.
  useBackgroundTasks();

  // Keep launched scans advancing in the background-tasks panel even
  // after the user navigates away from the results page that owns them.
  useActiveScanTasksTracker();

  // The analytics and ad-lead effects this page used to run inline (version and
  // user info reporting, the ad sign-up lead) are the active edition's own:
  // `ACTIVE_EXTENSIONS.AppEffects`, mounted below inside the router.

  const [toastTheme, setToastTheme] = useState(
    localStorage.getItem("theme") || "light"
  );
  const [profileFetched, setProfileFetched] = useState(false);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const initializingRef = useRef(false);

  // Stable ref for setUser so it never triggers the init effect
  const setUserRef = useRef(setUser);
  setUserRef.current = setUser;

  /**
   * Selects and stabilizes the organization based on various priorities.
   * This ensures the organization is set once and remains stable until explicitly changed.
   */
  const selectAndStabilizeOrganization = async (fetchedUserProfile: any) => {
    dispatch(markDataUnstable());

    try {
      // Priority 1: Check for newly joined organization (after invite acceptance)
      const newlyJoinedOrgId = store.getState().invitation.newlyJoinedOrgId;
      if (newlyJoinedOrgId) {
        const foundOrg = fetchedUserProfile.myOrganizations.find(
          (org: ProfileOrganization) => org.id === newlyJoinedOrgId
        );
        if (foundOrg) {
          dispatch(setSelectedOrganization(foundOrg));
          dispatch(clearNewlyJoinedOrgId());
          dispatch(markDataStable());
          return;
        }
      }

      // Priority 2: Restore from localStorage (e.g., after refresh)
      const storedOrgString = localStorage.getItem("selectedOrganization");
      if (storedOrgString) {
        try {
          const storedOrg = JSON.parse(storedOrgString);
          const realOrg = fetchedUserProfile.myOrganizations.find(
            (org: ProfileOrganization) => org.id === storedOrg.id
          );
          if (realOrg) {
            dispatch(setSelectedOrganization(realOrg));
            dispatch(markDataStable());
            return;
          }
        } catch (err) {
          console.warn("Failed to parse selectedOrganization from localStorage", err);
        }
      }

      // Priority 3: Select first organization as default
      if (fetchedUserProfile.myOrganizations.length > 0) {
        const firstOrg = fetchedUserProfile.myOrganizations[0] as ProfileOrganization;
        if (firstOrg && firstOrg.id) {
          dispatch(setSelectedOrganization(firstOrg));
          dispatch(markDataStable());
          return;
        } else {
          throw new Error("First organization in profile is invalid.");
        }
      }

      // No organizations available - this will redirect to onboarding later
      dispatch(markDataStable());
    } catch (error) {
      console.error("Error during organization selection:", error);
      dispatch(markDataStable()); // Still mark as stable to prevent infinite loading
    }
  };

  useEffect(() => {
    const handleThemeChange = () => {
      const newTheme = localStorage.getItem("theme") || "light";
      setToastTheme(newTheme);
    };
    window.addEventListener("themeChange", handleThemeChange);
    return () => {
      window.removeEventListener("themeChange", handleThemeChange);
    };
  }, []);

  /**
   * Handle Invitation Link Logic — split into two effects to avoid a fragile
   * dependency loop:
   *   1) A "set-only" effect that registers the invite context in Redux
   *      whenever we land on /invite/:token. Its deps intentionally exclude
   *      invitationState to prevent re-dispatching when the slice changes.
   *   2) A "redirect-only" effect that, post-login, returns the user to a
   *      pending invite URL that was captured earlier.
   *
   * IMPORTANT: We must wait for `loading` to be false before deciding,
   * otherwise on page refresh the Redux `isAuthenticated` is still false
   * while the auth client restores the session, causing a spurious redirect.
   */
  useEffect(() => {
    if (loading) return; // Wait for the auth client + token sync to settle

    const pathParts = location.pathname.split("/");
    const isInvitePath = pathParts[1] === "invite";
    if (!isInvitePath) return;
    // The Community Edition's invitation token is the whole credential, and
    // the context is persisted in localStorage: it is never recorded there
    // (its /invite/* pages are public, no guard needs it).
    if (EDITION === "community") return;

    // Track the invite context so guards downstream know to skip onboarding/trial.
    // We no longer redirect to /login — the invitation page renders a login form
    // inline so the user stays on the invite URL the whole time.
    dispatch(
      setInvitationContext({
        pendingInviteUrl: location.pathname + location.search,
      })
    );
  }, [loading, location.pathname, location.search, dispatch]);

  useEffect(() => {
    if (loading) return;

    const pathParts = location.pathname.split("/");
    const isInvitePath = pathParts[1] === "invite";
    if (isInvitePath) return;

    if (
      isAuthenticated &&
      invitationState.fromInvitation &&
      invitationState.pendingInviteUrl?.startsWith("/invite/")
    ) {
      // Authenticated elsewhere but still owing an invite acceptance: bring them back.
      const url = invitationState.pendingInviteUrl;
      dispatch(clearInvitationContext());
      navigate(url);
    }
  }, [
    loading,
    location.pathname,
    isAuthenticated,
    navigate,
    dispatch,
    invitationState.fromInvitation,
    invitationState.pendingInviteUrl,
  ]);

  /**
   * Handle Authentication Redirects:
   * - If not authenticated and not on /login or /invite/*, redirect to /login.
   * - In the Community Edition: any page but its sign-in pages and /invite/*
   *   asks the setup status, then goes to /setup while setup is open, else to
   *   /login with the page as returnTo.
   */
  useEffect(() => {
    if (EDITION !== "community" || loading || isAuthenticated) return;
    if (isCommunityPublicPath(location.pathname)) return;
    let cancelled = false;
    const from = location.pathname + location.search;
    getSetupStatus()
      .then((status) => status, () => null)
      .then((status) => {
        if (!cancelled) navigate(communitySignInRedirect(from, status), { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (EDITION === "community") return;
    if (!loading && !isAuthenticated) {
      const pathParts = location.pathname.split("/");
      const isLoginPath = location.pathname === "/login";
      const isCallbackPath = location.pathname === "/callback";
      const isInvitePath = pathParts[1] === "invite";
      const isSsoPath = location.pathname === "/sso";

      if (!isLoginPath && !isCallbackPath && !isInvitePath && !isSsoPath) {
        // Keep the legacy generic redirect flag for non-invite entry points
        // (e.g. deep link to /project/X when not authenticated).
        localStorage.setItem(
          "pendingRedirectUrl",
          location.pathname + location.search
        );
        navigate(loginPath());
      }
    }
  }, [loading, isAuthenticated, location.pathname, navigate]);

  /**
   * Sequenced Data Loading and App Initialization:
   * This effect manages the complete application initialization sequence to prevent 
   * cascade renders and multiple API calls in child components.
   * 
   * The sequence ensures:
   * 1. User profile is fetched first
   * 2. Organization is selected and stabilized
   * 3. Only then are protected routes rendered and can safely fetch their data
   * 
   * This eliminates the race conditions that caused multiple API calls in 
   * ResultsSastPage, ResultsScaPage, and ResultsIacPage.
   */
  useEffect(() => {
    if (!loading && isAuthenticated && !profileFetched && !initializingRef.current) {
      initializingRef.current = true;
      dispatch(startAppInitialization());

      const initializeAppData = async () => {
        setOrganizationError(null);
        try {
          // Step 1: Fetch user profile
          const fetchedUserProfile = await fetchMyProfile();
          dispatch(setUserProfile(fetchedUserProfile));

          // Step 2: Configure ReBAC permissions
          const organizationEntities = fetchedUserProfile.myOrganizations.map(
            (org: { id: any; myRole: any }) => ({
              id: org.id,
              type: "organization",
              relation: org.myRole,
            })
          );
          const teamEntities = fetchedUserProfile.myOrganizations.flatMap(
            (org: { myTeams: Team[] }) =>
              org.myTeams.map((team: Team) => ({
                id: team.id,
                name: team.name,
                description: team.description,
                type: "team",
                relation: team.myRole,
              }))
          );
          setUserRef.current([...organizationEntities, ...teamEntities]);

          // Step 3: Select and stabilize organization
          await selectAndStabilizeOrganization(fetchedUserProfile);

          // Step 4: Complete initialization
          dispatch(completeAppInitialization());
          setProfileFetched(true);

        } catch (error: any) {
          console.error("Error during app initialization:", error);
          // A marker only: the page says it in its own translated words (AppFailurePage).
          setOrganizationError("workspace-unavailable");
          dispatch(completeAppInitialization()); // Still complete to avoid infinite loading
          setProfileFetched(true);
        } finally {
          initializingRef.current = false;
        }
      };

      initializeAppData();
    }
  }, [loading, isAuthenticated, profileFetched, dispatch]);

  /**
   * Handle Post-Profile Fetch Logic:
   * Now simplified since initialization is properly sequenced.
   * Only handles pending invitation redirects and onboarding.
   */
  useEffect(() => {
    // Not while the profile failed to load, nor before it really has: the
    // catch leaves it without organisations, which read as « no organisation
    // yet » and sent the tab to /on-boarding behind the failure page, so
    // « Try again » reloaded /on-boarding instead of the page the account
    // asked for. `isProfileLoaded` is in the same store update as
    // `isAppInitialized`; `organizationError`, a component state, commits
    // one render later, so it cannot guard that first render on its own.
    if (organizationError || !userProfile.isProfileLoaded) return;

    // Only run after app is initialized and data is stable
    if (isAuthenticated && appState.isAppInitialized && appState.isDataStable && userProfile) {

      // Priority 0: Handle pending invitation redirect (Redux slice source of truth)
      if (
        invitationState.fromInvitation &&
        invitationState.pendingInviteUrl?.startsWith("/invite/") &&
        !isInvitationPagePath(location.pathname)
      ) {
        const url = invitationState.pendingInviteUrl;
        dispatch(clearInvitationContext());
        navigate(url);
        return;
      }

      // Onboarding Check - redirect if user has no organizations
      // BUT skip if user is on an invitation page (they need to accept first)
      if (userProfile.myOrganizations.length === 0) {
        if (location.pathname !== '/on-boarding' && !isInvitationPagePath(location.pathname)) {
          navigate("/on-boarding");
        }
        return;
      }

      // What follows (the subscription status check of an edition that bills)
      // is the edition's own effect, `ACTIVE_EXTENSIONS.AppEffects`, mounted
      // below inside the router.
    }
  }, [organizationError, isAuthenticated, appState.isAppInitialized, appState.isDataStable, userProfile, selectedOrganization, navigate, location.pathname, invitationState.fromInvitation, invitationState.pendingInviteUrl, invitationState.newlyJoinedOrgId, dispatch]);

  // Show loading while authenticating or initializing.
  // `authError` short-circuits it: the auth bootstrap gave up (see the
  // edition's auth client, useLogtoAuth in the cloud), and a full-page
  // spinner with no way out is exactly the "stuck on Chargement" bug we are fixing — surface the error instead.
  if (!authError && (loading || (isAuthenticated && !appState.isAppInitialized))) {
    return <LoaderHome />;
  }

  // The app could not start: the sign-in bootstrap gave up (`authError`), or
  // the profile and the organisation could not be loaded. One page for both
  // (AppFailurePage), in the product of the address; the actions are kept
  // exactly as they were.
  const failure = appFailureVariant({ authError: authError !== null, organizationError, isAuthenticated });
  if (failure) {
    return (
      <AppFailurePage
        variant={failure}
        onRetry={() => {
          setOrganizationError(null);
          setProfileFetched(false);
          if (failure === 'session') {
            retryAuth();
          } else {
            reloadPage();
          }
        }}
        // No network call: the failure being escaped may be the sign-in
        // service itself being unreachable. The same purge as the crash page's.
        onSignIn={escapeToSignIn}
      />
    );
  }

  return (
    <BreadcrumbProjectProvider>
    <div className="dark:bg-neutral-900 bg-alternative-light min-h-screen">
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        style={appToastStyle(tasksPanelShown)}
        theme={toastTheme}
      />
      <div id="portal-root"></div>
      <BackgroundTasksPanel />
      <ScrollToTopOnNavigate />
      {/* The effects of the active edition (a billing edition's subscription redirects). */}
      {AppEffects && <AppEffects />}
      {appRouteTable()}
    </div>
    </BreadcrumbProjectProvider>
  );
}

export default App;
