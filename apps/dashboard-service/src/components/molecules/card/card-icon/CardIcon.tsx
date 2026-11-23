import React from "react";
import { Skeleton } from "../../../atoms/skeleton/Skeleton";
import type { IconProps } from '@/components/atoms/icon/icons';
import { AS_KPI_LABEL, AS_KPI_NOTE } from '@/components/atoms/appsec/styles';
import type { AsDeltaTone } from '@/components/molecules/card/kpi/kpiTone';
import { WORD_TONE, type WordTone } from '@/components/molecules/card/kpi/wordTone';
import { AS_GLYPH } from '@/components/atoms/appsec/recipes';
import { cn } from '@/utils/function/utils';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface CardIconProps {
  icon: IconComponent;
  /**
   * The tile colours of the first design. The tile is gone (the icon is a
   * quiet zinc glyph), so both are accepted and
   * ignored; the props stay so no caller has to change.
   */
  iconBgColor?: string;
  iconColor?: string;
  /** The whole phrase, « 11 Critical Risk Projects »: what assistive technology and the page tests read. */
  title: string;
  /**
   * The figure and its label, when the caller splits the phrase for the
   * « figure first » reading. Without them the phrase is shown as
   * it is.
   */
  value?: number | string;
  label?: string;
  /** The delta or the period, under the label. */
  description: string;
  /** The KPI's own colour, carried by its label (« Critical risk projects » in red); no dot. */
  tone?: WordTone;
  /**
   * The delta figure and the words after it, when the caller wants the
   * figure coloured by what it means (`deltaTone`): « 64 » in mint, then
   * « in last 7 days » in zinc. The visible line then reads exactly as
   * `description`, which it replaces.
   */
  delta?: number | string;
  deltaNote?: string;
  deltaTone?: AsDeltaTone;
  children?: React.ReactNode;
  loading?: boolean;
}

/**
 * A KPI card of the dashboard row, in the « figure first » reading: the mono figure, the label under it, the
 * delta under that, and the icon as a quiet zinc glyph in the corner instead
 * of a tinted tile. The phrase (`title`) is what is read aloud: the visible
 * split is hidden from assistive technology so the figure and its label are
 * one sentence there, as they were.
 */
const CardIcon: React.FC<CardIconProps> = ({
  icon,
  title,
  value,
  label,
  description,
  tone,
  delta,
  deltaNote,
  deltaTone = 'neutral',
  children,
  loading,
}) => {
  const split = value !== undefined && value !== null;
  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {loading ? (
        <div className="flex items-center h-full">
          <Skeleton type="avatar" height="40px" width="40px" />
          <div className="flex flex-col ml-3 flex-1">
            <Skeleton type="text" rows={1} width="60%" />
            <div className="mb-2"></div>
            <Skeleton type="text" rows={1} width="80%" />
          </div>
        </div>
      ) : split ? (
        <>
          <p className="sr-only">{title}</p>
          <div aria-hidden="true" className="flex items-start justify-between gap-3">
            <p className="font-mono text-2xl font-medium leading-7 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50">
              {value}
            </p>
            {React.createElement(icon, { className: cn(AS_GLYPH, 'mt-1') })}
          </div>
          <p aria-hidden="true" className={cn(AS_KPI_LABEL, 'mt-1 truncate', tone && WORD_TONE[tone])}>
            {label}
          </p>
          {delta !== undefined ? (
            <p className={cn(AS_KPI_NOTE, 'mt-1')}>
              <span className={cn('font-mono font-medium tabular-nums', WORD_TONE[deltaTone])}>{delta}</span>
              {deltaNote ? ` ${deltaNote}` : null}
            </p>
          ) : (
            <p className={cn(AS_KPI_NOTE, 'mt-1 tabular-nums')}>
              {description}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium leading-5 text-zinc-900 dark:text-zinc-100">
              {title}
            </p>
            {React.createElement(icon, { className: cn(AS_GLYPH, 'mt-0.5') })}
          </div>
          <p className={cn(AS_KPI_NOTE, 'mt-1 tabular-nums')}>
            {description}
          </p>
        </>
      )}
      {children}
    </div>
  );
};

export default CardIcon;
