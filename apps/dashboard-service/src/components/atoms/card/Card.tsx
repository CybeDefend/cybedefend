import React from "react";
import { cn } from "@/utils/function/utils";
import { AS_PANEL_TITLE } from "@/components/atoms/appsec/styles";

export type CardVariant = 'default' | 'elevated' | 'outlined' | 'ghost';
export type CardSeverity = 'low' | 'medium' | 'high' | 'critical' | 'fixed';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardElement = 'div' | 'section' | 'aside' | 'article';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  /** Visual variant of the card */
  variant?: CardVariant;
  /** Severity indicator (shows colored top border) */
  severity?: CardSeverity;
  /** Padding size */
  padding?: CardPadding;
  /** Hover effect */
  hoverable?: boolean;
  /** Make the card clickable */
  clickable?: boolean;
  /** The root element, so a card can be a landmark or an article. */
  as?: CardElement;
}

const severityClasses: Record<CardSeverity, string> = {
  low: 'border-t-2 border-t-low-risk',
  medium: 'border-t-2 border-t-medium-risk',
  high: 'border-t-2 border-t-high-risk',
  critical: 'border-t-2 border-t-critical-risk',
  fixed: 'border-t-2 border-t-fixed',
};

/*
  Hairlines, not shadows: a panel is the surface layer in dark, lit by a 1 px
  top highlight. Only `elevated` keeps a soft shadow in light.
*/
const variantClasses: Record<CardVariant, string> = {
  default: 'bg-white border border-zinc-200 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]',
  elevated: 'bg-white border border-zinc-200 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]',
  outlined: 'bg-transparent border border-gray-200 dark:border-as-line-strong',
  ghost: 'bg-zinc-50 border border-transparent dark:bg-white/[0.03]',
};

const paddingClasses: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

/**
 * Modern Card component with multiple variants and severity indicators.
 * Follows atomic design principles for maximum reusability.
 */
const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  severity,
  padding = 'md',
  hoverable = false,
  clickable = false,
  as: Root = 'div',
  ...props
}) => {
  return (
    <Root
      className={cn(
        'rounded-2xl w-full transition-[border-color,background-color] duration-[120ms]',
        variantClasses[variant],
        paddingClasses[padding],
        severity && severityClasses[severity],
        hoverable && 'hover:border-zinc-300 dark:hover:border-white/[0.14]',
        clickable && 'cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </Root>
  );
};

/**
 * Card Header component for consistent card layouts
 */
export const CardHeader: React.FC<{
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}> = ({ children, className, action }) => (
  <div className={cn('flex items-center justify-between mb-4', className)}>
    <div className="flex-1">{children}</div>
    {action && <div className="ml-4">{action}</div>}
  </div>
);

/**
 * Card Title component
 */
export const CardTitle: React.FC<{
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  /** Heading level, to fit the page outline (default h3). */
  as?: 'h2' | 'h3' | 'h4';
}> = ({ children, className, icon, as: Heading = 'h3' }) => (
  <Heading className={cn(AS_PANEL_TITLE, 'flex items-center gap-2', className)}>
    {icon}
    {children}
  </Heading>
);

/**
 * Card Description component
 */
export const CardDescription: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <p className={cn('text-[13px] text-zinc-500 dark:text-zinc-400 mt-1', className)}>
    {children}
  </p>
);

/**
 * Card Content component
 */
export const CardContent: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('', className)}>
    {children}
  </div>
);

/**
 * Card Footer component
 */
export const CardFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('mt-4 pt-4 border-t border-zinc-200 dark:border-as-line flex items-center justify-end gap-2', className)}>
    {children}
  </div>
);

export default Card;

