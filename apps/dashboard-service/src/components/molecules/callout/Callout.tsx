import React from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import { AlertCircle, AlertTriangle, Info, Sparkles, X } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';

export type CalloutTone = 'accent' | 'info' | 'warning' | 'error' | 'neutral';
export type CalloutSize = 'sm' | 'md';
export type CalloutLive = 'status' | 'alert' | 'off';

/**
 * A box that says something about the page around it: a hint, a state, a
 * failure. Every native `<div>` attribute is forwarded (`data-testid`,
 * `data-product`, `id`...), and the ref goes to the box itself.
 */
export interface CalloutProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** What the box means; drives its colours and its default icon. */
  tone?: CalloutTone;
  /** Replaces the tone's icon; `false` shows none. */
  icon?: React.ReactNode | false;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A row under the body, for the buttons or links the box offers. */
  actions?: React.ReactNode;
  /**
   * Whether the box is a live region: `status` (polite), `alert` (assertive)
   * or `off`. Defaults to `alert` for the error tone, `off` otherwise.
   */
  live?: CalloutLive;
  /** Shows an icon-only close button that calls it. */
  onDismiss?: () => void;
  /** Accessible name of the close button. */
  dismissLabel?: string;
  /** `data-testid` of the close button (the box's own one goes through `data-testid`). */
  dismissTestId?: string;
  size?: CalloutSize;
}

const toneClasses: Record<CalloutTone, { box: string; icon: string; title: string; body: string }> = {
  accent: {
    box: 'border-secondary/20 bg-secondary/5 dark:border-secondary/30 dark:bg-secondary/10',
    icon: 'text-secondary dark:text-secondary-light',
    title: 'text-gray-900 dark:text-white',
    body: 'text-gray-700 dark:text-gray-200',
  },
  info: {
    box: 'border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20',
    icon: 'text-blue-600 dark:text-blue-400',
    title: 'text-blue-900 dark:text-blue-100',
    body: 'text-blue-800 dark:text-blue-200',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20',
    icon: 'text-amber-600 dark:text-amber-400',
    title: 'text-amber-900 dark:text-amber-100',
    body: 'text-amber-800 dark:text-amber-200',
  },
  error: {
    box: 'border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20',
    icon: 'text-red-600 dark:text-red-400',
    title: 'text-red-900 dark:text-red-100',
    body: 'text-red-800 dark:text-red-200',
  },
  neutral: {
    box: 'border-gray-200 bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800/50',
    icon: 'text-gray-500 dark:text-gray-400',
    title: 'text-gray-900 dark:text-gray-100',
    body: 'text-gray-600 dark:text-gray-300',
  },
};

const toneIcons: Record<CalloutTone, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  accent: Sparkles,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  neutral: Info,
};

const sizeClasses: Record<CalloutSize, { box: string; icon: string }> = {
  md: { box: 'gap-3 p-4 text-sm', icon: 'h-5 w-5' },
  sm: { box: 'gap-2 p-3 text-xs', icon: 'h-4 w-4' },
};

const roles: Record<CalloutLive, 'status' | 'alert' | undefined> = {
  status: 'status',
  alert: 'alert',
  off: undefined,
};

const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(({
  tone = 'info',
  icon,
  title,
  children,
  actions,
  live,
  onDismiss,
  dismissLabel,
  dismissTestId,
  size = 'md',
  className,
  ...rest
}, ref) => {
  const { t } = useTranslation();
  const colours = toneClasses[tone];
  const role = roles[live ?? (tone === 'error' ? 'alert' : 'off')];
  const DefaultIcon = toneIcons[tone];

  let iconNode: React.ReactNode = null;
  if (icon === undefined) {
    iconNode = <DefaultIcon className={cn('mt-0.5 shrink-0', sizeClasses[size].icon, colours.icon)} aria-hidden />;
  } else if (icon !== false && icon !== null) {
    iconNode = <span className={cn('mt-0.5 flex shrink-0', colours.icon)} aria-hidden="true">{icon}</span>;
  }

  return (
    <div
      ref={ref}
      role={role}
      className={cn('flex items-start rounded-lg border text-left', sizeClasses[size].box, colours.box, className)}
      {...rest}
    >
      {iconNode}
      <div className={cn('min-w-0 flex-1 space-y-1', colours.body)}>
        {title && <div className={cn('font-medium', colours.title)}>{title}</div>}
        {children}
        {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onDismiss}
          aria-label={dismissLabel ?? t('components.callout.dismiss')}
          data-testid={dismissTestId}
          className="-my-1 -mr-1 shrink-0 focus-visible:ring-2 focus-visible:ring-secondary/50"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
});

Callout.displayName = 'Callout';

export { Callout };
export default Callout;
