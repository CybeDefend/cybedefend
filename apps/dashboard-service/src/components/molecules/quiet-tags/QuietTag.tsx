import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_TAG, AS_TAG_ACCENT, AS_TAG_GLYPH_OFF, AS_TAG_GLYPH_ON, AS_TOOLTIP } from '@/components/atoms/appsec/styles';

interface QuietTagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** A registry icon, drawn at 12 px before the label. */
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  /** The glyph alone, the label as a tooltip and as the accessible name. */
  iconOnly?: boolean;
  /** The brand glyph takes the accent only while the thing it names is active. */
  active?: boolean;
  /** `accent`: words, glyph and hairline in the accent, whatever `active` says. */
  tone?: 'quiet' | 'accent';
  tooltipPlacement?: 'top' | 'right';
}

/**
 * A quiet tag: a hairline, no fill, 12 px zinc words. Replaces the tinted
 * badges and the tinted category chips.
 */
export const QuietTag: React.FC<QuietTagProps> = ({
  icon: Icon,
  label,
  iconOnly = false,
  active = false,
  tone = 'quiet',
  tooltipPlacement = 'top',
  className,
  ...rest
}) => {
  const accent = tone === 'accent';
  const tooltipPosition =
    tooltipPlacement === 'right'
      ? 'left-full top-1/2 ml-2 -translate-y-1/2'
      : 'bottom-full left-1/2 mb-2 -translate-x-1/2';
  return (
    <span
      className={cn(AS_TAG, accent && AS_TAG_ACCENT, iconOnly && 'group relative cursor-default', className)}
      title={label}
      aria-label={label}
      {...rest}
    >
      {Icon && <Icon className={cn('h-3 w-3 shrink-0', accent || active ? AS_TAG_GLYPH_ON : AS_TAG_GLYPH_OFF)} />}
      {!iconOnly && <span>{label}</span>}
      {iconOnly && (
        <span
          className={cn(
            'absolute whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
            AS_TOOLTIP,
            tooltipPosition,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
};

export default QuietTag;
