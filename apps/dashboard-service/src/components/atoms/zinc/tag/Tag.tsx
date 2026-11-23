import React from 'react';

import { toneText, type DotTone } from '@/components/atoms/zinc/dot/Dot';
import { cn } from '@/utils/function/utils';

/**
 * A status or a severity as a coloured word (no dot any
 * more, « Critical » written in red): red denied / critical, amber warned /
 * high, mint live / on, iris waiting on a person, zinc for everything else,
 * each at least 4.5:1 on its surface in both themes (`DOT_TONE_TEXT`). No
 * fill, no border, no radius. 12 px, 20 px tall so it sits on a row's line.
 * Never a button.
 *
 * `dot={false}` keeps the word in zinc whatever the tone, for a neutral
 * attribute (« Custom ») or a chip. `mono` sets the word in Geist Mono for an
 * id, a branch, a version. A count inside the word may be set in ink by the
 * caller. `variant="plain"` is kept as the name of this one look.
 */
export type TagVariant = 'plain';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: DotTone;
  /** `false`: the word stays zinc, whatever the tone (a neutral attribute, a chip). */
  dot?: boolean;
  mono?: boolean;
  /** The one look. Kept so a caller may say so. */
  variant?: TagVariant;
}

const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ tone = 'neutral', dot = true, mono = false, variant = 'plain', className, children, ...rest }, ref) => (
    <span
      ref={ref}
      data-tag={tone}
      data-tag-variant={variant}
      className={cn(
        'inline-flex h-5 min-w-0 items-center whitespace-nowrap text-xs',
        dot ? toneText(tone) : toneText('neutral'),
        mono && 'font-mono tabular-nums',
        className,
      )}
      {...rest}
    >
      <span className="truncate">{children}</span>
    </span>
  ),
);

Tag.displayName = 'Tag';

export { Tag };
export default Tag;
