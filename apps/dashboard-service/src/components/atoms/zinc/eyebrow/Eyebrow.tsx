import React from 'react';
import { cn } from '@/utils/function/utils';

export type EyebrowElement = 'p' | 'span' | 'h2' | 'h3';

/**
 * The small uppercase kicker above a title or a figure (« Brain mode »;
 * « Agents, Acme »: one phrase, never a separator). Its colour is a quiet zinc
 * with its dark twin; a caller on a surface dark in both themes overrides it
 * with `className`.
 *
 * 12 px (nothing under 12 px), 500, letter-spaced
 * 0.08em, at most once per panel and never as the default section title (a
 * section title is 15 px sentence case, see `Panel`).
 */
export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  /** The element it renders: a paragraph by default, a heading when it names a section. */
  as?: EyebrowElement;
}

export const EYEBROW_CLASSES = 'text-xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400';

const Eyebrow = React.forwardRef<HTMLElement, EyebrowProps>(({ as = 'p', className, children, ...rest }, ref) =>
  React.createElement(as, { ref, className: cn(EYEBROW_CLASSES, className), ...rest }, children),
);

Eyebrow.displayName = 'Eyebrow';

export { Eyebrow };
export default Eyebrow;
