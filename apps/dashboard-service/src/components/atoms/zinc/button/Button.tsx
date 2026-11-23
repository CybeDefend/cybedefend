import React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import Spinner from '@/components/atoms/zinc/spinner/Spinner';
import { FOCUS_RING, TOUCH_HIT, TOUCH_HIT_SQUARE } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * The button of the zinc kit: 13 px / 500,
 * 8 px radius, 28 px (`sm`) or 32 px (`md`).
 *
 * - `ink` — the page's one primary action: zinc-900 on light, white on dark.
 * - `outline` — a secondary action: a hairline on the panel colour (in dark,
 *   a raised well on its stronger hairline).
 * - `ghost` — a quiet action in a toolbar or a panel's title row.
 * - `danger` — a destructive action: the word in red on a hairline, never a red slab.
 * - `link` — an inline action that reads as text; its underline turns iris on
 *   hover.
 *
 * Hover tints in 120 ms; no lift, no scale, no shadow. `loading` swaps the
 * leading icon for a spinner and disables the control. `asChild` renders the
 * child instead (a router `Link`, an `<a>`) with the button's look:
 * `<Button asChild variant="outline"><Link to="/x">Open</Link></Button>`.
 */
export const buttonVariants = cva(
  cn(
    'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium',
    'transition-[background-color,border-color,color] duration-[120ms] ease-out',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    FOCUS_RING,
  ),
  {
    variants: {
      variant: {
        ink: 'bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:active:bg-zinc-300',
        outline:
          'border border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-vd-line-strong dark:bg-vd-raised dark:text-zinc-100 dark:hover:border-white/[0.2] dark:hover:bg-white/[0.09]',
        ghost:
          'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100',
        danger:
          'border border-zinc-200 bg-white text-red-600 hover:border-red-300 hover:bg-zinc-50 dark:border-vd-line-strong dark:bg-vd-raised dark:text-red-400 dark:hover:border-red-400/40 dark:hover:bg-white/[0.09]',
        link: 'rounded-sm text-zinc-900 underline decoration-zinc-300 underline-offset-[3px] hover:decoration-iris dark:text-zinc-100 dark:decoration-zinc-600 dark:hover:decoration-iris',
      },
      size: {
        sm: 'h-7 gap-1.5 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5',
        md: 'h-8 gap-2 px-3 text-[13px] [&_svg]:h-4 [&_svg]:w-4',
      },
      square: {
        true: 'px-0',
        false: '',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      { variant: 'link', className: 'h-auto px-0' },
      { square: true, size: 'sm', className: 'w-7' },
      { square: true, size: 'md', className: 'w-8' },
    ],
    defaultVariants: { variant: 'outline', size: 'md', square: false, fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'square'> {
  /** Render the single child (a `Link`, an `<a>`) with the button's look and behaviour. */
  asChild?: boolean;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Icon-only: a square of the size's height. Prefer `IconButton`, which requires a name. */
  square?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      variant,
      size,
      square,
      fullWidth,
      loading = false,
      leadingIcon,
      trailingIcon,
      disabled,
      type,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    // A thumb-sized reach on a phone (styles.ts), unless the control draws its
    // own `::after` (a link stretched over a card) or is not its own
    // positioning box (`static`), where the reach would land elsewhere.
    const childClass = asChild && React.isValidElement<{ className?: string }>(children) ? children.props.className ?? '' : '';
    const ownsAfter = /(^|\s|:)after:|(^|\s)static(\s|$)/.test(`${className ?? ''} ${childClass}`);
    const touch = variant === 'link' || ownsAfter ? null : square ? TOUCH_HIT_SQUARE : TOUCH_HIT;
    const lead = loading ? <Spinner decorative size={size === 'sm' ? 'xs' : 'sm'} /> : leadingIcon;
    const icon = (node: React.ReactNode, edge: 'lead' | 'trail') =>
      node ? (
        <span aria-hidden="true" data-button-icon={edge} className="inline-flex shrink-0 items-center text-current opacity-80">
          {node}
        </span>
      ) : null;

    return (
      <Comp
        ref={ref}
        data-variant={variant ?? 'outline'}
        className={cn(buttonVariants({ variant, size, square, fullWidth }), touch, className)}
        // A native button defaults to submit; the kit's never does unless asked.
        type={asChild ? undefined : type ?? 'button'}
        disabled={asChild ? undefined : disabled || loading}
        aria-disabled={asChild && (disabled || loading) ? true : undefined}
        aria-busy={loading || undefined}
        {...rest}
      >
        {icon(lead, 'lead')}
        <Slottable>{children}</Slottable>
        {icon(trailingIcon, 'trail')}
      </Comp>
    );
  },
);

Button.displayName = 'VdButton';

export { Button };
export default Button;
