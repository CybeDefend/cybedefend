import React from 'react';

import { toneText, type DotTone } from '@/components/atoms/zinc/dot/Dot';
import { PLATE_DARK } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A message in the flow of a page (replaces `Callout` in a zinc-kit
 * space): a hairline box on the panel colour, the title, one or two
 * sentences of body in zinc, the actions underneath. No tinted background, no
 * big icon, no dot: the tone colours the title (red,
 * amber, mint; ink when neutral), or the body when there is no title.
 *
 * `danger` is an `alert` (read at once); the other tones are a `status`.
 */
export type NoticeTone = 'neutral' | 'live' | 'warn' | 'danger';

export interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: NoticeTone;
  title?: React.ReactNode;
  /** Buttons or links (the kit's `Button size="sm"`). */
  actions?: React.ReactNode;
  /** Laid out on one line from `sm`: actions on the right. */
  inline?: boolean;
}

const TONE: Record<NoticeTone, DotTone> = { neutral: 'ink', live: 'live', warn: 'warn', danger: 'danger' };

const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(
  ({ tone = 'neutral', title, actions, inline = false, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      data-notice={tone}
      className={cn(
        'flex gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3', PLATE_DARK,
        inline ? 'flex-col sm:flex-row sm:items-center' : 'flex-col',
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          {title ? <p className={cn('text-sm font-medium leading-5', toneText(TONE[tone]))}>{title}</p> : null}
          {children ? (
            <div
              className={cn(
                'text-sm leading-5',
                title || tone === 'neutral' ? 'text-zinc-500 dark:text-zinc-400' : toneText(TONE[tone]),
                title ? 'mt-0.5' : null,
              )}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  ),
);

Notice.displayName = 'Notice';

export { Notice };
export default Notice;
