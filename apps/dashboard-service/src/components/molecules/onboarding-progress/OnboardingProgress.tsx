import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { CybeAvatar } from '@/components/atoms/cybe-avatar/CybeAvatar';
import { useOnboardingProgress } from '@/server/hooks/useOnboardingProgress';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS_RAIL } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';
import { upsellLink } from '@/edition/upsell/upsellLink';

/** The slot id of the Community checklist's invitation to the cloud, which tags its link. */
export const ONBOARDING_CLOUD_CTA_SLOT_ID = 'onboarding-checklist';

export const OnboardingProgress: React.FC = () => {
  const { t } = useTranslation();
  const { steps, completedCount, totalCount, percentage, complete } = useOnboardingProgress();
  const [expanded, setExpanded] = useState(false);
  // The Community Edition opens the steps in place: its
  // short rail put the cloud's floating panel over the navigation. The cloud
  // keeps its panel, unchanged.
  const inPlace = EDITION === 'community';
  const stepsId = useId();
  const stepsRef = useRef<HTMLDivElement>(null);

  // In place there is no backdrop: Escape closes the list, as its bar does.
  useEffect(() => {
    if (!inPlace || !expanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inPlace, expanded]);

  if (completedCount >= totalCount) return null;

  const stepButtons = (
    <div className="p-1">
      {steps.map((step) => (
        <button
          key={step.id}
          onClick={(e) => {
            e.stopPropagation();
            if (!step.completed) complete(step.id);
          }}
          className={cn(
            // At least 32 px: « Corriger automatiquement une vulnérabilité » takes two lines.
            'relative flex min-h-8 items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs leading-4 transition-colors duration-[120ms] max-md:min-h-11',
            AS_FOCUS_RAIL,
            !step.completed && 'hover:bg-white/[0.05] cursor-pointer'
            // A done step reads by its green check and its struck zinc-400 label
            // (5.9:1 on the menu); faded to 60 % it fell to 3:1.
          )}
        >
          <div className={cn(
            'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
            step.completed ? 'bg-green-500 border-green-500' : 'border-zinc-500 hover:border-zinc-400'
          )}>
            {step.completed && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <span className={cn(
            step.completed ? 'text-zinc-400 line-through' : 'text-zinc-200'
          )}>
            {t(step.labelKey)}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className={inPlace ? 'px-3 pb-1' : 'px-3 pb-1 relative'}>
      {/* Collapsed: compact bar, a hairline block: no fill, a white-8 % hairline around it, the
          rail's hover. */}
      <button
        onClick={() => setExpanded(!expanded)}
        {...(inPlace && { 'aria-expanded': expanded, 'aria-controls': stepsId })}
        className={cn(
          'w-full rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-left transition-colors duration-[120ms] hover:bg-white/[0.06]',
          AS_FOCUS_RAIL
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <CybeAvatar size="xs" />
          <span className="text-xs font-medium text-zinc-100 flex-1">
            {t('components.cybeGuide.progress.title')}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            {completedCount}/{totalCount}
          </span>
        </div>
        <div data-testid="progress-bar" className="h-[3px] bg-white/[0.08] rounded-full overflow-hidden">
          <motion.div
            // Zinc, not the accent: in the rail only the current entry and the product's mark draw the eye.
            className="h-full bg-zinc-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </button>

      {inPlace ? (
      <>
      {/* Community: the steps open in place, under the bar, in this block's
          own space. The cloud's floating panel below
          (`absolute bottom-full z-50`, with a full-screen backdrop) was drawn
          over the Community navigation and organisation selector. In the
          flow they push what follows; the rail fits or scrolls (`useRailFit`),
          and the list is brought into view once open. */}
      <AnimatePresence initial={false}>
        {expanded && (
            <motion.div
              id={stepsId}
              ref={stepsRef}
              data-testid="onboarding-steps"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              onAnimationComplete={() => {
                if (expanded) stepsRef.current?.scrollIntoView?.({ block: 'nearest' });
              }}
              className="mt-1.5 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1B1B20]"
            >
              {stepButtons}
              {/* The list ends with an invitation to the cloud: a link,
                  not a step, so the x/y count stays
                  the steps'. */}
              <div className="border-t border-white/[0.08] p-1">
                <a
                  href={upsellLink(ONBOARDING_CLOUD_CTA_SLOT_ID, '/pricing')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'group flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium leading-4 text-zinc-100 transition-colors duration-[120ms] hover:bg-white/[0.05] max-md:min-h-11',
                    AS_FOCUS_RAIL
                  )}
                >
                  <span className="flex-1">{t('components.cybeGuide.cloudCta.label')}</span>
                  <span aria-hidden="true" className="text-zinc-400 group-hover:text-zinc-200">↗</span>
                  <span className="sr-only"> {t('components.upsell.opensInNewTab')}</span>
                </a>
              </div>
            </motion.div>
        )}
      </AnimatePresence>
      </>
      ) : (
      <>
      {/* Expanded: floating popup ABOVE the button, not inline */}
      <AnimatePresence>
        {expanded && (
          <>
            {/* Backdrop to close */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setExpanded(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 right-0 mb-2 mx-0 z-50 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1B1B20] shadow-[0_16px_40px_-8px_rgb(0_0_0/0.7)]"
            >
              <div className="flex h-9 items-center gap-2 px-3 border-b border-white/[0.08]">
                <CybeAvatar size="xs" />
                <span className="text-xs font-medium text-zinc-100">
                  {t('components.cybeGuide.progress.title')}
                </span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400">
                  {t('components.cybeGuide.progress.complete', { count: completedCount, total: totalCount })}
                </span>
              </div>

              {stepButtons}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </>
      )}
    </div>
  );
};

export default OnboardingProgress;
