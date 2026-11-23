import React from 'react';

import {
  beatClasses,
  glyphOf,
  type Beat,
  type BeatVariant,
} from '@/components/molecules/kit/narrative/beats';
import { cn } from '@/utils/function/utils';

export type BeatGlyphSize = 'xs' | 'sm' | 'md';
export type BeatGlyphForm = 'icon' | 'dot';

/**
 * The mark of a beat, in one of two forms:
 * - `icon` (default): its stroked lucide glyph in zinc, 1.5 px, on nothing: a
 *   diff scan or a session for `did`, the brain for `served`, a guard or a
 *   refusal for `stopped`. No tile, no tinted square behind it.
 * - `dot`: a 6 px dot in the beat's status colour, the one place a semantic
 *   hue shows: amber for a warning, red for a refusal, zinc and ink for the
 *   others. Centred in the same box, so the two forms line up in a list.
 *
 * Decorative unless it is given a `title`, which makes it an image of that name.
 */
export interface BeatGlyphProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'title'> {
  beat: Beat;
  /** Which glyph of the beat: `scan`/`session` for did, `guard`/`denied` for stopped. */
  variant?: BeatVariant;
  /** 14, 16 or 20 px. */
  size: BeatGlyphSize;
  /** The glyph (default) or the 6 px status dot. */
  as?: BeatGlyphForm;
  title?: string;
}

const sizeClasses: Record<BeatGlyphSize, string> = {
  xs: 'h-3.5 w-3.5 [&>svg]:h-3.5 [&>svg]:w-3.5',
  sm: 'h-4 w-4 [&>svg]:h-4 [&>svg]:w-4',
  md: 'h-5 w-5 [&>svg]:h-5 [&>svg]:w-5',
};

const BeatGlyph = React.forwardRef<HTMLSpanElement, BeatGlyphProps>(
  ({ beat, variant, size, as = 'icon', title, className, ...rest }, ref) => {
    const Glyph = glyphOf(beat, variant);
    const tone = beat === 'stopped' && variant === 'denied' ? 'denied' : beat;
    return (
      <span
        ref={ref}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : 'true'}
        className={cn(
          'inline-flex shrink-0 items-center justify-center text-zinc-400 dark:text-zinc-500',
          sizeClasses[size],
          className,
        )}
        {...rest}
      >
        {as === 'dot' ? (
          <span data-beat-dot="" className={cn('h-1.5 w-1.5 rounded-full', beatClasses(tone, 'dot'))} />
        ) : (
          <Glyph strokeWidth={1.5} />
        )}
      </span>
    );
  },
);

BeatGlyph.displayName = 'BeatGlyph';

export { BeatGlyph };
export default BeatGlyph;
