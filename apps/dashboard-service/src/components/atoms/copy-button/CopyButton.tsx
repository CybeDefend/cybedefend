import React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import Button from '@/components/atoms/button/Button';
import { Check, Copy } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { useCopyToClipboard } from './useCopyToClipboard';

export type CopyButtonSurface = 'light' | 'dark';
export type CopyButtonSize = 'xs' | 'sm';

/**
 * Anything a native `<button>` accepts is forwarded (`data-testid`, `disabled`,
 * a ref…). `onClick` and `children` belong to the component.
 */
export interface CopyButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
  /** What lands in the clipboard. */
  text: string;
  /** Accessible name of the icon-only button: say what is copied. */
  label: string;
  /** Accessible name while the « copied » mark shows. */
  copiedLabel?: string;
  /** Toasted after a successful copy; nothing when absent. */
  successMessage?: string;
  /** Toasted when the clipboard refuses; nothing when absent. */
  errorMessage?: string;
  /** `dark` sits on a terminal-like surface that is dark in both themes. */
  surface?: CopyButtonSurface;
  size?: CopyButtonSize;
  /** How long the « copied » mark shows. */
  resetAfterMs?: number;
}

const surfaceClasses: Record<CopyButtonSurface, string> = {
  light: cn(
    'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
    'focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-secondary/50',
    'dark:text-gray-400 dark:hover:bg-neutral-800 dark:hover:text-gray-200'
  ),
  // The classes of the copy control on the agents link command terminal.
  dark: cn(
    'text-gray-500 hover:bg-white/10 hover:text-gray-200',
    'focus:ring-secondary focus:ring-offset-gray-900',
    'dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-200 dark:focus:ring-offset-black'
  ),
};

const checkClasses: Record<CopyButtonSurface, string> = {
  light: 'text-green-600 dark:text-green-400',
  dark: 'text-green-400',
};

const sizeClasses: Record<CopyButtonSize, { button: string; icon: string }> = {
  xs: { button: 'p-1', icon: 'h-4 w-4' },
  sm: { button: 'p-1.5', icon: 'h-5 w-5' },
};

/**
 * An icon-only button that copies `text`, swaps its Copy icon for a Check
 * while the copy is fresh, and renames itself so a screen reader hears it.
 */
export const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      text,
      label,
      copiedLabel,
      successMessage,
      errorMessage,
      surface = 'light',
      size = 'sm',
      resetAfterMs,
      className,
      title,
      ...rest
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const { copied, copy } = useCopyToClipboard({ resetAfterMs });
    const name = copied ? (copiedLabel ?? t('components.copyButton.copied')) : label;

    const handleClick = async () => {
      const ok = await copy(text);
      if (ok) {
        if (successMessage) toast.success(successMessage);
      } else if (errorMessage) {
        toast.error(errorMessage);
      }
    };

    return (
      <Button
        ref={ref}
        variant="ghost"
        size="xs"
        title={title ?? name}
        {...rest}
        aria-label={name}
        onClick={handleClick}
        className={cn('rounded-md', sizeClasses[size].button, surfaceClasses[surface], className)}
      >
        {copied ? (
          <Check aria-hidden="true" className={cn(sizeClasses[size].icon, checkClasses[surface])} />
        ) : (
          <Copy aria-hidden="true" className={sizeClasses[size].icon} />
        )}
      </Button>
    );
  },
);

CopyButton.displayName = 'CopyButton';

export default CopyButton;
