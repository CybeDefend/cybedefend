import React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { FLOATING_MOTION, FLOATING_SURFACE } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A non-modal floating panel (Radix Popover: focus moves in, Escape and an
 * outside click close it, focus returns to the trigger). Same surface and
 * motion as `Menu`; 12 px of padding and 288 px wide unless told otherwise.
 * For setup progress, a filter, a small form.
 *
 * `portal={false}` keeps the layer in its owner's subtree (still floated by
 * Popper) for a details layer that belongs to the element it explains — the
 * home's KPI cards. Do not `forceMount` a layer that may stay closed: Radix
 * then keeps its dismissable layer and focus guards on the page, so the last
 * one mounted takes every Escape (the others never close on it) and an
 * invisible element becomes the first Tab stop. Mount it while open and, if
 * the facts must stay in the DOM, render them in a plain `hidden` element
 * while closed (the agents home hero does).
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  /** Render through a portal at the end of `body` (default) or in place. */
  portal?: boolean;
}

export const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, PopoverContentProps>(
  ({ className, sideOffset = 6, align = 'center', collisionPadding = 8, portal = true, forceMount, ...rest }, ref) => {
    const content = (
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        forceMount={forceMount}
        className={cn(
          FLOATING_SURFACE,
          FLOATING_MOTION,
          'z-[60] w-72 p-3 text-[13px] outline-none origin-[var(--radix-popover-content-transform-origin)]',
          forceMount && 'data-[state=closed]:hidden',
          className,
        )}
        {...rest}
      />
    );
    return portal ? <PopoverPrimitive.Portal forceMount={forceMount}>{content}</PopoverPrimitive.Portal> : content;
  },
);
PopoverContent.displayName = 'PopoverContent';
