import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X } from '@/components/atoms/icon/icons';
import { AS_FOCUS } from '@/components/atoms/appsec/styles';
import { FOCUS_RING } from '@/components/atoms/zinc/styles';
import { useBodyScrollLock } from '@/components/atoms/modal/useBodyScrollLock';
import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { useFocusTrap } from '@/utils/hooks/useFocusTrap';
import { cn } from '@/utils/function/utils';

/*
  The right-hand sheet of every space: not a floating pop-up, a page that
  opens from the right. Every
  record detail opens in it: flush with the top, right and bottom edges of the
  viewport, full height, square corners, a hairline on its left edge, a scrim
  over the page. It slides in from the right, translateX 100 % to 0 in 240 ms
  on an ease-out curve, and leaves the same way; nothing moves under reduced
  motion or Calm (`useMotionAllowed`). Full width on a phone. The focus is
  trapped inside and goes back to the opener, Escape and a click on the scrim
  close it, the page behind holds still, the footer actions stay pinned at
  the bottom while the body scrolls. The Platform issue drawer and the
  agents event drawer take the same values.
*/
export const SHEET_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
export const SHEET_SECONDS = 0.24;
export const SHEET_TRANSITION = { duration: SHEET_SECONDS, ease: SHEET_EASE };

/** The two skins: identical values today, each read from its own space's tokens. */
type Skin = 'platform' | 'zinc';

const SKIN: Record<Skin, { panel: string; line: string; scrim: string; focus: string }> = {
  platform: {
    focus: AS_FOCUS,
    panel: 'bg-white text-zinc-900 dark:bg-as-surface dark:text-zinc-100 border-zinc-200 dark:border-as-line-strong',
    line: 'border-zinc-200 dark:border-as-line',
    scrim: 'bg-zinc-950/20 dark:bg-black/55',
  },
  zinc: {
    focus: FOCUS_RING,
    panel: 'bg-white text-zinc-900 dark:bg-vd-surface dark:text-zinc-100 border-zinc-200 dark:border-vd-line-strong',
    line: 'border-zinc-200 dark:border-vd-line',
    // The kit's overlay: black at 40 % with a small blur.
    scrim: 'bg-black/40 backdrop-blur-sm',
  },
};

const WIDTH = {
  /** 420 px from `sm` up: a summary of facts. */
  sm: 'sm:w-[420px]',
  /** 520 px from `sm` up. */
  md: 'sm:w-[520px]',
  /** 640 px from `sm` up: code, long tables. */
  lg: 'sm:w-[640px]',
  /** 880 px from `sm` up: a document (a report preview). */
  xl: 'sm:w-[880px]',
} as const;

export interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog. */
  title: React.ReactNode;
  /** A line under the title (the category of a rule, the project of an event). */
  description?: React.ReactNode;
  /** Content beside the title (a chip, a state), before the close button. */
  headerAside?: React.ReactNode;
  /**
   * The body draws its own heading (the Brain's focus panel): the title names
   * the dialog for assistive tech only, no header bar is drawn, and the close
   * button sits over the body's top right corner (the body leaves it room).
   */
  hideTitle?: boolean;
  /** Actions pinned at the bottom, on a hairline: the primary one last. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  skin?: Skin;
  width?: keyof typeof WIDTH;
  /** The accessible name of the close button (default « Close »). */
  closeLabel?: string;
  /** On the dialog panel. */
  'data-testid'?: string;
  /** On the fixed layer that holds the scrim and the panel. */
  rootTestId?: string;
  /** On the scrim (default `side-sheet-scrim`). */
  scrimTestId?: string;
  bodyTestId?: string;
  bodyClassName?: string;
  onBodyScroll?: React.UIEventHandler<HTMLDivElement>;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

type PanelProps = Omit<SideSheetProps, 'open'>;

const Panel: React.FC<PanelProps> = ({
  onClose,
  title,
  description,
  headerAside,
  hideTitle = false,
  footer,
  children,
  skin = 'platform',
  width = 'md',
  closeLabel,
  'data-testid': testId,
  rootTestId,
  scrimTestId = 'side-sheet-scrim',
  bodyTestId,
  bodyClassName,
  onBodyScroll,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // While it slides out the sheet is leaving: the focus goes back at once, the keys are no longer its.
  const present = useIsPresent();
  const motionAllowed = useMotionAllowed();
  const tone = SKIN[skin];

  useFocusTrap(present, panelRef);
  // A modal sheet over the whole height: the page behind holds still, and its scrollbar never sits beside the sheet.
  useBodyScrollLock();

  useEffect(() => {
    if (!present) return undefined;
    const onKey = (e: KeyboardEvent) => {
      // A layer above (a menu, a confirmation) that took the Escape marks it handled: it closes alone.
      if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target)) return;
      // Pressed in another dialog opened over the sheet (an event drawer): that dialog's Escape.
      const target = e.target instanceof Element ? e.target : null;
      const dialog = target?.closest('[role="dialog"], [role="alertdialog"]');
      if (dialog && dialog !== panelRef.current && !panelRef.current?.contains(dialog)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, present]);

  // 40 px on a phone, a tap target a thumb can hit; 32 px from `sm` up. Its ring is for the keyboard only.
  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={closeLabel ?? t('common.close')}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors duration-[120ms] sm:h-8 sm:w-8',
        'hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100',
        tone.focus,
        // It takes the focus when the sheet opens: no ring after the click that opened it, the keyboard's only.
        'focus:ring-0 focus-visible:ring-2',
      )}
    >
      <X className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );

  return (
    <div className={cn('fixed inset-0 z-50', !present && 'pointer-events-none')} data-testid={rootTestId}>
      {/* The scrim: the page steps back while the sheet is open; a click on it closes the sheet.
          Its colour eases in (never from opacity 0, which a frozen first frame would leave as an invisible trap). */}
      <motion.div
        data-testid={scrimTestId}
        aria-hidden="true"
        onClick={onClose}
        exit={motionAllowed ? { opacity: 0 } : undefined}
        transition={SHEET_TRANSITION}
        className={cn('absolute inset-0 z-0', tone.scrim, motionAllowed && 'animate-backdrop-in')}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        initial={motionAllowed ? { x: '100%' } : false}
        animate={{ x: 0 }}
        exit={motionAllowed ? { x: '100%' } : undefined}
        transition={SHEET_TRANSITION}
        data-testid={testId}
        data-side-sheet={skin}
        className={cn(
          // Flush with the top, right and bottom edges; full width on a phone.
          'absolute inset-y-0 right-0 z-10 flex w-full flex-col sm:max-w-full',
          WIDTH[width],
          // The hairline only where the page shows beside it (a phone's sheet has no left neighbour).
          'sm:border-l',
          tone.panel,
        )}
      >
        {hideTitle ? (
          <>
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="sr-only">
                {description}
              </p>
            ) : null}
            <div className="absolute right-2.5 top-2.5 z-10">
              {closeButton}
            </div>
          </>
        ) : (
          <header className={cn('flex shrink-0 items-start justify-between gap-3 border-b py-2.5 pl-5 pr-2.5', tone.line)}>
            <div className="min-w-0 flex-1 py-1">
              {/* Wraps: cut, a long name lost its last word on a 320 px phone. */}
              <h2
                id={titleId}
                className="flex min-w-0 text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-50"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-0.5 text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAside}
              {closeButton}
            </div>
          </header>
        )}

        <div
          data-testid={bodyTestId}
          onScroll={onBodyScroll}
          className={cn('custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', bodyClassName)}
        >
          {children}
        </div>

        {footer ? (
          <footer
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
              tone.line,
            )}
          >
            {footer}
          </footer>
        ) : null}
      </motion.div>
    </div>
  );
};

/**
 * A record's detail in the right-hand sheet. Mount it closed and open it with
 * `open`: while it slides out it keeps the content it last showed.
 */
const SideSheet: React.FC<SideSheetProps> = ({ open, ...rest }) => (
  <AnimatePresence>{open ? <Panel key="side-sheet" {...rest} /> : null}</AnimatePresence>
);

export default SideSheet;
