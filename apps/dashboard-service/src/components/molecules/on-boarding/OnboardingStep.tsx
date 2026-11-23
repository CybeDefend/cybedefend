import Button from "@/components/atoms/button/Button";
import { CybeAvatar } from '@/components/atoms/cybe-avatar/CybeAvatar';
import { fetchMyProfile, updateUserProfile } from "@/server/services/userService";
import { setOnboardingStep, setUserProfile } from "@/server/store/userSlice";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Rocket } from '@/components/atoms/icon/icons';
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { useRebac } from "react-rebac";
import { Team } from "@/server/interfaces/Team";
import { useOnboardingConfig } from "@/server/hooks/useOnboardingConfig";
import { useIsCompactViewport } from "@/utils/hooks/useIsCompactViewport";
import { appsecProjectListPath } from "@/utils/appsecProjectList";

import { AS_FLOATING } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface OnboardingStepProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  imageSrc?: string;
  /** Unique step identifier - must match an ID in useOnboardingConfig */
  stepId: string;
  /**
   * Optional callback fired once the tour finishes on THIS step (Finish button,
   * last step). Runs after the existing completion side effects. Used e.g. by
   * the createProject step to open the CreateProjectModal.
   *
   * NOTE: `onFinish` is NOT called in interactive mode — the spotlighted
   * element's own onClick already performs the action (e.g. open the modal).
   */
  onFinish?: () => void;
  /**
   * When true, the spotlighted element stays fully clickable and IS the tour's
   * completion trigger: clicking it runs the child's original onClick AND
   * completes onboarding. The bubble drops its primary "Got it/Finish" button
   * in favour of an invitation hint (see `interactiveHint`) and keeps Skip.
   */
  interactive?: boolean;
  /**
   * Invitation hint shown (in place of the primary button) in interactive mode,
   * e.g. "👆 Click 'Create Project' to continue". Supplied by the caller so the
   * copy lives in the caller's i18n namespace.
   */
  interactiveHint?: string;
  /**
   * Fired the moment the spotlighted element is clicked while THIS interactive
   * step is active (i.e. a genuine tour interaction), BEFORE the child's own
   * onClick. Precise signal a caller can use to distinguish a tour-driven click
   * from an ordinary one — do not recompute coarse global onboarding flags in
   * the parent, they over-trigger (skipped persona, reload mid-tour). Only ever
   * called when `interactive` AND this is the currently active step.
   */
  onInteract?: () => void;
}

const OnboardingStep = ({
  children,
  title,
  subtitle,
  imageSrc,
  stepId,
  onFinish,
  interactive = false,
  interactiveHint,
  onInteract,
}: OnboardingStepProps) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // Phone-sized viewport: this page-by-page spotlight tour is replaced by one
  // self-contained component (MobileOnboardingTour, mounted on the home page).
  // A bubble positioned from its target's coordinates has no room on a 390px
  // screen, and hopping between pages is a poor fit for a thumb. Every step is
  // then inert: no scrim, no scroll lock, no automatic navigation.
  const isCompact = useIsCompactViewport();
  const targetRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // Inflight guard: onboarding completion must fire exactly once even if the
  // spotlighted element is double-clicked in interactive mode.
  const completingRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const [bubblePosition, setBubblePosition] = useState({ left: 0, top: 0 });
  const { setUser } = useRebac();

  // Get onboarding configuration based on user's role
  const {
    steps,
    totalSteps,
    getStepNumber,
    getNextPath,
    isLastStep,
    hasAccessToStep,
    isReady,
  } = useOnboardingConfig();

  const isOnboardingCompleted = useSelector(
    (state: any) => state.user.isOnboardingCompleted
  );
  const isProfileLoaded = useSelector(
    (state: any) => state.user.isProfileLoaded
  );
  const currentStep = useSelector((state: any) => state.user.onboardingStep);
  // Persona gate: the tour must not start until the profile is recorded
  // (OnboardingPersonaModal records it, no longer asks it). null/undefined =
  // not recorded yet.
  const onboardingPersona = useSelector(
    (state: any) => state.user.onboardingPersona
  );
  const personaPending = onboardingPersona == null;

  // Get computed values for this step
  const step = getStepNumber(stepId);
  const nextPath = getNextPath(stepId);
  const isLast = isLastStep(stepId);
  const hasAccess = hasAccessToStep(stepId);

  /**
   * Refreshes the user profile and Rebac entities after onboarding completion.
   * This ensures the sidebar and other authorized content are properly updated.
   */
  const refreshProfileAndRebac = useCallback(async () => {
    try {
      const fetchedUserProfile = await fetchMyProfile();
      dispatch(setUserProfile(fetchedUserProfile));

      // Reconfigure ReBAC permissions with fresh data
      const organizationEntities = fetchedUserProfile.myOrganizations.map(
        (org: { id: string; myRole: string }) => ({
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
      setUser([...organizationEntities, ...teamEntities]);
    } catch (error) {
      console.error("Error refreshing profile and Rebac after onboarding:", error);
    }
  }, [dispatch, setUser]);

  const updateBubblePosition = () => {
    const target = targetRef.current;
    const bubble = bubbleRef.current;
    if (!target || !bubble) return;

    const margin = 16;
    const targetRect = target.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();

    let left = targetRect.left - bubbleRect.width - margin;
    if (left < margin) {
      if (targetRect.left <= margin + 1 && targetRect.width > 600) {
        left = targetRect.left + 300;
      } else {
        left = targetRect.right + margin;
      }
    }
    left = Math.max(
      margin,
      Math.min(left, window.innerWidth - bubbleRect.width - margin)
    );

    let top = targetRect.top - bubbleRect.height - margin;
    if (top < margin) {
      top = targetRect.bottom + margin;
    }
    const maxTop = window.innerHeight - bubbleRect.height - margin;
    top = Math.max(margin, Math.min(top, maxTop));

    setBubblePosition({ left, top });
  };

  useEffect(() => {
    if (isCompact || !isProfileLoaded || isOnboardingCompleted || personaPending || currentStep !== step) return;

    const timer = setTimeout(() => {
      setIsVisible(true);
      updateBubblePosition();
    }, 300);

    document.body.style.overflow = "hidden";
    window.addEventListener("resize", updateBubblePosition);
    const positionInterval = setInterval(updateBubblePosition, 100);
    setTimeout(() => clearInterval(positionInterval), 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(positionInterval);
      window.removeEventListener("resize", updateBubblePosition);
      document.body.style.overflow = "";
    };
  }, [isCompact, isProfileLoaded, isOnboardingCompleted, personaPending, currentStep, step]);

  const clearGuideStorage = () => {
    // Clear all CybePageGuide dismissals so guides show fresh after the tour.
    // Best effort: storage the browser disables throws (SecurityError), and by
    // now the completion is saved, so the tour must still finish.
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('cybe-guide-dismissed-')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn("Could not reset the page guides after onboarding:", error);
    }
  };

  /**
   * Shared completion path: Finish on the last step, Skip, and the interactive
   * spotlight click. Runs the profile/rebac/storage side effects then navigates
   * to the AppSec home, where the tour ends (and where `onFinish` opens the
   * project creation): never to `/`, whose landing rule may pick another space.
   * Guarded so a rapid double-click saves exactly once. Never rejects: it
   * is called from click handlers, where a rejection is an unhandled one. A
   * failed save shows a toast and leaves the tour retryable. Resolves to
   * whether the tour was completed.
   */
  const completeOnboarding = async (): Promise<boolean> => {
    if (completingRef.current) return false;
    completingRef.current = true;
    try {
      await updateUserProfile(null, true);
    } catch {
      completingRef.current = false;
      toast.error(t("components.onboarding.saveFailed"));
      return false;
    }
    await refreshProfileAndRebac();
    clearGuideStorage();
    // the project list: the last step's « New project » button and the modal
    // Finish opens live there (`/appsec/projects` in the Community Edition)
    navigate(appsecProjectListPath());
    return true;
  };

  const handleNext = async () => {
    if (isLast) {
      // Step-specific finish hook (e.g. createProject → open the modal).
      // Skipped in interactive mode (the spotlight click already acted).
      if (await completeOnboarding()) onFinish?.();
    } else {
      dispatch(setOnboardingStep(step + 1));
      if (nextPath) {
        navigate(nextPath);
      }
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
  };

  // Let the user jump back to an already-visited step by clicking its progress
  // dot. Backward only — the current and future dots stay inert so the tour is
  // still walked forward in order (no skipping ahead past unseen steps).
  const handleGoToStep = (targetStep: number) => {
    if (targetStep < 1 || targetStep >= step) return;
    const target = steps?.[targetStep - 1];
    dispatch(setOnboardingStep(targetStep));
    if (target?.path) {
      navigate(target.path);
    }
  };

  // Auto-skip steps the user doesn't have permission for
  useEffect(() => {
    if (isCompact || !isProfileLoaded || isOnboardingCompleted || personaPending || currentStep !== step) return;
    // Wait for config to be ready
    if (!isReady) return;

    // If user doesn't have access to this step, auto-skip
    if (!hasAccess) {
      if (isLast) {
        // Last step, complete onboarding
        handleSkip();
      } else if (nextPath) {
        dispatch(setOnboardingStep(step + 1));
        navigate(nextPath);
      }
    }
  }, [isCompact, hasAccess, currentStep, step, isOnboardingCompleted, personaPending, isReady, isLast, nextPath]);

  if (isCompact || !isProfileLoaded || isOnboardingCompleted) {
    return <>{children}</>;
  }

  // Hold the tour entirely until the persona questions have been answered —
  // OnboardingPersonaModal (mounted by the layout) collects them first.
  if (personaPending) {
    return <>{children}</>;
  }

  if (currentStep !== step) {
    return <div ref={targetRef}>{children}</div>;
  }

  const wrappedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      if (interactive) {
        // Interactive mode: keep the element fully clickable. Its click runs
        // the original onClick (opens the modal) THEN completes the tour.
        const childProps = child.props as {
          onClick?: (e: React.MouseEvent) => void;
          className?: string;
        };
        const emphasizedChild = React.cloneElement(
          child as React.ReactElement<any>,
          {
            onClick: (e: React.MouseEvent) => {
              // Precise "clicked from the active tour step" signal — fires
              // before the child's own onClick so a caller can flag guided
              // state and have it batched into the same render as whatever the
              // child opens.
              onInteract?.();
              childProps.onClick?.(e);
              void completeOnboarding();
            },
            // Keep the control painted above the decorative halo layers below.
            className: `${childProps.className || ""} relative z-10`,
          }
        );
        // Wrap the spotlighted control in a gently breathing, pulsing halo so it
        // visibly invites the click. Every halo layer is pointer-events-none and
        // stays within a few px of the control (no expanding radar ring) so an
        // overflow-hidden ancestor can't clip it, and the glow is the brand
        // secondary colour — never a black drop shadow.
        return (
          <motion.div
            className="relative inline-flex"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* Bright spotlight pocket: lifts the control clear of the dark scrim
                so its zone reads at a glance — the same "cut-out" feel the
                full-section steps get for free. Brand-tinted ring, never a black
                drop shadow. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-2.5 rounded-2xl bg-white ring-1 ring-secondary/30 dark:bg-as-surface dark:ring-secondary-light/30"
            />
            {/* Soft pulsing brand glow bleeding into the scrim to invite the click. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-2.5 rounded-2xl bg-secondary/20 blur-md animate-pulse"
            />
            {emphasizedChild}
          </motion.div>
        );
      }
      // Non-interactive (default): swallow the click and disable pointer events.
      const childProps = child.props as { className?: string };
      return React.cloneElement(child as React.ReactElement<any>, {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        },
        className: `${childProps.className || ""} pointer-events-none`,
      });
    }
    return child;
  });

  return (
    <div className="relative">
      { }
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-secondary/15 via-zinc-900/40 to-zinc-900/55" />
            <div className="absolute inset-0 opacity-5">
              <div
                className="absolute inset-0 bg-repeat"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, #000 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-50" ref={targetRef}>
        {wrappedChildren}

        <AnimatePresence>
          {isVisible && (
            <motion.div
              ref={bubbleRef}
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{
                position: "fixed",
                left: bubblePosition.left,
                top: bubblePosition.top,
              }}
              className="z-50 max-w-md"
            >
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(AS_FLOATING, "relative rounded-xl rounded-tl-none p-4 sm:p-5")}
              >
                { }
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  className="absolute -top-6 -left-6 group"
                >
                  <div className="absolute inset-0 rounded-2xl bg-secondary/10 blur-xl scale-125" />
                  <div className="relative w-16 h-16">
                    <div className="w-full h-full rounded-xl overflow-hidden border-4 border-white bg-white shadow-[0_4px_12px_-4px_rgb(0_0_0/0.15)] flex items-center justify-center dark:border-as-raised dark:bg-as-raised">
                      <CybeAvatar size="lg" showStatus />
                    </div>
                  </div>
                </motion.div>

                { }
                {step === 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 ml-12"
                  >
                    <div className="inline-flex items-center space-x-2 text-xl font-semibold tracking-[-0.02em]">
                      <span className="inline-block">👋</span>
                      <span className="bg-gradient-to-r from-secondary via-secondary/80 to-secondary/60 bg-clip-text text-transparent">
                        {t('components.onboarding.welcome')}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                      {t('components.onboarding.startTour')}
                    </p>
                  </motion.div>
                )}

                { }
                <div className="ml-12 space-y-1.5">
                  <motion.h3
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[15px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100"
                  >
                    {title}
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400"
                  >
                    {subtitle}
                  </motion.p>
                </div>

                { }
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-5 pt-3 border-t border-zinc-200 dark:border-as-line"
                >
                  <div className="flex items-center justify-between gap-4">
                    { }
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        {Array.from({ length: totalSteps }).map((_, i) => {
                          const stepNum = i + 1;
                          const isPast = stepNum < step;
                          const isCurrent = stepNum === step;
                          return (
                            <motion.button
                              key={i}
                              type="button"
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ delay: i * 0.1 }}
                              onClick={
                                isPast ? () => handleGoToStep(stepNum) : undefined
                              }
                              disabled={!isPast}
                              data-testid={`onboarding-dot-${stepNum}`}
                              aria-label={`${t('common.step')} ${stepNum}`}
                              className={`relative rounded-full transition-transform duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
                                isPast
                                  ? "cursor-pointer"
                                  : "cursor-default"
                              }`}
                            >
                              <div
                                className={`
                                  w-2 h-2 rounded-full transition-colors duration-500
                                  ${stepNum <= step
                                    ? "bg-secondary scale-100"
                                    : "bg-zinc-200 dark:bg-white/[0.12] scale-90"
                                  }
                                `}
                              />
                              {isCurrent && (
                                <div className="absolute inset-0">
                                  <div className="absolute inset-0 rounded-full bg-secondary/20 scale-[1.4]" />
                                </div>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                      <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400 pl-1">
                        {t('common.step')} {step} {t('common.of')} {totalSteps}
                      </span>
                    </div>

                    { }
                    {interactive ? (
                      // Same standard "Skip" control the other steps use, for
                      // visual consistency across the whole tour.
                      <Button
                        onClick={handleSkip}
                        className="group relative overflow-hidden px-3.5 disabled:opacity-50"
                        variant="white"
                      >
                        <span className="relative z-10 flex items-center space-x-2">
                          <span className="relative">
                            {t('common.skip')}
                            <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-zinc-300 transition-[width] duration-300 group-hover:w-full" />
                          </span>
                        </span>
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        </div>
                      </Button>
                    ) : (
                      <div className="flex items-center space-x-2">
                        {step === 1 && (
                          <Button
                            onClick={handleSkip}
                            className="group relative overflow-hidden px-3.5 disabled:opacity-50"
                            variant="white"
                          >
                            <span className="relative z-10 flex items-center space-x-2">
                              <span className="relative">
                                {t('common.skip')}
                                <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-zinc-300 transition-[width] duration-300 group-hover:w-full" />
                              </span>
                            </span>
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                            </div>
                          </Button>
                        )}
                        <Button
                          onClick={handleNext}
                          className="group relative overflow-hidden px-3.5 disabled:opacity-50"
                          variant="secondary"
                        >
                          <span className="relative z-10 flex items-center space-x-2">
                            <span className="relative">
                              {isLast ? t('common.finish') : t('common.gotIt')}
                              <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-white/40 transition-[width] duration-300 group-hover:w-full" />
                            </span>
                            {isLast ? (
                              <Rocket className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </span>
                          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                          </div>
                        </Button>
                      </div>
                    )}
                  </div>

                  { }
                  {interactive && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="mt-4 flex items-center gap-2.5 rounded-lg border border-as-line px-3 py-2.5"
                    >
                      <span className="text-[13px] font-medium leading-snug text-secondary dark:text-secondary-light">
                        {interactiveHint ||
                          t('components.onboarding.clickToContinue')}
                      </span>
                    </motion.div>
                  )}
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default OnboardingStep;
