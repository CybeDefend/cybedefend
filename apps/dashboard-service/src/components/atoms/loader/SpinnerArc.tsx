import React from 'react';
import { cn } from '@/utils/function/utils';

export type SpinnerArcSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Edge in CSS px and the stroke wanted on screen, per size: a hairline arc, 1.5 px up to 24 px, 2 px above. */
const GEOMETRY: Record<SpinnerArcSize, { px: number; stroke: number }> = {
  xs: { px: 12, stroke: 1.5 },
  sm: { px: 16, stroke: 1.5 },
  md: { px: 24, stroke: 1.5 },
  lg: { px: 40, stroke: 2 },
  xl: { px: 64, stroke: 2 },
};

/** The box classes callers already relied on (`w-4 h-4` for `sm`…), kept so a layout around it does not move. */
export const SPINNER_BOX: Record<SpinnerArcSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
  xl: 'h-16 w-16',
};

const VIEW = 24;
/** The arc covers this share of the circle. */
const ARC_SHARE = 0.28;

export interface SpinnerArcProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  size?: SpinnerArcSize;
}

/**
 * The small loading indicator: a short arc turning calmly
 * on a faint track, in `currentColor`, so the caller's variant decides its
 * colour. It replaces the bordered rotating circle; the loaders' sizes and
 * props are unchanged.
 *
 * One turn takes 1.2 s; under reduced motion it still turns, at 3 s, since a
 * still arc would no longer say that something is happening.
 */
const SpinnerArc: React.FC<SpinnerArcProps> = ({ size = 'md', className, ...rest }) => {
  const { px, stroke } = GEOMETRY[size];
  const width = (stroke * VIEW) / px;
  const r = VIEW / 2 - width / 2 - 0.25;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * ARC_SHARE;

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      fill="none"
      focusable="false"
      className={cn(
        'shrink-0 animate-spin [animation-duration:1.2s] motion-reduce:[animation-duration:3s]',
        SPINNER_BOX[size],
        className,
      )}
      {...rest}
    >
      <circle cx={VIEW / 2} cy={VIEW / 2} r={r} stroke="currentColor" strokeOpacity={0.18} strokeWidth={width} />
      <circle
        data-arc=""
        cx={VIEW / 2}
        cy={VIEW / 2}
        r={r}
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${arc.toFixed(3)} ${circumference.toFixed(3)}`}
        transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
      />
    </svg>
  );
};

export default SpinnerArc;
