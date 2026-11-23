
import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import { X } from "@/components/atoms/icon/icons";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { useDialogKeyboard } from "./useDialogKeyboard";
import { useIsCompactViewport } from "@/utils/hooks/useIsCompactViewport";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  title: string;
  description?: string;
  size?: ModalSize;
  width?: string;
  maxHeight?: string;
  customMaxWidth?: string;
  onClose: () => void;
  footerButtons?: React.ReactNode;
  children: React.ReactNode;
  animationDirection?: "up" | "down" | "none";
  closeOnOverlayClick?: boolean;
  /** Escape closes the dialog. Defaults to `closeOnOverlayClick`: a dialog that must not be dismissed (an upload in progress) keeps both off. */
  closeOnEscape?: boolean;
  additionalRefs?: React.RefObject<HTMLDivElement | null>[];
  className?: string;
  /** False for a question that must be answered: no close button. */
  showCloseButton?: boolean;
}

const sizeConfig: Record<ModalSize, { maxWidth: string; responsiveMaxWidth: string }> = {
  sm: { maxWidth: "max-w-sm", responsiveMaxWidth: "24rem" },
  md: { maxWidth: "max-w-md", responsiveMaxWidth: "28rem" },
  lg: { maxWidth: "max-w-3xl", responsiveMaxWidth: "48rem" },
  xl: { maxWidth: "max-w-4xl", responsiveMaxWidth: "56rem" },
  full: { maxWidth: "max-w-6xl", responsiveMaxWidth: "95vw" },
};

const Modal: React.FC<ModalProps> = ({
  title,
  description,
  size = "md",
  width,
  maxHeight = "80vh",
  customMaxWidth,
  onClose,
  footerButtons,
  children,
  animationDirection = "none",
  closeOnOverlayClick = true,
  closeOnEscape,
  additionalRefs = [],
  className,
  showCloseButton = true,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  // Phone-sized viewport: a sheet anchored to the bottom edge, not a centred
  // card. The 80vh cap left ~317px of body on a 390x664 screen, so dialogs cut
  // their own choices and buttons and scrolled them inside an unmarked box.
  const isCompact = useIsCompactViewport();

  // Get size configuration
  const currentSize = sizeConfig[size];
  const effectiveWidth = width || currentSize.maxWidth;
  const effectiveMaxWidth = customMaxWidth || currentSize.responsiveMaxWidth;

  /*
    No entrance animation.

    The panel used to mount at `opacity-0` and fade in from a `setTimeout`.
    That transition is driven by requestAnimationFrame, which the browser
    suspends while the tab is in the background — so a modal opened on a
    restored tab stayed invisible while still trapping clicks and blocking the
    page behind it. `setIsVisible` is kept for the closing path.
  */

  // Lock body scroll while any dialog is open. Shared with
  // DowngradeConfirmationModal through one counter — see useBodyScrollLock.
  useBodyScrollLock();

  // Escape, initial focus, focus trap and focus return.
  useDialogKeyboard(modalRef, { onClose, closeOnEscape: closeOnEscape ?? closeOnOverlayClick });

  // Close on click outside the modal (and outside any portal'd dropdown / extra
  // refs). Kept separate from the scroll lock so it can safely re-bind when the
  // caller passes a fresh onClose / additionalRefs without re-locking scroll.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // A modal stacked ABOVE this one (a nested ConfirmationModal, rendered as
      // a sibling) lives outside modalRef, so its buttons used to read as
      // "outside" and close us — unmounting the button on mousedown, before its
      // click handler could run, so the confirmed action silently never fired.
      // A click that landed in another modal's overlay is not outside; only our
      // own backdrop is.
      const targetOverlay =
        target instanceof Element
          ? target.closest("[data-modal-overlay]")
          : null;
      if (targetOverlay && targetOverlay !== overlayRef.current) {
        return;
      }

      // Check if click is inside modal
      const isInsideModal = modalRef.current?.contains(target);

      // Check if click is inside any additional refs
      const isInsideAdditionalRefs = additionalRefs.some(ref => ref.current?.contains(target));

      // Check if click is inside any Select dropdown (portal elements)
      const isInsideSelectDropdown = target instanceof Element && (
        target.closest('[data-select-dropdown]') ||
        target.closest('.z-50') || // Select dropdown has z-50 class
        target.closest('[style*="position: absolute"][style*="z-index: 9999"]')
      );

      const shouldClose = !isInsideModal && !isInsideAdditionalRefs && !isInsideSelectDropdown && closeOnOverlayClick;

      if (shouldClose) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [closeOnOverlayClick, onClose, additionalRefs]);

  const getAnimationClasses = () => {
    if (isVisible) {
      return animationDirection === "none"
        ? "opacity-100 scale-100"
        : "translate-y-0 opacity-100 scale-100";
    }
    switch (animationDirection) {
      case "down":
        return "translate-y-8 opacity-0 scale-95";
      case "up":
        return "-translate-y-8 opacity-0 scale-95";
      default:
        return "opacity-0 scale-95";
    }
  };

  return (
    <div
      ref={overlayRef}
      data-modal-overlay
      className={cn(
        "fixed inset-0 z-[9999] flex justify-center",
        isCompact
          ? "items-end motion-safe:animate-backdrop-in"
          : "items-center",
        "bg-black/50 backdrop-blur-sm",
        "transition-all duration-300 ease-out",
        "dark:bg-black/60",
        isVisible ? "opacity-100" : "opacity-0"
      )}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        // 100vh on a phone includes the strip hidden under the browser's
        // toolbar — exactly where a bottom sheet's footer would land.
        height: isCompact ? '100dvh' : '100vh',
        margin: 0,
        padding: 0
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // Base styles
          "relative flex flex-col w-full p-5",
          "bg-white dark:bg-neutral-900",
          "border border-neutral-200 dark:border-neutral-800",
          "shadow-xl",
          // AppSec (another product space opens this dialog too, so its look is gated):
          // zinc hairlines, the surface layer in dark.
          "appsec:border-zinc-200 appsec-dark:bg-as-surface appsec-dark:border-as-line-strong",
          isCompact
            ? cn(
                "rounded-t-[28px] pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
                "shadow-[0_-18px_50px_-14px_rgba(26,26,46,0.5)]",
                "motion-safe:animate-sheet-up",
              )
            : cn(
                "rounded-2xl appsec:rounded-xl",
                // A soft lift in light, a top highlight and a deep shadow in dark.
                // Not on the phone sheet, which keeps its own upward shadow.
                "appsec:shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.04)]",
                "appsec-dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_24px_64px_-12px_rgb(0_0_0/0.85)]",
                // Responsive sizing - max-w-lg on small screens
                "max-w-lg sm:max-w-none",
                effectiveWidth,
                // Spacing
                "mx-4 my-4",
              ),
          // Animations
          "transform transition-all duration-300 ease-out",
          getAnimationClasses(),
          className
        )}
        style={
          isCompact
            ? // The whole screen bar a sliver of backdrop, so it still reads
              // as a sheet over the page rather than a new page.
              { maxHeight: "calc(100dvh - 1.5rem)" }
            : { maxHeight: maxHeight, maxWidth: effectiveMaxWidth }
        }
      >
        {/* Phone sheet: a brand hairline where the sheet meets the page. */}
        {isCompact && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-secondary/60 to-transparent"
          />
        )}

        {/* Header */}
        <div className="flex justify-between items-start border-b border-neutral-200 dark:border-neutral-800 pb-3 mb-4 appsec:border-zinc-200 appsec-dark:border-as-line">
          <div className="flex-1 pr-4">
            <h3
              id={titleId}
              className={cn(
                "text-neutral-900 dark:text-neutral-100",
                isCompact
                  ? "text-xl font-bold leading-snug tracking-tight appsec:text-lg appsec:font-semibold"
                  : "font-semibold text-lg appsec:text-[15px] appsec:font-medium appsec:leading-6 appsec:tracking-[-0.01em]",
              )}
            >
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 appsec:text-[13px]">
                {description}
              </p>
            )}
          </div>
          {showCloseButton && (
          <button
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              // 44px is the touch floor; the negative margin keeps the icon
              // optically where the 32px control put it.
              isCompact ? "-mr-2 -mt-2 h-11 w-11" : "h-8 w-8",
              "text-neutral-500 dark:text-neutral-400",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800",
              "hover:text-neutral-700 dark:hover:text-neutral-200",
              "transition-colors duration-200",
              "focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700",
              // AppSec: a quieter icon, a ring for the keyboard only.
              "appsec:rounded-md appsec:text-zinc-400 appsec:hover:bg-zinc-100 appsec:hover:text-zinc-700",
              "appsec:focus:ring-0 appsec:focus-visible:ring-2 appsec:focus-visible:ring-secondary",
              "appsec-dark:text-zinc-500 appsec-dark:hover:bg-white/[0.06] appsec-dark:hover:text-zinc-200"
            )}
            onClick={onClose}
            data-modal-close
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5 appsec:h-4 appsec:w-4" />
          </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {children}
        </div>

        {/* Footer */}
        {footerButtons && (
          <div className="flex justify-end gap-x-3 pt-4 mt-4 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 appsec:gap-x-2 appsec:border-zinc-200 appsec-dark:bg-as-surface appsec-dark:border-as-line">
            {footerButtons}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
