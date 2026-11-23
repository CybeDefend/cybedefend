import React from 'react';

import Eyebrow from '@/components/atoms/zinc/eyebrow/Eyebrow';
import { cn } from '@/utils/function/utils';

/**
 * The statement a zinc-kit page opens with: the title as the page's only `h1` (24 px, 600, tracking -0.02em),
 * then an optional description (14 px zinc) and a muted meta line (counts, who
 * is working now, a link to the report). An optional small eyebrow says where
 * and when as a phrase (« Agents, Acme »: a comma, never a separator); use it sparingly. The actions sit on the right from a
 * tablet up and wrap under the title on a phone.
 *
 * No icon tile: the space keeps its pictures for the agents' logos and the
 * brain. A `div`, not a `<header>`, so the app header stays the page's only
 * banner.
 */
export interface NarrativePageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional: a small uppercase kicker above the title, in words; several facts make one phrase (« Agents, Acme »). */
  eyebrow?: React.ReactNode;
  title: string;
  /** A sentence, or a component that writes one (the overview's headline). */
  description?: React.ReactNode;
  /** The muted line under the description. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PAGE_TITLE_CLASSES = 'text-[24px] font-semibold leading-8 tracking-[-0.02em] text-zinc-900 dark:text-zinc-50';
const DESCRIPTION = 'mt-1.5 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400';

const NarrativePageHeader = React.forwardRef<HTMLDivElement, NarrativePageHeaderProps>(
  ({ eyebrow, title, description, meta, actions, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}
      {...rest}
    >
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className={PAGE_TITLE_CLASSES}>{title}</h1>
        {description == null || description === false ? null : typeof description === 'string' ? (
          <p className={DESCRIPTION}>{description}</p>
        ) : (
          // A component brings its own paragraph: a div keeps it from nesting in one.
          <div className={DESCRIPTION}>{description}</div>
        )}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  ),
);

NarrativePageHeader.displayName = 'NarrativePageHeader';

export { NarrativePageHeader };
export default NarrativePageHeader;
