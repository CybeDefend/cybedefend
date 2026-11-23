import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_TAG } from '@/components/atoms/appsec/styles';

export type BadgeVariant =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'fixed';

export type BadgeSize = 'xs' | 'sm' | 'md';

/**
 * Accepts and forwards anything a `<span>` accepts, so a badge can carry a
 * `title` or an `aria-label` without a caller having to hand-roll one.
 */
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Label text (alternative to children) */
  label?: string;
  /** Count to display before label */
  count?: number;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Custom colors (legacy support) */
  bgColor?: string;
  textColor?: string;
  darkBgColor?: string;
  darkTextColor?: string;
  /** Former dot indicator: the dot is gone, the prop stays so no caller breaks. */
  dot?: boolean;
  /** Icon */
  icon?: React.ReactNode;
  /**
   * `pill` (default): the tinted chip. `dot`: the word alone, written in the
   * variant's colour, no fill, no ring, no dot (a risk level or a status is information, not a button). `tag`: a
   * quiet hairline tag (a category, a count in a tab, Cybe Analysis): no fill,
   * the word in zinc, the figure mono; the caller colours its `icon`
   * (`AS_TAG_GLYPH_ON` while active, `AS_TAG_GLYPH_OFF` otherwise).
   */
  appearance?: 'pill' | 'dot' | 'tag';
  className?: string;
}

/*
  A badge is not a control: no hover tint. Severity chips keep their colour as
  words; their edge is an inset ring, so the chip is 2 px
  smaller than the bordered one it replaces and nothing around it moves.
*/
const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-zinc-300',
  // `primary` is a near-black brand navy (#1a1a2e); reusing it as the dark-mode
  // text colour rendered invisible on the dark badge surface. White
  // text keeps the badge legible on a neutral tint in dark.
  primary: 'bg-primary/10 text-primary dark:bg-white/[0.08] dark:text-white',
  secondary: 'bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  // Severity variants for vulnerabilities, in the Tailwind config's risk colours.
  low: 'bg-low-risk/15 text-low-risk ring-1 ring-inset ring-low-risk/25 dark:bg-low-risk/[0.12] dark:text-low-risk dark:ring-low-risk/25',
  medium: 'bg-medium-risk/15 text-medium-risk ring-1 ring-inset ring-medium-risk/25 dark:bg-medium-risk/[0.12] dark:text-medium-risk dark:ring-medium-risk/25',
  high: 'bg-high-risk/15 text-high-risk ring-1 ring-inset ring-high-risk/25 dark:bg-high-risk/[0.12] dark:text-high-risk dark:ring-high-risk/25',
  critical: 'bg-critical-risk/15 text-critical-risk ring-1 ring-inset ring-critical-risk/25 dark:bg-critical-risk/[0.12] dark:text-critical-risk dark:ring-critical-risk/25',
  fixed: 'bg-fixed/15 text-fixed ring-1 ring-inset ring-fixed/25 dark:bg-fixed/[0.12] dark:text-fixed dark:ring-fixed/25',
};

const sizeClasses: Record<BadgeSize, string> = {
  // 18 px
  xs: 'px-1.5 py-0.5 text-[10px] leading-[14px]',
  // 20 px
  sm: 'px-2 py-0.5 text-xs',
  // 24 px
  md: 'px-2 py-0.5 text-[13px] leading-5',
};

/** The dot + word form: no padding, the word's size alone. */
const dotSizeClasses: Record<BadgeSize, string> = {
  xs: 'text-xs',
  sm: 'text-[13px]',
  md: 'text-[13px]',
};

/**
 * The word of the « dot » form, in the variant's colour (the dot itself is
 * gone): at least 4.5:1 on white and on the dark surfaces.
 */
const dotWordClasses: Record<BadgeVariant, string> = {
  default: 'text-zinc-700 dark:text-zinc-200',
  primary: 'text-zinc-900 dark:text-zinc-100',
  secondary: 'text-secondary dark:text-secondary-light',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-blue-600 dark:text-blue-400',
  low: 'text-blue-600 dark:text-blue-400',
  medium: 'text-amber-700 dark:text-amber-400',
  high: 'text-orange-700 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
  fixed: 'text-emerald-700 dark:text-emerald-400',
};

/**
 * Modern Badge component with predefined variants and severity colors.
 * Supports dots, icons, label/count props, and custom color overrides for legacy compatibility.
 */
const Badge: React.FC<BadgeProps> = ({
  children,
  label,
  count,
  variant = 'default',
  size = 'sm',
  bgColor,
  textColor,
  darkBgColor,
  darkTextColor,
  dot,
  icon,
  appearance = 'pill',
  className,
  ...rest
}) => {
  // Legacy mode: use custom colors if provided
  const useLegacyColors = bgColor && textColor;

  // Determine content: prefer children, fallback to label/count
  const content = children ?? (
    <>
      {count !== undefined && <span className="font-medium tabular-nums">{count}</span>}
      {label}
    </>
  );

  if (appearance === 'tag') {
    return (
      <span
        className={cn(AS_TAG, size === 'xs' && 'text-[11px]', className)}
        data-appearance="tag"
        {...rest}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        {children ?? (
          <>
            {count !== undefined && <span className="font-mono tabular-nums">{count}</span>}
            {label}
          </>
        )}
      </span>
    );
  }

  if (appearance === 'dot') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap normal-case cursor-default',
          dotWordClasses[variant],
          dotSizeClasses[size],
          className
        )}
        data-appearance="dot"
        {...rest}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        {content}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-md whitespace-nowrap transition-colors duration-[120ms] cursor-default',
        sizeClasses[size],
        useLegacyColors
          ? `${bgColor} ${textColor} ${darkBgColor || ''} ${darkTextColor || ''}`
          : variantClasses[variant],
        className
      )}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {content}
    </span>
  );
};

/**
 * Legacy Badge support - maps old props to new component
 * @deprecated Use Badge with label/count props directly
 */
export const LegacyBadge: React.FC<{
  label: string;
  count?: number;
  bgColor: string;
  textColor: string;
  darkBgColor: string;
  darkTextColor: string;
}> = ({ label, count, bgColor, textColor, darkBgColor, darkTextColor }) => (
  <Badge
    label={label}
    count={count}
    bgColor={bgColor}
    textColor={textColor}
    darkBgColor={darkBgColor}
    darkTextColor={darkTextColor}
  />
);

export default Badge;