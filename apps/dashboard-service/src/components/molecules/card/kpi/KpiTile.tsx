import React from 'react';
import { cn } from '@/utils/function/utils';
import type { IconProps } from '@/components/atoms/icon/icons';
import {
  AS_KPI_LABEL,
  AS_KPI_NOTE,
  AS_KPI_STRIP_CELL,
  AS_KPI_VALUE,
  AS_PANEL,
} from '@/components/atoms/appsec/styles';
import { AS_GLYPH } from '@/components/atoms/appsec/recipes';
import KpiSparkline from './KpiSparkline';
import type { AsDeltaTone } from './kpiTone';
import { WORD_TONE, type WordTone } from './wordTone';

interface KpiTileProps {
  /** The figure, in ink. */
  value: React.ReactNode;
  /** A figure is mono; a word (a plan name, a date) reads in the text face. */
  mono?: boolean;
  label: React.ReactNode;
  /** The KPI's own colour, carried by its label (no dot). Without it the label stays zinc. */
  tone?: WordTone;
  /** The delta figure, coloured by `deltaTone`. */
  delta?: React.ReactNode;
  deltaTone?: AsDeltaTone;
  /** Zinc words after the delta (« in the last 7 days »), or on their own. */
  note?: React.ReactNode;
  /** A series the page already holds: drawn as a tiny zinc sparkline. */
  series?: readonly (number | null | undefined)[];
  seriesLabel?: string;
  /** A quiet zinc glyph in the corner. */
  icon?: React.ComponentType<IconProps>;
  /** Anything that sits beside the glyph (an info badge). */
  accessory?: React.ReactNode;
  /** `card`: its own panel. `cell`: a cell of an `AS_KPI_STRIP`. */
  frame?: 'card' | 'cell';
  className?: string;
  'data-testid'?: string;
}

/**
 * One KPI in the AppSec reading, with no dots: the figure in ink, the label under it in the KPI's own colour
 * when it has one (« Critical issues » in red, « Resolved » in green), the
 * delta in green, red or zinc by what it means, and a tiny zinc sparkline in
 * the corner where the page already holds a series. The glyph stays quiet.
 */
const KpiTile: React.FC<KpiTileProps> = ({
  value,
  mono = true,
  label,
  tone,
  delta,
  deltaTone = 'neutral',
  note,
  series,
  seriesLabel,
  icon,
  accessory,
  frame = 'card',
  className,
  'data-testid': testId,
}) => {
  const hasFoot = delta !== undefined || note !== undefined;
  // A series takes the corner beside the figure (figure and line read together); the glyph keeps it otherwise.
  const hasSeries = (series?.filter((v) => typeof v === 'number' && Number.isFinite(v)).length ?? 0) > 1;
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex h-full flex-col',
        frame === 'card' ? cn(AS_PANEL, 'p-4 sm:p-5') : AS_KPI_STRIP_CELL,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn(AS_KPI_VALUE, 'min-w-0 truncate', mono && 'font-mono')}>{value}</p>
        {(accessory || icon || hasSeries) && (
          <div className="flex shrink-0 items-center gap-1">
            {accessory}
            {hasSeries ? (
              <KpiSparkline series={series!} label={seriesLabel} className="mt-2" />
            ) : (
              icon && React.createElement(icon, { className: cn(AS_GLYPH, 'mt-2') })
            )}
          </div>
        )}
      </div>
      {/* A label may take two lines in a narrow cell (« Pending vulnerabilities » at 390 px). */}
      <p className={cn(AS_KPI_LABEL, 'mt-1 min-w-0 leading-5', tone && WORD_TONE[tone])}>{label}</p>
      {hasFoot && (
        <p className={cn(AS_KPI_NOTE, 'mt-auto min-w-0 pt-2')}>
          {delta !== undefined && (
            <span className={cn('font-mono font-medium tabular-nums', WORD_TONE[deltaTone])}>{delta}</span>
          )}
          {delta !== undefined && note !== undefined && ' '}
          {note}
        </p>
      )}
    </div>
  );
};

export default KpiTile;
