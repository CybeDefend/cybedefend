import { motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";

import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { createOrganization } from "../../server/services/organizationService";
import { RootState } from "../../server/store";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import { useTranslation } from "react-i18next";
import { OrganizationCreationRequestDto } from "../../server/interfaces/Organization";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import { EDITION } from "@/edition/edition";
import { ArrowLeft, ArrowRight, Building2, CreditCard, Mail, PlusCircle, Shield, UserPlus } from '@/components/atoms/icon/icons';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { useIsCompactViewport } from '@/utils/hooks/useIsCompactViewport';
import AtomSelect from '@/components/atoms/select/Select';
import Loader from '@/components/atoms/loader/Loader';
import { apiErrorKey } from '@/utils/function/apiErrorKey';

export function buildOrgCreatePayload(base: OrganizationCreationRequestDto, hdyhau?: string): OrganizationCreationRequestDto {
  // The closed tree's captures ride the org-create payload: the analytics and
  // URL attribution merged (the converting click → reliable last-touch + the
  // cross-session first-touch), the intended plan and the invite-mail lead.
  // Without the marketing extension (the Community Edition, where no boot
  // hook ever captured anything) no extra is attached.
  const extras = ACTIVE_EXTENSIONS.marketing?.readOrgCreateExtras() ?? {};
  return {
    ...base,
    ...(extras.attribution ? { attribution: extras.attribution } : {}),
    ...(hdyhau ? { hdyhau } : {}),
    ...(extras.intendedPlan ? { intendedPlan: extras.intendedPlan } : {}),
    ...(extras.leadId ? { leadId: extras.leadId } : {}),
  };
}

type OnboardingView = "auto" | "chooser" | "create" | "join";

type AdAutoCreateOutcome =
  | { kind: "created" }
  | { kind: "failed" }
  | { kind: "running-elsewhere"; remainingMs: number };

/**
 * The ad visitor's automatic creation, once per page load: re-renders and
 * remounts of the page join it instead of creating a second organisation.
 */
let adAutoCreateRun: Promise<AdAutoCreateOutcome> | null = null;

export function resetAdAutoCreateForTests(): void {
  adAutoCreateRun = null;
}

/** Resolves when `promise` settles or after `ms`, whichever comes first. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/** A full reload after any organisation creation — the closed tree's own when it is there. */
function reloadAfterOrgCreation(): void {
  const reload = ACTIVE_EXTENSIONS.marketing?.adAutoCreate.reloadPage;
  if (reload) reload();
  else window.location.reload();
}

async function runAdAutoCreate(name: string): Promise<AdAutoCreateOutcome> {
  const ad = ACTIVE_EXTENSIONS.marketing?.adAutoCreate;
  // A reload or another tab during a creation must not start a second one.
  const remainingMs = ad?.claimRemainingMs() ?? 0;
  if (remainingMs > 0) return { kind: "running-elsewhere", remainingMs };
  ad?.claim();

  // The lead first: global-management records none for an account that
  // already has an organisation, and the extension's sign-up events would be
  // lost with it.
  await settleWithin(
    ACTIVE_EXTENSIONS.marketing?.ensureAdSignupLead() ?? Promise.resolve(),
    ad?.leadWaitMaxMs ?? 0,
  );

  ad?.claim();
  try {
    await createOrganization(buildOrgCreatePayload({ name }));
    return { kind: "created" };
  } catch {
    ad?.release();
    return { kind: "failed" };
  }
}

const OnboardingPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userProfile = useSelector((state: RootState) => state.user);
  const { complete } = useOnboardingProgress();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A phone opens its keyboard over the page the moment a field takes focus:
  // autofocus the name on desktop only.
  const isCompact = useIsCompactViewport();
  const [hdyhau, setHdyhau] = useState<string>('');

  // Default landing view is the two-card chooser (create vs. join). Users who
  // were invited by email go through /invite/:token and never reach this page.
  // A visitor whose sign-up marker the marketing extension captured at boot
  // is asked nothing: their organisation is created for them.
  const [view, setView] = useState<OnboardingView>(() =>
    ACTIVE_EXTENSIONS.marketing?.readAdSignup() ? "auto" : "chooser",
  );

  // The entry source (`?source=<product space>`) is captured at boot by the
  // edition's entrySource and kept for the tab's session. The call below is
  // redundant with that boot capture today: no client-side navigation reaches
  // this page with a query string (App.tsx navigates to "/on-boarding" bare,
  // and the pending-URL restore of CallbackPage never fires, because
  // invitationSlice removes `pendingRedirectUrl` at every boot). It is kept so
  // that the page reads its own URL if such a navigation ever exists.
  // The banner below is shown above every sub-view; its test id and its
  // translation key are built from this validated value, never from the URL.
  const [entrySource] = useState<string | null>(() => {
    ACTIVE_EXTENSIONS.entrySource?.capture();
    return ACTIVE_EXTENSIONS.entrySource?.read() ?? null;
  });

  useEffect(() => {
    if (userProfile.isProfileLoaded && userProfile.myOrganizations.length > 0) {
      const org = userProfile.myOrganizations[0];

      // Where an edition that bills sends a plan in trouble; nowhere otherwise.
      const billingTarget = ACTIVE_EXTENSIONS.billing?.onboardingRedirect(org) ?? null;
      if (billingTarget) {
        navigate(billingTarget);
        return;
      }

      navigate("/");
    }
  }, [userProfile, navigate]);

  const LoadingSpinner = () => (
    <div className="animate-spin w-5 h-5">
      <svg className="w-full h-full text-alternative" viewBox="0 0 24 24">
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

  // Signup asks for a name and nothing else: no billing profile is needed to
  // create an organization. `hdyhau` stays: it is the one answer we cannot reconstruct later.
  const [formData, setFormData] = useState<{ name: string }>({ name: "" });

  /** What follows any organisation creation, typed or automatic. */
  const finishOrgCreation = () => {
    const marketing = ACTIVE_EXTENSIONS.marketing;
    // Best-effort: link the analytics anonymous profile to the known user ID.
    // userProfile.id is the Logto subject — available from Redux at this point.
    if (userProfile.id) {
      try { marketing?.identify(userProfile.id); } catch { /* best-effort */ }
    }
    marketing?.clearOrgCreateCaptures();
    complete('org_created');
    navigate("/");
    reloadAfterOrgCreation();
  };
  // The effect below reads the render's latest one.
  const finishOrgCreationRef = useRef(finishOrgCreation);
  finishOrgCreationRef.current = finishOrgCreation;

  const profileLoaded = userProfile.isProfileLoaded;
  const hasOrganization = userProfile.myOrganizations.length > 0;
  const autoOrgName =
    ACTIVE_EXTENSIONS.marketing?.adAutoCreate.nameFromEmail(userProfile.email) ?? t('pages.onBoarding.auto.fallbackName');

  useEffect(() => {
    if (view !== "auto" || !profileLoaded || hasOrganization) return;
    let active = true;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    adAutoCreateRun ??= runAdAutoCreate(autoOrgName);
    void adAutoCreateRun.then((outcome) => {
      if (!active) return;
      if (outcome.kind === "created") {
        finishOrgCreationRef.current();
      } else if (outcome.kind === "running-elsewhere") {
        // Once that creation is over, the reload shows its organisation, or
        // finds the claim expired and creates one.
        reloadTimer = setTimeout(reloadAfterOrgCreation, outcome.remainingMs + 500);
      } else {
        // A fixed sentence, never the server's text: the visitor names it.
        toast.error(t('pages.onBoarding.auto.failed'));
        setFormData({ name: autoOrgName });
        setView("create");
      }
    });
    return () => {
      active = false;
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [view, profileLoaded, hasOrganization, autoOrgName, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    if (!formData.name.trim()) {
      toast.error(t('pages.onBoarding.errors.requiredFields'));
      return;
    }

    setIsSubmitting(true);

    try {
      const sanitizedData: OrganizationCreationRequestDto = {
        name: formData.name.trim(),
      };

      await createOrganization(buildOrgCreatePayload(sanitizedData, hdyhau || undefined));
      finishOrgCreation();
    } catch (error) {
      toast.error(t(apiErrorKey(error, { fallback: 'pages.onBoarding.errors.failedToCreate' })));
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-alternative dark:bg-alternative-dark font-sans">
      {/* One soft glow, anchored where the choice is made rather than washing the
          whole page. The previous ground was a three-stop gradient with three
          blurred orbs on top, so the colour under the copy shifted from panel to
          panel and no text colour read correctly across it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[22%] h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-secondary/[0.07] blur-3xl dark:bg-secondary/[0.13]"
      />

      {/* A two-choice decision screen, so the content is centred rather than
          stacked at the top — the old layout left the lower two thirds empty.
          `justify-center` with vertical padding keeps the longer create/join
          forms scrollable instead of clipped on short viewports. */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-4 md:px-6 md:py-12 lg:px-8">
        {/* Header — LoginPage language: logo chip, extrabold title, plain subtitle */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-4 md:mb-10 max-w-2xl"
        >
          {/* On a light ground the mark stands on its own — the translucent chip
              existed only to lift it off the gradient. */}
          <img
            src="logo.webp"
            alt="CybeDefend"
            className="h-8 md:h-9 dark:hidden"
          />
          <img
            src="logo-white.webp"
            alt="CybeDefend"
            className="hidden h-8 md:h-9 dark:block"
          />

          <h1 className="mt-4 md:mt-6 text-[24px] md:text-[34px] font-extrabold tracking-tight text-primary dark:text-alternative">
            {t('pages.onBoarding.chooser.title')}
          </h1>

          {/* Only while the choice is still open. "Create one, or join one
              you've been invited to" is an instruction; once a branch is
              picked it contradicts the panel directly beneath it, which then
              carries its own title and subtitle. */}
          {view === 'chooser' && (
            <p className="mt-2 max-w-prose text-sm md:text-base leading-relaxed text-gray-600 dark:text-gray-400">
              {t('pages.onBoarding.chooser.subtitle')}
            </p>
          )}
        </motion.div>

        {view === 'auto' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            data-testid="onboarding-auto-create"
            aria-live="polite"
            className="mx-auto w-full max-w-xl"
          >
            <div className="flex items-center gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] md:p-8">
              <Loader size="md" variant="secondary" className="flex-shrink-0" />
              <div>
                <p className="font-semibold text-primary dark:text-alternative">
                  {t('pages.onBoarding.auto.creating')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {t('pages.onBoarding.auto.hint')}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* « Join or create an organisation » would contradict the automatic
            creation in progress. */}
        {entrySource && view !== 'auto' && (
          <div
            data-testid={`${entrySource}-banner`}
            className="mb-6 flex items-center gap-3 rounded-2xl bg-secondary/[0.08] px-6 py-4 text-primary ring-1 ring-secondary/20 dark:bg-secondary/[0.14] dark:text-alternative dark:ring-secondary/30"
          >
            <div className="flex-shrink-0 rounded-xl bg-secondary/15 p-2 text-secondary">
              <Shield className="w-5 h-5" />
            </div>
            <p className="font-semibold">{t(`pages.onBoarding.${entrySource}.banner`)}</p>
          </div>
        )}

        {view === 'chooser' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="grid grid-cols-1 gap-6 md:grid-cols-2"
          >
            <motion.button
              type="button"
              data-testid="chooser-create-card"
              onClick={() => setView('create')}
              whileHover={{ y: -5 }}
              className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-5 md:p-8 text-left shadow-sm transition-all duration-300 hover:border-secondary/40 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-alternative dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-secondary/50 dark:focus-visible:ring-offset-alternative-dark"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-secondary to-secondary-light opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="p-3 bg-secondary/10 rounded-2xl w-fit mb-4">
                <PlusCircle className="w-5 h-5 text-secondary"  />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-primary dark:text-alternative">
                {t('pages.onBoarding.chooser.createCard.title')}
              </h3>
              <p className="mb-4 text-gray-600 dark:text-gray-400">
                {t('pages.onBoarding.chooser.createCard.description')}
              </p>
              <span className="inline-flex items-center text-secondary font-semibold">
                {t('pages.onBoarding.chooser.createCard.cta')}
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"  />
              </span>
            </motion.button>

            <motion.button
              type="button"
              data-testid="chooser-join-card"
              onClick={() => setView('join')}
              whileHover={{ y: -5 }}
              className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-5 md:p-8 text-left shadow-sm transition-all duration-300 hover:border-secondary/40 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-alternative dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-secondary/50 dark:focus-visible:ring-offset-alternative-dark"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-secondary to-secondary-light opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="p-3 bg-secondary/10 rounded-2xl w-fit mb-4">
                <UserPlus className="w-5 h-5 text-secondary"  />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-primary dark:text-alternative">
                {t('pages.onBoarding.chooser.joinCard.title')}
              </h3>
              <p className="mb-4 text-gray-600 dark:text-gray-400">
                {t('pages.onBoarding.chooser.joinCard.description')}
              </p>
              <span className="inline-flex items-center text-secondary font-semibold">
                {t('pages.onBoarding.chooser.joinCard.cta')}
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"  />
              </span>
            </motion.button>
          </motion.div>
        )}

        {view === 'join' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            data-testid="onboarding-join-panel"
            className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] md:p-10"
          >
            <button
              type="button"
              data-testid="onboarding-join-back"
              onClick={() => setView('chooser')}
              className="-ml-2 mb-4 inline-flex min-h-11 items-center px-2 text-gray-500 transition-colors hover:text-secondary md:ml-0 md:mb-6 md:min-h-0 md:px-0"
            >
              <ArrowLeft className="mr-2 w-5 h-5"  />
              {t('pages.onBoarding.join.back')}
            </button>
            <div className="p-3 bg-secondary/10 rounded-2xl w-fit mb-5">
              <Mail className="w-5 h-5 text-secondary"  />
            </div>
            <h2 className="text-3xl font-bold text-primary mb-3">
              {t('pages.onBoarding.join.title')}
            </h2>
            <p className="text-gray-600 mb-4">
              {t('pages.onBoarding.join.description')}
            </p>
            <div className="rounded-xl bg-secondary/5 border border-secondary/20 px-5 py-4 text-gray-700">
              {t('pages.onBoarding.join.emailIntro')}{' '}
              <span className="font-semibold text-primary break-all">
                {userProfile.email}
              </span>
            </div>
          </motion.div>
        )}

        {view === 'create' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mx-auto w-full max-w-xl"
        >
          {/* One card, the same one the chooser uses. This step used to be a
              two-column slab: a near-white panel of eleven stacked fields
              beside a marketing column re-selling features the user had just
              chosen to sign up for. It then became a single card of two
              fieldsets — and now, with the billing profile gone, a single
              question, so the fieldset split has nothing left to separate. */}
          <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <div className="p-5 md:p-10">
              <button
                type="button"
                data-testid="onboarding-create-back"
                onClick={() => setView('chooser')}
                className="mb-3 -ml-2 inline-flex min-h-11 items-center self-start rounded-lg px-2 text-sm md:mb-8 md:ml-0 md:min-h-0 md:px-0 text-gray-500 transition-colors hover:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:text-gray-400"
              >
                <ArrowLeft className="mr-2 h-5 w-5" />
                {t('pages.onBoarding.chooser.back')}
              </button>

              {/* The chip the « Create » card and the join panel both carry, so
                  this reads as the continuation of a choice rather than a new
                  screen — and gives one lone input something to hang off. */}
              <div className="mb-3 w-fit rounded-2xl bg-secondary/10 p-3 md:mb-5">
                <Building2 className="h-5 w-5 text-secondary" />
              </div>

              {/* The login screen already said "Bienvenue"; saying it again
                  here left two consecutive screens with the same headline and
                  told the user nothing about what this one asks of them. */}
              <h1 className="text-2xl font-bold tracking-tight text-primary dark:text-alternative md:text-3xl">
                {t('pages.onBoarding.form.pageTitle')}
              </h1>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {t('pages.onBoarding.form.pageSubtitle')}
              </p>

              <form onSubmit={handleSubmit} className="mt-5 md:mt-8" data-testid="onboarding-create-form">
                <Input
                  label={t('pages.onBoarding.form.organizationName')}
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  maxLength={255}
                  required
                  autoFocus={!isCompact}
                  size="lg"
                  placeholder={t('pages.onBoarding.form.organizationNamePlaceholder')}
                  width="w-full"
                />
                <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {t('pages.onBoarding.form.organizationNameHelper')}
                </p>

                {/* The one optional question, kept but visibly demoted: a rule
                    separates it from the field that actually gates the button,
                    so nobody reads it as a second thing to fill in. */}
                <div className="mt-4 border-t border-gray-200/80 pt-4 md:mt-8 md:pt-8 dark:border-white/10">
                  <AtomSelect
                    label={`${t('pages.onBoarding.form.hdyhau.label')} (${t('pages.onBoarding.form.optional')})`}
                    options={[
                      'search_engine', 'social_media', 'friend_colleague', 'blog_article',
                      'event_conference', 'advertising', 'ai_assistant', 'other',
                    ].map((v) => ({ value: v, label: t(`pages.onBoarding.form.hdyhau.${v}`) }))}
                    value={hdyhau}
                    onChange={setHdyhau}
                    width="w-full"
                  />
                </div>

                <div className="mt-5 md:mt-8">
                  <Button
                    type="submit"
                    variant="secondary"
                    fullWidth
                    className="max-md:h-11"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    icon={<ArrowRight className="h-5 w-5" />}
                    iconPosition="right"
                  >
                    {isSubmitting
                      ? t('pages.onBoarding.form.creatingButton')
                      : t('pages.onBoarding.form.createButton')}
                  </Button>

                  {/* The address form used to be the answer to "am I about to
                      be charged?". With it gone, say so outright. The
                      Community Edition has no plan to upgrade to (billing is
                      closed): nothing to say there. */}
                  {EDITION !== "community" && (
                    <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      <CreditCard className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                      <span>{t('pages.onBoarding.form.noPaymentRequired')}</span>
                    </p>
                  )}
                </div>
              </form>
            </div>
          </div>
        </motion.div>
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
