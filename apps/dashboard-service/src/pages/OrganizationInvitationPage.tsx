import { supportUrl } from '@/edition/support';
import { isPast, isValid } from "date-fns";
import { formatRelativeTime } from "@/utils/relativeTime";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock, Code2, Home, Mail, ShieldCheck, SignOut, UserCircle2, Users, XCircle } from '@/components/atoms/icon/icons';
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast, ToastContainer } from "react-toastify";
import { useTranslation } from "react-i18next";
import { useRebac } from "react-rebac";
import { authClient } from "@/edition/auth/useAuth";
import { motion } from "framer-motion";
import { acceptOrganizationInvite, fetchOrganizationById } from "../server/services/organizationService";
import { fetchMyProfile } from "../server/services/userService";
import useLogout from "../server/hooks/useLogout";
import { clearInviteEmail, readInviteEmail } from "@/lib/invite-email";
import { takeInviteTokenFromPath } from "@/lib/invite-token";
import { forgetInviteToReturnTo, rememberInviteToReturnTo } from "@/lib/invite-return";
import { setUserProfile } from "../server/store/userSlice";
import { setSelectedOrganization } from "../server/store/organizationSlice";
import {
  setInvitationContext,
  clearInvitationContext,
  setNewlyJoinedOrgId,
  resetInvitation,
} from "../server/store/invitationSlice";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../server/store";
import { Team } from "@/server/interfaces/Team";
import { ProfileOrganization } from "@/server/interfaces/Organization";
import { cn } from "@/utils/function/utils";
import { EDITION } from "@/edition/edition";
import InvitationAcceptForm from "./community-auth/InvitationAcceptForm";
import { INVITATION_TOKEN_PATTERN } from "@/edition/auth/community/authApi";
import { AUTH_REFUSAL_KEYS } from "./community-auth/authRefusals";
import { ROLE_REFUSAL_KEY, roleRefusalOf } from "@/utils/organizationRoleRefusal";
import { apiErrorKey } from '@/utils/function/apiErrorKey';

/**
 * The token of a Community invitation (the form and the signed-in flow check
 * it). The link is `/invite#token=<token>`: the fragment leaves the address
 * bar before anything renders or sends (also done at boot), and the token is
 * then held in memory only. The former `/invite/<token>` path (links already
 * sent) is still read, one trailing slash dropped, and the address bar is
 * rewritten to `/invite` the same way. Empty for a malformed or missing token.
 */
const communityInviteToken = (pathname: string): string => takeInviteTokenFromPath(pathname) ?? "";

const isSameEmail = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const OrganizationInvitationPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { t, i18n } = useTranslation();
  const { setUser } = useRebac();
  const logout = useLogout();
  const isAuthenticated = useSelector(
    (s: RootState) => !!s.auth?.isAuthenticated || !!s.auth?.accessToken
  );
  const currentEmail = useSelector((s: RootState) => s.user?.email || "");

  // The Community token leaves the address bar on the first render (the
  // fragment, or the former path rewritten to `/invite`), before any effect of
  // this page can send a request, and is read once per path: the router keeps
  // the former path while the address bar shows `/invite`.
  const communityToken = useMemo(
    () => (EDITION === "community" ? communityInviteToken(location.pathname) : ""),
    [location.pathname],
  );

  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationRole, setOrganizationRole] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [token, setToken] = useState("");
  const [isValidInvitation, setIsValidInvitation] = useState(true);
  // The address the invitation mail was sent to (src/lib/invite-email.ts);
  // null for a link that predates it.
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [acceptRefusal, setAcceptRefusal] = useState<"emailMismatch" | "notFound" | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Only a hint: the server compares the addresses and has the last word.
  const emailMismatch =
    isAuthenticated &&
    !!invitedEmail &&
    !!currentEmail &&
    !isSameEmail(invitedEmail, currentEmail);
  const refusal = emailMismatch ? "emailMismatch" : acceptRefusal;

  const LoadingSpinner: React.FC = () => (
    <div className="animate-spin w-5 h-5">
      <svg className="w-full h-full" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );

  useEffect(() => {
    const validateAndSetInvitation = () => {
      try {
        const pathToken = location.pathname.split("/invite/")[1];

        const queryParams = new URLSearchParams(location.search);
        const orgName = queryParams.get("organizationName");
        const orgRole = queryParams.get("organizationRole");
        const expiresAtString = queryParams.get("expiresAt");

        // A Community invitation link is `${origin}/invite#token=<token>` (or the
        // former `/invite/<token>`): the token alone is the invitation. Any name, role or expiry in the query was
        // chosen by whoever wrote the link, and is ignored.
        if (EDITION === "community") {
          if (!INVITATION_TOKEN_PATTERN.test(communityToken)) {
            setIsValidInvitation(false);
            setError(t(AUTH_REFUSAL_KEYS.INVITATION_INVALID));
            return;
          }
          setToken(communityToken);
          setInvitedEmail(readInviteEmail(communityToken));
          setIsValidInvitation(true);
          setError(null);
          return;
        }

        if (!orgName || !orgRole || !expiresAtString || !pathToken) {
          setIsValidInvitation(false);
          setError(t('pages.orgInvitation.errors.invalidLink'));
          return;
        }

        const expiresAtDate = new Date(expiresAtString);

        if (!isValid(expiresAtDate)) {
          setIsValidInvitation(false);
          setError(t('pages.orgInvitation.errors.invalidDate'));
          return;
        }

        if (isPast(expiresAtDate)) {
          setIsValidInvitation(false);
          setError(t('pages.orgInvitation.errors.expired'));
          return;
        }

        setOrganizationName(orgName);
        setOrganizationRole(orgRole);
        setExpiresAt(expiresAtDate);
        setToken(pathToken);
        setInvitedEmail(readInviteEmail(pathToken));
        setIsValidInvitation(true);
        setError(null);
      } catch (error) {
        setIsValidInvitation(false);
        setError(t('pages.orgInvitation.errors.invalidFormat'));
      }
    };

    validateAndSetInvitation();
    // `t` intentionally omitted: i18n returns a new function each render with
    // some mocks, which would re-trigger this effect infinitely in tests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // Register/refresh the invite context in Redux once per pathname+search
  // so App-level guards know to skip onboarding/trial redirects.
  useEffect(() => {
    // Never in the Community Edition: the context is persisted in
    // localStorage, and there the token alone accepts the invitation.
    if (EDITION === "community") return;
    const pathToken = location.pathname.split("/invite/")[1];
    if (!pathToken) return;
    dispatch(
      setInvitationContext({
        pendingInviteUrl: location.pathname + location.search,
      })
    );
  }, [location.pathname, location.search, dispatch]);

  const handleAcceptInvite = async () => {
    if (!isValidInvitation || loading || emailMismatch) return;
    setLoading(true);
    setAcceptRefusal(null);
    try {
      const acceptResponse = await acceptOrganizationInvite({ token });
      const joinedOrgId: string | undefined = acceptResponse?.organization?.id;

      // Show success state while IAM permissions propagate (Permify writes)
      setAccepted(true);
      setLoading(false);
      clearInviteEmail();

      if (joinedOrgId) {
        dispatch(setNewlyJoinedOrgId(joinedOrgId));
      }

      // Wait for IAM/Permify permissions to be fully written
      const targetOrgId = joinedOrgId;
      if (targetOrgId) {
        await waitForOrganizationReady(targetOrgId);
      }

      // Now that permissions are ready, fetch the fresh profile
      try {
        const updatedUserProfile = await fetchMyProfile();
        dispatch(setUserProfile(updatedUserProfile));

        // Select the newly joined organization (or first available)
        if (updatedUserProfile.myOrganizations?.length > 0) {
          let orgToSelect: ProfileOrganization | undefined;
          if (joinedOrgId) {
            orgToSelect = updatedUserProfile.myOrganizations.find(
              (org: ProfileOrganization) => org.id === joinedOrgId
            );
          }
          if (!orgToSelect) {
            orgToSelect = updatedUserProfile.myOrganizations[0] as ProfileOrganization;
          }
          if (orgToSelect) {
            dispatch(setSelectedOrganization(orgToSelect));
          }
        }

        // Reconfigure ReBAC permissions with fresh data
        const organizationEntities = updatedUserProfile.myOrganizations.map(
          (org: { id: string; myRole: string }) => ({
            id: org.id,
            type: "organization",
            relation: org.myRole,
          })
        );
        const teamEntities = updatedUserProfile.myOrganizations.flatMap(
          (org: { myTeams: Team[] }) =>
            org.myTeams.map((team: Team) => ({
              id: team.id,
              name: team.name,
              description: team.description,
              type: "team",
              relation: team.myRole,
            }))
        );
        setUser([...organizationEntities, ...teamEntities]);
      } catch {
        // Profile fetch failed — not critical, App.tsx will re-fetch on redirect
      }

      // Clear the pending invite context but keep newlyJoinedOrgId so the
      // App-level guards can recognize the user as freshly joined and skip
      // /trial + onboarding.
      dispatch(clearInvitationContext());
      navigate("/");
    } catch (error: any) {
      // The two refusals the invitee can act on, by switching accounts, stay
      // on screen; the gateway only answers 403 here for another address.
      const status = error?.response?.status;
      if (status === 403) {
        setAcceptRefusal("emailMismatch");
      } else if (status === 404) {
        setAcceptRefusal("notFound");
      } else if (EDITION === "community") {
        // A fixed sentence, never the server's text: the role the invitation
        // names may be one this edition gives nobody (ROLE_NOT_AVAILABLE).
        toast.error(t(roleRefusalOf(error) ? ROLE_REFUSAL_KEY : 'pages.orgInvitation.toast.acceptError'));
      } else {
        toast.error(t(apiErrorKey(error, { fallback: 'pages.orgInvitation.toast.acceptError' })));
      }
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Logto's sign-out can only come back to /login, which sends the invitee
    // back here to sign in with the invited account.
    // Not in the Community Edition: its sign-in page never reads the marker,
    // and the path holds the token that accepts the invitation.
    if (EDITION !== "community") rememberInviteToReturnTo(location.pathname + location.search);
    try {
      await logout();
    } catch {
      forgetInviteToReturnTo();
      toast.error(t('pages.orgInvitation.account.signOutError'));
      setSigningOut(false);
    }
  };

  /**
   * Poll GET /organization/:id until the org is accessible,
   * proving that IAM/Permify permissions have been written.
   * First attempt after 1s, then 1s between each retry, max 10 retries.
   */
  const waitForOrganizationReady = async (orgId: string): Promise<void> => {
    const MAX_RETRIES = 10;
    const INTERVAL_MS = 1_000;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Initial delay before first check
    await sleep(INTERVAL_MS);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await fetchOrganizationById(orgId);
        return; // 200 = permissions are ready
      } catch {
        // 403/404 = permissions not yet written — continue polling
      }

      if (attempt < MAX_RETRIES) {
        await sleep(INTERVAL_MS);
      }
    }
    // Max retries reached — redirect anyway, permissions may still propagate
  };

  const handleGoBackHome = () => {
    dispatch(resetInvitation());
    clearInviteEmail();
    navigate("/");
  };

  const handleProviderLogin = async (providerName: string) => {
    if (loadingProvider) return;
    setLoadingProvider(providerName);
    try {
      // The edition's client signs in: through the chosen provider when it
      // offers providers (the cloud), otherwise back to this invitation.
      if (authClient.signInWithProvider) {
        await authClient.signInWithProvider(providerName);
      } else {
        await authClient.signIn(location.pathname + location.search);
      }
    } catch (err) {
      console.error("[invite login]", err);
      toast.error(t('pages.orgInvitation.login.providerError'));
      setLoadingProvider(null);
    }
  };

  const providers: Array<{ name: string; label: string; key: string }> = [
    { name: "google", label: "Google", key: "continueWithGoogle" },
    { name: "microsoft", label: "Microsoft", key: "continueWithMicrosoft" },
    { name: "github", label: "GitHub", key: "continueWithGithub" },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
  };

  // The Community Edition: a signed-out invitee creates the account that
  // accepts the invitation (a signed-in one accepts below, as in the cloud).
  if (EDITION === "community" && !isAuthenticated && !accepted) {
    return <InvitationAcceptForm token={communityToken} />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col md:flex-row">
        <motion.div
          className="flex-1 bg-primary flex flex-col justify-between p-8 md:pl-20 md:pr-32"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <a href="/" className="flex items-center space-x-2 text-white mb-8">
            <motion.img
              src="/logo-white.webp"
              alt="Logo"
              className="w-44 md:w-96 mb-10"
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 300 }}
            />
          </a>
          <motion.div
            className="space-y-8"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div className="text-white space-y-6" variants={itemVariants}>
              <h1 className="text-3xl md:text-5xl font-bold leading-tight">
                {t('pages.orgInvitation.hero.title').split('\n').map((line, i) => (<React.Fragment key={i}>{line}<br /></React.Fragment>))}
              </h1>
              <p className="text-xl opacity-90">
                {t('pages.orgInvitation.hero.subtitle')}
              </p>
            </motion.div>

            <motion.div className="grid grid-cols-1 gap-6 mt-8" variants={itemVariants}>
              <div className="flex items-center space-x-4 text-white/90">
                <ShieldCheck className="w-8 h-8 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">{t('pages.orgInvitation.features.appSec.title')}</h3>
                  <p className="text-white/70">{t('pages.orgInvitation.features.appSec.description')}</p>
                </div>
              </div>
              <div className="flex items-center space-x-4 text-white/90">
                <Users className="w-8 h-8 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">{t('pages.orgInvitation.features.collab.title')}</h3>
                  <p className="text-white/70">{t('pages.orgInvitation.features.collab.description')}</p>
                </div>
              </div>
              <div className="flex items-center space-x-4 text-white/90">
                <Code2 className="w-8 h-8 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">{t('pages.orgInvitation.features.ai.title')}</h3>
                  <p className="text-white/70">{t('pages.orgInvitation.features.ai.description')}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            className="text-white/60 text-sm mt-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            {t('common.copyright', { year: new Date().getFullYear() })}
          </motion.div>
        </motion.div>

        <motion.div
          className={cn(
            "flex-1 flex items-center justify-center p-6",
            "bg-neutral-50 dark:bg-neutral-900"
          )}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <motion.div
            className={cn(
              "max-w-md w-full space-y-8 p-8 rounded-2xl shadow-xl",
              "bg-white dark:bg-neutral-800",
              "border border-neutral-200 dark:border-neutral-700"
            )}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <div className="text-center space-y-6">
              <motion.div
                className={cn(
                  "w-20 h-20 rounded-full flex items-center justify-center mx-auto",
                  "bg-red-100 dark:bg-red-900/20"
                )}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.4 }}
              >
                <XCircle className="h-10 w-10 text-red-500" />
              </motion.div>

              <div className="space-y-2">
                <h2 className={cn(
                  "text-2xl font-bold",
                  "text-neutral-800 dark:text-white"
                )}>
                  {t('pages.orgInvitation.errorState.title')}
                </h2>
                <p className="text-neutral-600 dark:text-neutral-300">{error}</p>
              </div>

              <div className={cn(
                "rounded-2xl p-6 text-left",
                "bg-neutral-50 dark:bg-neutral-700/50"
              )}>
                <h3 className={cn(
                  "font-medium mb-2",
                  "text-neutral-800 dark:text-white"
                )}>
                  {t('pages.orgInvitation.errorState.whatToDo')}
                </h3>
                <ul className="space-y-3 text-neutral-600 dark:text-neutral-300">
                  <li className="flex items-start">
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-secondary mt-2 mr-2"></span>
                    {t('pages.orgInvitation.errorState.contactMember')}
                  </li>
                  <li className="flex items-start">
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-secondary mt-2 mr-2"></span>
                    {t('pages.orgInvitation.errorState.askNewLink')}
                  </li>
                  <li className="flex items-start">
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-secondary mt-2 mr-2"></span>
                    {t('pages.orgInvitation.errorState.useWithin7Days')}
                  </li>
                </ul>
              </div>

              <div className={cn(
                "text-sm rounded-2xl p-4",
                "text-neutral-500 dark:text-neutral-400"
              )}>
                <p>
                  {t('pages.orgInvitation.errorState.needHelp')}
                  <a
                    href={supportUrl()}
                    className="text-secondary hover:text-secondary/80 transition-colors"
                  >
                    {t('pages.notFound.actions.needHelp.button')}
                  </a>
                </p>
              </div>
              <motion.button
                onClick={handleGoBackHome}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl shadow-md",
                  "text-sm font-medium text-white",
                  "bg-secondary hover:bg-secondary/90",
                  "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary",
                  "transition-all duration-200"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Home className="h-5 w-5" />
                {t('pages.orgInvitation.errorState.returnHome')}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <motion.div
        className="flex-1 bg-primary flex flex-col justify-between p-8 md:pl-20 md:pr-32"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <motion.img
          src="/logo-white.webp"
          alt="Logo"
          className="w-44 md:w-96 mb-10"
          whileHover={{ scale: 1.02 }}
          transition={{ type: "spring", stiffness: 300 }}
        />
        <motion.div
          className="space-y-8"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="text-white space-y-6" variants={itemVariants}>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight">
              {t('pages.orgInvitation.hero.title').split('\n').map((line, i) => (<React.Fragment key={i}>{line}<br /></React.Fragment>))}
            </h1>
            <p className="text-xl opacity-90">
              {t('pages.orgInvitation.hero.subtitle')}
            </p>
          </motion.div>

          <motion.div className="grid grid-cols-1 gap-6 mt-8" variants={itemVariants}>
            <motion.div
              className="flex items-center space-x-4 text-white/90"
              whileHover={{ x: 5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <ShieldCheck className="w-8 h-8 flex-shrink-0" />
              <div>
                <h3 className="font-semibold">{t('pages.orgInvitation.features.appSec.title')}</h3>
                <p className="text-white/70">{t('pages.orgInvitation.features.appSec.description')}</p>
              </div>
            </motion.div>
            <motion.div
              className="flex items-center space-x-4 text-white/90"
              whileHover={{ x: 5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Users className="w-8 h-8 flex-shrink-0" />
              <div>
                <h3 className="font-semibold">{t('pages.orgInvitation.features.collab.title')}</h3>
                <p className="text-white/70">{t('pages.orgInvitation.features.collab.description')}</p>
              </div>
            </motion.div>
            <motion.div
              className="flex items-center space-x-4 text-white/90"
              whileHover={{ x: 5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Code2 className="w-8 h-8 flex-shrink-0" />
              <div>
                <h3 className="font-semibold">{t('pages.orgInvitation.features.ai.title')}</h3>
                <p className="text-white/70">{t('pages.orgInvitation.features.ai.description')}</p>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        <motion.div
          className="text-white/60 text-sm mt-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {t('common.copyright', { year: new Date().getFullYear() })}
        </motion.div>
      </motion.div>

      <motion.div
        className={cn(
          "flex-1 flex items-center justify-center p-6",
          "bg-neutral-50 dark:bg-neutral-900"
        )}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <ToastContainer />
        <motion.div
          className={cn(
            "max-w-md w-full space-y-8 p-8 rounded-2xl shadow-xl",
            "bg-white dark:bg-neutral-800",
            "border border-neutral-200 dark:border-neutral-700"
          )}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="text-center space-y-4">
            <motion.div
              className="bg-secondary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.4 }}
            >
              <Building2 className="h-8 w-8 text-secondary" />
            </motion.div>
            <h1 className={cn(
              "text-3xl font-bold",
              "text-neutral-800 dark:text-white"
            )}>
              {t('pages.orgInvitation.form.title')}
            </h1>
            <p className="text-neutral-600 dark:text-neutral-300">
              {EDITION === "community"
                ? t('pages.communityAuth.invitation.signedInSubtitle')
                : t('pages.orgInvitation.form.subtitle', { organizationName })}
            </p>
          </div>

          <div className="space-y-4 mt-8">
            {EDITION !== "community" && (<>
            <motion.div
              className={cn(
                "flex items-center space-x-3 p-4 rounded-2xl",
                "bg-neutral-50 dark:bg-neutral-700/50"
              )}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <UserCircle2 className="h-5 w-5 text-secondary" />
              <div>
                <p className={cn(
                  "text-sm font-medium",
                  "text-neutral-800 dark:text-white"
                )}>
                  {t('pages.orgInvitation.form.yourRole')}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 font-semibold">
                  {organizationRole}
                </p>
              </div>
            </motion.div>

            <motion.div
              className={cn(
                "flex items-center space-x-3 p-4 rounded-2xl",
                "bg-neutral-50 dark:bg-neutral-700/50"
              )}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Clock className="h-5 w-5 text-secondary" />
              <div>
                <p className={cn(
                  "text-sm font-medium",
                  "text-neutral-800 dark:text-white"
                )}>
                  {t('pages.orgInvitation.form.expires')}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  {expiresAt
                    ? formatRelativeTime(expiresAt.toISOString(), i18n.language)
                    : t('pages.orgInvitation.form.loading')}
                </p>
              </div>
            </motion.div>
            </>)}

            {invitedEmail && (
              <motion.div
                className={cn(
                  "flex items-center space-x-3 p-4 rounded-2xl",
                  "bg-neutral-50 dark:bg-neutral-700/50"
                )}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <Mail className="h-5 w-5 flex-shrink-0 text-secondary" />
                <div className="min-w-0">
                  <p className={cn(
                    "text-sm font-medium",
                    "text-neutral-800 dark:text-white"
                  )}>
                    {t('pages.orgInvitation.form.invitedEmail')}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 font-semibold break-all">
                    {invitedEmail}
                  </p>
                </div>
              </motion.div>
            )}

            <div className="pt-4">
              {accepted ? (
                <motion.div
                  className={cn(
                    "w-full flex flex-col items-center justify-center py-4 px-4 rounded-xl",
                    "bg-green-500/10 border border-green-500/30"
                  )}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center space-x-2 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-base font-medium">
                      {t('pages.orgInvitation.form.accepted')}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                    <LoadingSpinner />
                    <span>{t('pages.orgInvitation.form.settingUpPermissions')}</span>
                  </div>
                </motion.div>
              ) : isAuthenticated ? (
                <div className="space-y-4">
                  {refusal ? (
                    <div
                      role="alert"
                      className={cn(
                        "flex items-start gap-3 p-4 rounded-2xl text-left",
                        "border border-amber-300 bg-amber-50",
                        "dark:border-amber-500/40 dark:bg-amber-500/10"
                      )}
                    >
                      <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0 space-y-2">
                        <p className="text-sm font-semibold text-neutral-800 dark:text-white">
                          {refusal === "emailMismatch"
                            ? t('pages.orgInvitation.account.mismatchTitle')
                            : t('pages.orgInvitation.account.notFoundTitle')}
                        </p>
                        <p className="text-sm text-neutral-600 dark:text-neutral-300 break-words">
                          {refusal === "notFound"
                            ? t('pages.orgInvitation.account.notFoundDescription')
                            : emailMismatch
                              ? t('pages.orgInvitation.account.mismatchDescription', {
                                  invitedEmail,
                                  currentEmail,
                                })
                              : t('pages.orgInvitation.account.mismatchDescriptionGeneric')}
                        </p>
                        <motion.button
                          type="button"
                          onClick={handleSwitchAccount}
                          disabled={signingOut}
                          className={cn(
                            "inline-flex items-center gap-2 py-2 px-3 rounded-lg",
                            "text-sm font-medium text-white",
                            "bg-secondary hover:bg-secondary/90",
                            "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            "transition-colors duration-200"
                          )}
                          whileHover={!signingOut ? { scale: 1.02 } : {}}
                          whileTap={!signingOut ? { scale: 0.98 } : {}}
                        >
                          <SignOut className="h-4 w-4" />
                          {t('pages.orgInvitation.account.switchAccount')}
                        </motion.button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "flex items-center justify-between gap-3 py-3 px-4 rounded-2xl",
                        "bg-neutral-50 dark:bg-neutral-700/50"
                      )}
                    >
                      <p className="min-w-0 text-sm text-neutral-600 dark:text-neutral-300 break-all">
                        {currentEmail
                          ? t('pages.orgInvitation.account.signedInAs', { email: currentEmail })
                          : null}
                      </p>
                      <motion.button
                        type="button"
                        onClick={handleSwitchAccount}
                        disabled={signingOut}
                        className={cn(
                          "flex flex-shrink-0 items-center gap-2 py-1.5 px-3 rounded-lg",
                          "text-sm font-medium",
                          "text-neutral-700 dark:text-neutral-200",
                          "border border-neutral-200 dark:border-neutral-600",
                          "hover:bg-white dark:hover:bg-neutral-700",
                          "focus:outline-none focus:ring-2 focus:ring-secondary/40",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          "transition-colors duration-200"
                        )}
                        whileHover={!signingOut ? { scale: 1.02 } : {}}
                        whileTap={!signingOut ? { scale: 0.98 } : {}}
                      >
                        <SignOut className="h-4 w-4" />
                        {t('pages.orgInvitation.account.signOut')}
                      </motion.button>
                    </div>
                  )}

                  <motion.button
                    onClick={handleAcceptInvite}
                    disabled={loading || !isValidInvitation || emailMismatch}
                    className={cn(
                      "w-full flex items-center justify-center py-4 px-4 rounded-xl shadow-md",
                      "text-base font-medium text-white",
                      "transition-all duration-200 ease-in-out",
                      "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary",
                      loading || emailMismatch
                        ? "bg-secondary/70 cursor-not-allowed"
                        : "bg-secondary hover:bg-secondary/90 active:bg-secondary/95"
                    )}
                    whileHover={!loading && !emailMismatch ? { scale: 1.02 } : {}}
                    whileTap={!loading && !emailMismatch ? { scale: 0.98 } : {}}
                  >
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="h-5 w-5" />
                      <span>
                        {loading
                          ? t('pages.orgInvitation.form.buttonLoading')
                          : t('pages.orgInvitation.form.buttonAccept')}
                      </span>
                      {loading ? (
                        <LoadingSpinner />
                      ) : (
                        <ArrowRight className="ml-2 h-5 w-5" />
                      )}
                    </div>
                  </motion.button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className={cn(
                      "text-base font-semibold",
                      "text-neutral-800 dark:text-white"
                    )}>
                      {t('pages.orgInvitation.login.heading')}
                    </h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {t('pages.orgInvitation.login.description')}
                    </p>
                  </div>
                  {providers.map((p) => (
                    <motion.button
                      key={p.name}
                      type="button"
                      onClick={() => handleProviderLogin(p.name)}
                      disabled={loadingProvider !== null}
                      className={cn(
                        "w-full flex items-center justify-between py-3 px-4 rounded-xl",
                        "text-sm font-medium",
                        "border border-neutral-200 dark:border-neutral-600",
                        "bg-white dark:bg-neutral-800",
                        "text-neutral-800 dark:text-white",
                        "transition-all duration-200",
                        "hover:border-secondary/50 hover:shadow-md",
                        "focus:outline-none focus:ring-2 focus:ring-secondary/50",
                        "disabled:cursor-not-allowed disabled:opacity-60"
                      )}
                      whileHover={loadingProvider === null ? { scale: 1.01 } : {}}
                      whileTap={loadingProvider === null ? { scale: 0.99 } : {}}
                    >
                      <span>
                        {loadingProvider === p.name
                          ? t('pages.orgInvitation.login.connecting')
                          : t(
                              `pages.orgInvitation.login.${p.key}`,
                              `Continue with ${p.label}`
                            )}
                      </span>
                      {loadingProvider === p.name ? (
                        <LoadingSpinner />
                      ) : (
                        <ArrowRight className="h-5 w-5 opacity-70" />
                      )}
                    </motion.button>
                  ))}
                </div>
              )}

              <p className={cn(
                "text-center text-sm mt-4",
                "text-neutral-500 dark:text-neutral-400"
              )}>
                {t('pages.orgInvitation.form.terms')}
              </p>

              <motion.button
                type="button"
                onClick={handleGoBackHome}
                className={cn(
                  "w-full flex items-center justify-center gap-2 mt-3 py-2.5 px-4 rounded-xl",
                  "text-sm font-medium",
                  "text-neutral-600 dark:text-neutral-300",
                  "border border-neutral-200 dark:border-neutral-600",
                  "bg-white/0 hover:bg-neutral-50 dark:hover:bg-neutral-700/50",
                  "transition-colors duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-secondary/40"
                )}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <Home className="h-5 w-5" />
                {t('pages.orgInvitation.login.backHome')}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default OrganizationInvitationPage;
