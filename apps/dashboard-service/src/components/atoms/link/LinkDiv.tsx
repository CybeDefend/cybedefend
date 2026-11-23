import React, { forwardRef, useCallback } from "react";
import {
  useHref,
  useLinkClickHandler,
  type To,
} from "react-router-dom";
import { isInteractiveElementInPath } from "./linkUtils";

export interface LinkDivProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "onClick" | "href"> {
  to: To;
  replace?: boolean;
  state?: unknown;
  target?: React.HTMLAttributeAnchorTarget;
  /** Optional label for screen readers describing the destination. */
  ariaLabel?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
}

/**
 * `<LinkDiv>` renders a real `<a>` element so the browser's native right-click
 * "Open in new tab" works. Behaves like a react-router link for normal clicks.
 *
 * Modifier-clicks (Ctrl/Cmd, Shift, middle-click) all fall through to the
 * browser's default `<a>` handling, which opens in a new tab/window — no
 * custom JS needed.
 *
 * Clicks originating from interactive descendants (button, a, input, ...) do
 * not trigger router navigation; this preserves nested click handlers.
 */
export const LinkDiv = forwardRef<HTMLAnchorElement, LinkDivProps>(
  (
    {
      to,
      replace,
      state,
      target,
      ariaLabel,
      onClick,
      children,
      className,
      ...rest
    },
    ref,
  ) => {
    const href = useHref(to);
    const routerHandleClick = useLinkClickHandler<HTMLAnchorElement>(to, {
      replace,
      state,
      target,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (isInteractiveElementInPath(event.target, event.currentTarget))
          return;
        // useLinkClickHandler internally honors modifier keys / target=_blank
        // and only intercepts plain left-click navigation, so Ctrl/Cmd-click
        // and middle-click behave natively (open in new tab).
        routerHandleClick(event);
      },
      [onClick, routerHandleClick],
    );

    return (
      <a
        ref={ref}
        href={href}
        target={target}
        aria-label={ariaLabel}
        className={className}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </a>
    );
  },
);

LinkDiv.displayName = "LinkDiv";

export default LinkDiv;
