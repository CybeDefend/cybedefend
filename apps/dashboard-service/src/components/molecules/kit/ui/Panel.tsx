import React, { useId } from 'react';

import { PLATE_DARK } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * The panel of the zinc kit: a white sheet on the
 * page bounded by a 1 px hairline (in dark, the surface token lit by a 1 px
 * inner top highlight, `PLATE_DARK`), 16–20 px of padding, and exactly as
 * tall as its content — `h-fit`, because a grid row stretches its items and a
 * stretched card is empty space.
 *
 * The title row holds the title on the left (15 px, 500, sentence case, no
 * icon before it) and, on the right, a muted meta ("Last 7 days") then one
 * ghost action. A `section` or an `aside` with a title is a region named by it.
 *
 * `padded={false}` lets a `DataList` run edge to edge: the title row keeps
 * the panel's padding and the rounded corners clip the rows' hover tint.
 */
export type PanelElement = 'section' | 'aside' | 'div';

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  as?: PanelElement;
  title?: React.ReactNode;
  titleAs?: 'h2' | 'h3';
  /** Muted words on the right of the title row: a period, a count, a time. */
  meta?: React.ReactNode;
  /** One ghost action (a link, a `Button variant="ghost"`), after the meta. */
  actions?: React.ReactNode;
  /** True (default): 16 px, 20 px from `sm`. False: the content runs to the edges. */
  padded?: boolean;
  children?: React.ReactNode;
}

export const PANEL_CLASSES = `rounded-xl border border-zinc-200 bg-white ${PLATE_DARK}`;
export const PANEL_TITLE_CLASSES = 'truncate text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100';
export const PANEL_META_CLASSES = 'text-[13px] text-zinc-500 dark:text-zinc-400';

const Panel = React.forwardRef<HTMLElement, PanelProps>(
  ({ as = 'section', title, titleAs = 'h2', meta, actions, padded = true, className, children, ...rest }, ref) => {
    const titleId = useId();
    const hasTitle = title !== undefined && title !== null && title !== false;
    const hasHeader = hasTitle || Boolean(meta) || Boolean(actions);
    const Title = titleAs;

    return React.createElement(
      as,
      {
        ref,
        'aria-labelledby': hasTitle && as !== 'div' ? titleId : undefined,
        className: cn(PANEL_CLASSES, 'h-fit', padded ? 'p-4 sm:p-5' : 'overflow-hidden', className),
        ...rest,
      },
      hasHeader ? (
        <div
          data-panel-header=""
          className={cn('flex min-h-6 items-center justify-between gap-3', padded ? 'mb-4' : 'px-4 pb-2 pt-4 sm:px-5')}
        >
          {hasTitle ? (
            <Title id={titleId} className={PANEL_TITLE_CLASSES}>
              {title}
            </Title>
          ) : (
            <span />
          )}
          {meta || actions ? (
            <div className="flex shrink-0 items-center gap-3">
              {meta ? <span className={PANEL_META_CLASSES}>{meta}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null,
      children,
    );
  },
);

Panel.displayName = 'Panel';

export { Panel };
export default Panel;
