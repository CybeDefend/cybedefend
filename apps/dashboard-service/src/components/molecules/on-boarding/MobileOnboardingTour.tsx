import Button from "@/components/atoms/button/Button";
import { ArrowLeft, ChevronRight, Rocket } from "@/components/atoms/icon/icons";
import Modal from "@/components/atoms/modal/Modal";
import { useFinishOnboarding } from "@/server/hooks/useFinishOnboarding";
import { useOnboardingConfig } from "@/server/hooks/useOnboardingConfig";
import { cn } from "@/utils/function/utils";
import { useIsCompactViewport } from "@/utils/hooks/useIsCompactViewport";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { EDITION } from "@/edition/edition";

/**
 * The four things worth showing, each with a screenshot of the real desktop
 * screen (`public/image/onboarding/tour-<id>-<lang>-<theme>.webp`, fictional
 * demo data), and the desktop tour step whose access rule decides whether this
 * user gets to see it. Reusing `useOnboardingConfig` means role, plan, disabled
 * features and the persona answers filter the phone tour exactly as they filter
 * the desktop one — nobody is shown a page they cannot open.
 */
const SLIDES = [
  { id: "scan", requires: null },
  { id: "cybe", requires: null },
  { id: "posture", requires: "organizationOverview" },
  { id: "tools", requires: "integrationsSettings" },
] as const;

// The « cybe » slide presents the Cybe analysis, which the Community Edition
// does not ship.
const TOUR_SLIDES = EDITION === "community" ? SLIDES.filter((slide) => slide.id !== "cybe") : SLIDES;

const shot = (id: string, lang: string, theme: "light" | "dark") =>
  `/image/onboarding/tour-${id}-${lang}-${theme}.webp`;

// A horizontal drag this long is a swipe; anything mostly vertical is a scroll.
const SWIPE_DISTANCE = 48;

/**
 * The guided tour on a phone-sized viewport: one sheet on the home page that
 * walks through what the product does, then leaves the user where they already
 * are. It replaces, below the `md` breakpoint, the spotlight tour that
 * navigates to a new page for every step (OnboardingStep, inert on phones).
 *
 * Self-gating like OnboardingPersonaModal, and it starts where that one ends:
 * profile loaded, onboarding not completed, persona answered, an organisation.
 */
const MobileOnboardingTour: React.FC = () => {
  const { t, i18n } = useTranslation();
  // Screenshots exist in French and in English; anything else reads English.
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const isCompact = useIsCompactViewport();
  const finish = useFinishOnboarding();
  const { hasAccessToStep, isReady } = useOnboardingConfig();

  const isProfileLoaded = useSelector((state: any) => state.user.isProfileLoaded);
  const isOnboardingCompleted = useSelector((state: any) => state.user.isOnboardingCompleted);
  const onboardingPersona = useSelector((state: any) => state.user.onboardingPersona);
  const hasOrganization = useSelector((state: any) => (state.user.myOrganizations?.length ?? 0) > 0);

  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const arrived = useRef(false);

  // When the slide changes, focus follows it: a screen reader starts from the
  // top of the new slide, and the button just tapped does not keep its focus
  // ring for the rest of the tour. Not on arrival — that would pull focus away
  // from wherever the dialog put it.
  // Fetch every screenshot up front (~25 KB each): a slide must never open on
  // an empty frame, least of all on the mobile connection ad traffic comes from.
  const visible = isCompact && isProfileLoaded && !isOnboardingCompleted && onboardingPersona != null;
  useEffect(() => {
    if (!visible) return;
    const dark = document.documentElement.classList.contains("dark");
    TOUR_SLIDES.forEach(({ id }) => {
      new Image().src = shot(id, lang, dark ? "dark" : "light");
    });
  }, [visible, lang]);

  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    slideRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (
    !isCompact ||
    !isProfileLoaded ||
    isOnboardingCompleted ||
    onboardingPersona == null ||
    !hasOrganization ||
    // Until the role check has run every step reads as accessible: waiting
    // avoids showing a slide and then taking it away.
    !isReady
  ) {
    return null;
  }

  const slides = TOUR_SLIDES.filter((slide) => slide.requires === null || hasAccessToStep(slide.requires));
  const current = slides[Math.min(index, slides.length - 1)];
  const position = slides.indexOf(current);
  const isFirst = position === 0;
  const isLast = position === slides.length - 1;

  const go = (delta: number) =>
    setIndex(Math.max(0, Math.min(slides.length - 1, position + delta)));

  const end = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // On success the profile reloads as completed and this component unmounts.
      await finish();
    } catch {
      toast.error(t("components.mobileTour.saveFailed"));
      setSaving(false);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 1 : -1);
  };

  return (
    <Modal
      title={t(`components.mobileTour.slides.${current.id}.title`)}
      // Leaving without finishing = skip, as in the persona questions just before.
      onClose={end}
      closeOnOverlayClick={false}
      footerButtons={
        <div className="flex w-full items-center gap-2">
          {!isFirst && (
            <Button
              variant="white"
              onClick={() => go(-1)}
              disabled={saving}
              aria-label={t("components.mobileTour.back")}
              className="min-h-[48px] min-w-[48px] px-0"
              icon={<ArrowLeft className="h-4 w-4" />}
            />
          )}
          {!isLast && (
            <Button variant="white" onClick={end} disabled={saving} className="min-h-[48px]">
              {t("components.mobileTour.skip")}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={isLast ? end : () => go(1)}
            disabled={saving}
            loading={isLast && saving}
            className="min-h-[48px] flex-1 text-base font-medium"
            icon={isLast ? <Rocket className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            iconPosition="right"
          >
            {isLast ? t("components.mobileTour.start") : t("components.mobileTour.next")}
          </Button>
        </div>
      }
    >
      <div
        ref={slideRef}
        tabIndex={-1}
        data-testid="mobile-tour-slide"
        aria-live="polite"
        onTouchStart={(e) => {
          touchStart.current = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }}
        onTouchEnd={onTouchEnd}
        // overflow-hidden: a slide starts its rise-in 10px low, which would
        // otherwise make the sheet's body scrollable for the length of the
        // animation.
        className="flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center gap-3">
          <div aria-hidden className="flex flex-1 items-center gap-1">
            {slides.map((slide, i) => (
              <span
                key={slide.id}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-500",
                  i <= position
                    ? "bg-gradient-to-r from-secondary to-secondary-light"
                    : "bg-zinc-200 dark:bg-white/[0.08]"
                )}
              />
            ))}
          </div>
          <span className="font-mono text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            {t("components.mobileTour.progress", { current: position + 1, total: slides.length })}
          </span>
        </div>

        {/* Keyed by slide so each one rises in (transform only). */}
        <div key={current.id} className="mt-4 flex flex-1 flex-col motion-safe:animate-rise-in">
          {/* The real desktop screen, framed like a window. Decorative: the
              heading and the sentence below say what it shows. */}
          <div
            data-testid="mobile-tour-shot"
            className="relative aspect-[16/10] shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 [@media(max-height:619px)]:aspect-[16/7] dark:border-as-line dark:bg-white/[0.03]"
          >
            <img
              src={shot(current.id, lang, "light")}
              alt=""
              role="presentation"
              width={1050}
              height={656}
              decoding="async"
              className="h-full w-full object-cover object-left-top dark:hidden"
            />
            <img
              src={shot(current.id, lang, "dark")}
              alt=""
              role="presentation"
              width={1050}
              height={656}
              decoding="async"
              className="hidden h-full w-full object-cover object-left-top dark:block"
            />
          </div>

          {/* Room for three lines on every slide, so the sheet keeps one height
              and does not jump as the text gets shorter or longer. */}
          <p className="mt-4 min-h-[4.5rem] text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {/* The Community Edition runs no scanner: its first results are imported. */}
            {t(EDITION === "community" && current.id === "scan"
              ? "components.mobileTour.slides.scan.importBody"
              : `components.mobileTour.slides.${current.id}.body`)}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default MobileOnboardingTour;
