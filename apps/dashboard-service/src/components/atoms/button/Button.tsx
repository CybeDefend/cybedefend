import React from 'react';
import { Link, type To } from 'react-router-dom';
import { cn } from '@/utils/function/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'red'
  | 'destructive'
  | 'ghost'
  | 'white'
  | 'outline'
  | 'soft'
  | 'accent-outline'
  | 'row';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Anything a native `<button>` accepts is accepted here and forwarded, so the
 * atom is never the reason to hand-roll a control: `aria-label` on an icon-only
 * button, `form`/`name` on a submit, `onMouseEnter` on a hover affordance, a
 * ref for focus management. Only the props below are consumed by the component.
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
  /** External URL — renders a native <a href>. */
  href?: string;
  /** Internal route — renders a react-router <Link>, preserving ctrl/cmd+click. */
  to?: To;
  /** Anchor targets, honoured by the `href` and `to` forms. */
  target?: string;
  rel?: string;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

/*
  The keyboard ring: its width (`BASE`) and its colour (each variant) live under
  `focus-visible:`, so it only shows for the keyboard, never after a click, and
  a caller that draws its own ring (the zinc kit's segmented tabs, rail, toolbar)
  replaces the colour through twMerge instead of carrying the AppSec accent.
  The offset stays under `focus:`, where those callers zero it.
*/
const variantClasses: Record<ButtonVariant, string> = {
  /* The navy is kept; in dark a strong hairline gives it an edge on near-black. */
  primary: cn(
    'bg-primary text-white border border-transparent',
    'hover:bg-primary-dark',
    'focus-visible:ring-secondary focus:ring-offset-1 focus:ring-offset-white',
    'dark:bg-primary dark:hover:bg-primary-dark dark:border-white/[0.13] dark:focus:ring-offset-as-bg'
  ),
  secondary: cn(
    'bg-secondary text-white border border-transparent',
    'hover:bg-secondary/90',
    'focus-visible:ring-secondary focus:ring-offset-1 focus:ring-offset-white',
    'dark:bg-secondary dark:hover:bg-secondary/85 dark:focus:ring-offset-as-bg'
  ),
  white: cn(
    'bg-white text-zinc-800 border border-zinc-200',
    'hover:bg-zinc-50 hover:border-zinc-300',
    'focus-visible:ring-secondary focus:ring-offset-1 focus:ring-offset-white',
    'dark:bg-as-raised dark:border-as-line-strong dark:text-zinc-100',
    'dark:hover:bg-white/[0.09] dark:hover:border-white/[0.2] dark:focus:ring-offset-as-bg'
  ),
  outline: cn(
    'bg-transparent text-zinc-800 border border-zinc-300',
    'hover:bg-zinc-50 hover:border-zinc-400',
    'focus-visible:ring-secondary focus:ring-offset-1 focus:ring-offset-white',
    'dark:text-zinc-100 dark:border-white/[0.16]',
    'dark:hover:bg-white/[0.04] dark:hover:border-white/[0.24] dark:focus:ring-offset-as-bg'
  ),
  red: cn(
    'bg-red-600 text-white border border-transparent',
    'hover:bg-red-700',
    'focus-visible:ring-red-500 focus:ring-offset-1 focus:ring-offset-white',
    'dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-offset-as-bg'
  ),
  /*
    A destructive action next to a primary one (« Delete team » beside « Add
    member »): red as an outline, never a second solid fill. The solid `red`
    stays for a confirmation's only action (ConfirmationModal pins it).
  */
  destructive: cn(
    'bg-transparent text-red-700 border border-red-600/40',
    'hover:bg-red-600/10 hover:border-red-600/60',
    'focus-visible:ring-red-500 focus:ring-offset-1 focus:ring-offset-white',
    'dark:text-red-400 dark:border-red-400/40 dark:hover:bg-red-500/10 dark:hover:border-red-400/60 dark:focus:ring-offset-as-bg'
  ),
  /*
    The accent as a tint, for an action that leads into the product without
    being the page's main one. `secondary` follows `data-product`, so it is
    violet in AppSec and zinc ink in another product space; the border stays transparent so
    the size matches the other variants.
  */
  soft: cn(
    'bg-secondary/10 text-secondary border border-transparent dark:bg-secondary/20 dark:text-secondary-light',
    'hover:bg-secondary/15 dark:hover:bg-secondary/30',
    'focus:ring-secondary/50 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-as-bg'
  ),
  /* The accent as an outline over a light tint: the way to the other product. */
  'accent-outline': cn(
    'border border-secondary bg-secondary/5 text-secondary dark:border-secondary-light/60 dark:bg-secondary/20 dark:text-secondary-light',
    'hover:bg-secondary/10 dark:hover:bg-secondary/30',
    'focus:ring-secondary/50 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-as-bg'
  ),
  /*
    A whole list row that opens a detail: full width, its content from the
    left, the list's own text, no pill shape and no shrink on press. The ring
    is drawn inside, where a list with `overflow-hidden` does not clip it. The
    row gives its own padding and hover through `className`.
  */
  row: cn(
    'flex w-full justify-start text-left font-normal rounded-none',
    'bg-transparent text-inherit border-0 hover:text-inherit dark:hover:text-inherit',
    'active:scale-100',
    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary/60'
  ),
  ghost: cn(
    'bg-transparent text-zinc-600 border border-transparent',
    'hover:bg-zinc-100 hover:text-zinc-900',
    'focus-visible:ring-secondary focus:ring-offset-1 focus:ring-offset-white',
    'dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 dark:focus:ring-offset-as-bg'
  ),
};

/**
 * Today's base and sizes, kept for the `row` variant only: the kit's lists
 * (DataList and the lists built on it) use them.
 */
const ROW_BASE = cn(
  'inline-flex items-center justify-center font-medium rounded-xl',
  'transition-all duration-200 ease-out',
  'focus:outline-none',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  'active:scale-[0.98]'
);
const ROW_SIZE: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
};

/*
  The 44 px reach of a phone: `AS_TOUCH` (atoms/appsec/styles) without its
  `min-h-full`. A Button its caller makes taller than 44 px is its own reach,
  and ProductChoiceModal's test reads a wide-viewport Button for `min-h-`.
*/
const TOUCH_REACH =
  "max-md:after:absolute max-md:after:inset-x-0 max-md:after:top-1/2 max-md:after:h-11 max-md:after:-translate-y-1/2 max-md:after:content-['']";

/*
  The same reach for a button with no word in it (an icon alone, named by its
  `aria-label`): 44 px both ways, centred, since the box itself is 28-32 px
  wide. `AS_TOUCH_SQUARE` of atoms/appsec/styles, kept here as a literal so
  this file loads nothing beyond its own imports.
*/
const TOUCH_REACH_SQUARE =
  "max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']";

/**
 * True when a node shows a word: a string or a number, or an element whose
 * children do. A glyph from the icon registry has no children, so a Button
 * holding only glyphs reads as icon-only and takes the square reach.
 */
const hasText = (node: React.ReactNode): boolean => {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) return node.some(hasText);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return hasText(node.props.children);
  return false;
};

/*
  28 / 32 / 36 px controls, 8 px radius, colour transitions only, and a 44 px
  invisible reach on a phone (an `::after` on the `relative` host).
*/
const BASE = cn(
  'relative inline-flex items-center justify-center font-medium rounded-lg',
  'transition-[background-color,border-color,color,box-shadow] duration-[120ms] ease-out',
  'focus:outline-none focus-visible:ring-2',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'
);
const SIZE: Record<ButtonSize, string> = {
  // 24 px, no fixed height: inline callers pass p-0.
  xs: 'px-2 py-[3px] text-xs leading-4 gap-1',
  // 28 px; `px-3 py-1.5 text-sm` are what the accent-outline test reads.
  sm: 'h-7 px-3 py-1.5 text-sm gap-1.5',
  // 32 px
  md: 'h-8 px-3.5 text-sm gap-2',
  // 36 px
  lg: 'h-9 px-4 text-sm gap-2',
};

/**
 * Modern Button component with multiple variants, sizes, and states.
 * Supports icons, loading states, and full-width layouts.
 */
const Button = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  href,
  to,
  target,
  rel,
  fullWidth = false,
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  className = '',
  type = 'button',
  ...rest
}, ref) => {
  const isRow = variant === 'row';
  // No word in the button (an icon alone, or `icon` with no children): the
  // phone reach grows both ways, not only in height (verify finding T4b-2).
  const iconOnly = !isRow && !hasText(children);
  const classes = cn(
    isRow ? ROW_BASE : cn(BASE, iconOnly ? TOUCH_REACH_SQUARE : TOUCH_REACH),
    variantClasses[variant],
    isRow ? ROW_SIZE[size] : SIZE[size],
    fullWidth && 'w-full',
    className
  );

  const LoadingSpinner = () => (
    <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" />
  );

  const content = (
    <>
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {icon && iconPosition === 'left' && <span className="shrink-0">{icon}</span>}
          {/*
            A text label gets a wrapper that refuses to break — a wrapped label
            strands the icon on its own line.

            Elements do not. Around a hundred call sites pass their icon as a
            child instead of through `icon`; wrapping those in one span made the
            glyph and the word a single flex item, so the button's own `gap` and
            `items-center` stopped applying to them and a narrow container
            stacked them. Passed through, they become flex children in their own
            right and lay out like any other button content.
          */}
          {typeof children === 'string' || typeof children === 'number' ? (
            <span className="whitespace-nowrap">{children}</span>
          ) : (
            children
          )}
          {icon && iconPosition === 'right' && <span className="shrink-0">{icon}</span>}
        </>
      )}
    </>
  );

  // The link forms are still buttons to the reader, so they carry the same
  // attributes; `rest` is typed for <button> and re-typed here rather than
  // duplicating the whole prop list for each element.
  const anchorProps = rest as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>;

  if (to && !disabled && !loading) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        target={target}
        rel={rel}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        {...anchorProps}
      >
        {content}
      </Link>
    );
  }

  if (href && !disabled && !loading) {
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        target={target}
        rel={rel}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        {...anchorProps}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled || loading}
      {...rest}
    >
      {content}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
