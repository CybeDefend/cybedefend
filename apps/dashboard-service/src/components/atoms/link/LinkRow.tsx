import React, { forwardRef, useCallback } from "react";
import { useHref, useNavigate, type To } from "react-router-dom";
import { isInteractiveElementInPath } from "./linkUtils";

export interface LinkRowProps
  extends Omit<React.HTMLAttributes<HTMLTableRowElement>, "onClick"> {
  to: To;
  replace?: boolean;
  state?: unknown;
  target?: React.HTMLAttributeAnchorTarget;
  /** Optional label for screen readers describing the destination. */
  ariaLabel?: string;
  onClick?: (event: React.MouseEvent<HTMLTableRowElement>) => void;
  children: React.ReactNode;
}

const openInNewTab = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/**
 * `<LinkRow>` is a table row that behaves like a link. To make right-click
 * "Open in new tab" available everywhere on the row — the native browser
 * affordance — each cell's content is wrapped in a real `<a>` with the row's
 * href. The wrapping `<a>` is purely visual: its onClick preventDefaults so
 * left-click navigation runs through the router via the row's onClick.
 *
 * Cells that contain their own interactive descendants (buttons, real links,
 * inputs) should opt out of the auto-wrap by setting `data-no-link={true}` on
 * the `<td>`. Without this, you'd get nested `<a>` (invalid HTML and bad
 * UX — clicking a child link would also fire the row's nav).
 *
 * Click semantics:
 * - Plain left-click → react-router navigation (no reload)
 * - Ctrl/Cmd-click, middle-click, Shift-click → open in new tab/window
 * - Click from an interactive descendant → row navigation is skipped
 * - Enter / Space when row is focused → navigate
 */
export const LinkRow = forwardRef<HTMLTableRowElement, LinkRowProps>(
  (
    {
      to,
      replace,
      state,
      target,
      ariaLabel,
      onClick,
      onKeyDown,
      onAuxClick,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    const href = useHref(to);
    const navigate = useNavigate();

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLTableRowElement>) => {
        onClick?.(event);
        // The synthetic <a data-link-wrapper> we inject in each cell calls
        // preventDefault on the click so the browser doesn't navigate via the
        // anchor. We deliberately don't bail on event.defaultPrevented here:
        // that flag is set by our wrapper, not by the user.
        if (isInteractiveElementInPath(event.target, event.currentTarget))
          return;
        if (event.button !== 0) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          openInNewTab(href);
          return;
        }
        if (event.shiftKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        if (target === "_blank") {
          event.preventDefault();
          openInNewTab(href);
          return;
        }
        event.preventDefault();
        navigate(to, { replace, state });
      },
      [onClick, navigate, to, replace, state, target, href],
    );

    const handleAuxClick = useCallback(
      (event: React.MouseEvent<HTMLTableRowElement>) => {
        onAuxClick?.(event);
        if (event.defaultPrevented) return;
        if (isInteractiveElementInPath(event.target, event.currentTarget))
          return;
        if (event.button === 1) {
          event.preventDefault();
          openInNewTab(href);
        }
      },
      [onAuxClick, href],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTableRowElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        navigate(to, { replace, state });
      },
      [onKeyDown, navigate, to, replace, state],
    );

    const augmentedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      const cellProps = child.props as React.HTMLAttributes<HTMLTableCellElement> & {
        "data-no-link"?: boolean;
      };
      if (cellProps["data-no-link"]) return child;
      // Move the cell's className + style onto the wrapping <a> so the anchor
      // covers the entire visual cell area (including padding). Right-click
      // in the cell's padding area then still lands on the anchor and shows
      // the native "Open in new tab" menu. The <td> stays naked.
      return React.cloneElement(
        child as React.ReactElement<React.HTMLAttributes<HTMLTableCellElement>>,
        {
          className: undefined,
          style: undefined,
          children: (
            <a
              href={href}
              data-link-wrapper="true"
              className={cellProps.className}
              onClick={(e) => e.preventDefault()}
              onAuxClick={(e) => e.preventDefault()}
              tabIndex={-1}
              aria-hidden="true"
              style={{
                color: "inherit",
                textDecoration: "inherit",
                display: "block",
                cursor: "inherit",
                ...(cellProps.style || {}),
              }}
            >
              {cellProps.children}
            </a>
          ),
        },
      );
    });

    return (
      <tr
        ref={ref}
        role="link"
        tabIndex={0}
        data-href={href}
        aria-label={ariaLabel}
        // Base text colour so each cell's `color: inherit` wrapper resolves to a
        // theme-aware colour. Without this the anchors inherited the row's
        // default (black) — fine in light mode, illegible in dark mode.
        className={`text-zinc-700 dark:text-zinc-300${className ? ` ${className}` : ""}`}
        style={style}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        {augmentedChildren}
      </tr>
    );
  },
);

LinkRow.displayName = "LinkRow";

export default LinkRow;
