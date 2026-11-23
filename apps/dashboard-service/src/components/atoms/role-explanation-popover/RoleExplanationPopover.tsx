import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { getRolePermissions, RoleScope } from "@/utils/data/rolePermissions";
import { EDITION } from "@/edition/edition";

// Billing is the cloud's: the Community Edition lists no
// « billing » permission, and the roles whose description names billing get
// their own wording there.
const COMMUNITY = EDITION === "community";
const COMMUNITY_WORDED_ROLES: readonly string[] = ["creator", "administrator", "manager"];
import { InfoCircle } from '@/components/atoms/icon/icons';
import { AS_FLOATING, AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

const POPOVER_WIDTH_PX = 288;
const POPOVER_MAX_HEIGHT_PX = 360;
const POPOVER_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
const HOVER_CLOSE_DELAY_MS = 120;

const joinClasses = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

export interface RoleExplanationPopoverProps {
  scope: RoleScope;
  role: string;
  className?: string;
  triggerClassName?: string;
}

const RoleExplanationPopover: React.FC<RoleExplanationPopoverProps> = ({
  scope,
  role,
  className,
  triggerClassName,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const isOpen = isHovered;

  const cancelScheduledClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      closeTimeoutRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    let rafId: number | null = null;
    let measureRafId: number | null = null;
    const computeCoords = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const measuredHeight = contentRef.current?.offsetHeight ?? 0;
      const desiredHeight = measuredHeight > 0 ? measuredHeight : POPOVER_MAX_HEIGHT_PX;
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN_PX;
      const spaceAbove = rect.top - VIEWPORT_MARGIN_PX;
      const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
      const desiredLeft = rect.right - POPOVER_WIDTH_PX;
      const left = Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(desiredLeft, window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_MARGIN_PX)
      );
      const availableHeight = openAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(
        0,
        Math.min(POPOVER_MAX_HEIGHT_PX, availableHeight - POPOVER_GAP_PX)
      );
      const positioningHeight = measuredHeight > 0
        ? Math.min(measuredHeight, maxHeight)
        : maxHeight;
      const rawTop = openAbove
        ? rect.top - positioningHeight - POPOVER_GAP_PX
        : rect.bottom + POPOVER_GAP_PX;
      const top = Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(rawTop, window.innerHeight - positioningHeight - VIEWPORT_MARGIN_PX)
      );
      setCoords((prev) => {
        if (prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight) return prev;
        return { top, left, maxHeight };
      });
    };
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeCoords();
      });
    };
    computeCoords();
    measureRafId = requestAnimationFrame(() => {
      measureRafId = null;
      computeCoords();
    });
    window.addEventListener("resize", computeCoords);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (measureRafId !== null) cancelAnimationFrame(measureRafId);
      window.removeEventListener("resize", computeCoords);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen, role]);

  const permissions = useMemo(
    () => (role ? getRolePermissions(scope, role).filter((perm) => !COMMUNITY || perm !== "billing") : []),
    [scope, role]
  );

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsHovered(false);
      }
    },
    []
  );

  const handleMouseEnter = useCallback(() => {
    cancelScheduledClose();
    setIsHovered(true);
  }, [cancelScheduledClose]);

  const handleMouseLeave = useCallback(() => {
    scheduleHoverClose();
  }, [scheduleHoverClose]);

  const handleContentMouseEnter = useCallback(() => {
    cancelScheduledClose();
    setIsHovered(true);
  }, [cancelScheduledClose]);

  const handleContentMouseLeave = useCallback(() => {
    scheduleHoverClose();
  }, [scheduleHoverClose]);

  const handleFocus = useCallback(() => {
    cancelScheduledClose();
    setIsHovered(true);
  }, [cancelScheduledClose]);

  const handleBlur = useCallback(() => {
    setIsHovered(false);
  }, []);

  const titleKey = role
    ? `roles.explanations.${role}.title`
    : "roles.explanations.empty";

  return (
    <div
      ref={containerRef}
      className={joinClasses("relative inline-flex items-center", className)}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="role-explanation-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t("roles.explanations.triggerLabel")}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleTriggerKeyDown}
        className={joinClasses(
          "relative inline-flex h-6 w-6 items-center justify-center rounded-full",
          "text-zinc-400 transition-colors duration-[120ms] hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200",
          AS_FOCUS,
          AS_TOUCH_SQUARE,
          triggerClassName
        )}
      >
        <InfoCircle className="h-4 w-4"  />
      </button>

      {isOpen && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={contentRef}
          role="dialog"
          data-testid="role-explanation-content"
          data-select-dropdown
          aria-label={t("roles.explanations.ariaLabel")}
          onMouseEnter={handleContentMouseEnter}
          onMouseLeave={handleContentMouseLeave}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: POPOVER_WIDTH_PX,
            maxHeight: coords.maxHeight ?? POPOVER_MAX_HEIGHT_PX,
            overflowY: "auto",
            zIndex: 9999,
          }}
          className={joinClasses(
            AS_FLOATING,
            "p-3 text-left overflow-y-auto custom-scrollbar",
            "max-h-[360px]"
          )}
        >
          {role ? (
            <>
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                {t(titleKey)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                {t(
                  COMMUNITY && scope === "organization" && COMMUNITY_WORDED_ROLES.includes(role)
                    ? `roles.explanations.${role}.communityDescription`
                    : `roles.explanations.${role}.description`
                )}
              </p>
              <ul className="space-y-1.5">
                {permissions.map((perm) => (
                  <li
                    key={perm}
                    className="text-xs text-zinc-700 dark:text-zinc-300 flex items-start gap-2"
                  >
                    <span
                      className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-secondary"
                      aria-hidden="true"
                    />
                    <span>{t(`roles.permissions.${perm}`)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("roles.explanations.empty")}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default RoleExplanationPopover;
