import React from 'react';
import type { Beat } from '@/components/molecules/kit/narrative/beats';
import { cn } from '@/utils/function/utils';

export type IconTileSize = 'sm' | 'md' | 'lg';
/**
 * `accent` and `neutral` everywhere; the beats (`did`, `served`, `stopped`) on
 * the kit's screens, where they render as a bare zinc glyph: that space
 * uses no icon tiles, so a beat tone paints nothing behind it.
 */
export type IconTileTone = 'accent' | 'neutral' | 'quiet' | Beat;
export type IconTileShape = 'square' | 'circle';

/**
 * The tinted square (or disc) an icon sits on in a header or a list row.
 * Decorative by default: it is hidden from assistive tech unless it is given
 * an `aria-label`, in which case it is announced as an image of that name.
 */
export interface IconTileProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The icon, from the registry. Its size is set by the tile. */
  children?: React.ReactNode;
  size?: IconTileSize;
  tone?: IconTileTone;
  shape?: IconTileShape;
}

const sizeClasses: Record<IconTileSize, string> = {
  sm: 'h-7 w-7 [&>svg]:h-4 [&>svg]:w-4',
  md: 'h-9 w-9 [&>svg]:h-5 [&>svg]:w-5',
  lg: 'h-11 w-11 [&>svg]:h-6 [&>svg]:w-6',
};

/** A beat tone: the glyph alone, in the zinc of the space's icons, on nothing. */
const BEAT_GLYPH = 'bg-transparent text-zinc-400 dark:text-zinc-500';

/**
 * `quiet` (AppSec): the tile keeps its box, so
 * nothing around it moves, but paints no fill; the glyph is an 18 px zinc
 * stroke, the ink of a word next to it, since it is the only thing left.
 */
const QUIET_GLYPH = 'bg-transparent text-zinc-500 dark:text-zinc-400 [&>svg]:h-[18px] [&>svg]:w-[18px]';

const toneClasses: Record<IconTileTone, string> = {
  accent: 'bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light',
  neutral: 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400',
  quiet: QUIET_GLYPH,
  did: BEAT_GLYPH,
  served: BEAT_GLYPH,
  stopped: BEAT_GLYPH,
};

const shapeClasses: Record<IconTileShape, string> = {
  square: 'rounded-lg',
  circle: 'rounded-full',
};

const IconTile = React.forwardRef<HTMLSpanElement, IconTileProps>(({
  children,
  size = 'md',
  tone = 'accent',
  shape = 'square',
  className,
  ...rest
}, ref) => {
  const labelled = Boolean(rest['aria-label']);
  return (
    <span
      ref={ref}
      aria-hidden={labelled ? undefined : 'true'}
      role={labelled ? 'img' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        sizeClasses[size],
        toneClasses[tone],
        shapeClasses[shape],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
});

IconTile.displayName = 'IconTile';

export { IconTile };
export default IconTile;
