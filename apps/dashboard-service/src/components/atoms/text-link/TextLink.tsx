import React from 'react';
import { Link, type To } from 'react-router-dom';
import { cn } from '@/utils/function/utils';

export type TextLinkTone = 'accent' | 'danger' | 'inherit';
export type TextLinkUnderline = 'hover' | 'always';

/**
 * One inline-link look for the three elements a link in running text can be:
 * `to` renders a react-router `<Link>`, `href` a native `<a>`, and neither a
 * `<button type="button">` driven by `onClick`. The anchor attributes are
 * forwarded to whichever is rendered, and so is the ref.
 */
export interface TextLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'> {
  /** Internal route: a react-router `<Link>`, preserving ctrl/cmd+click. */
  to?: To;
  /** External or plain URL: a native `<a>`. */
  href?: string;
  /** Without `to` or `href`, the link is a button and this is its action. */
  onClick?: React.MouseEventHandler<HTMLElement>;
  tone?: TextLinkTone;
  underline?: TextLinkUnderline;
  children?: React.ReactNode;
}

const toneClasses: Record<TextLinkTone, string> = {
  accent: 'font-medium text-secondary dark:text-secondary-light',
  danger: 'text-red-600 dark:text-red-400',
  inherit: 'text-current',
};

const underlineClasses: Record<TextLinkUnderline, string> = {
  hover: 'hover:underline',
  always: 'underline',
};

/** A new tab must not get a handle on this one, nor learn where it came from. */
const safeRel = (target: string | undefined, rel: string | undefined): string | undefined =>
  rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined);

const TextLink = React.forwardRef<HTMLAnchorElement | HTMLButtonElement, TextLinkProps>(({
  to,
  href,
  onClick,
  tone = 'accent',
  underline = 'hover',
  target,
  rel,
  className,
  children,
  ...rest
}, ref) => {
  const classes = cn(
    'inline rounded-sm underline-offset-2 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50',
    toneClasses[tone],
    underlineClasses[underline],
    className,
  );

  if (to !== undefined) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        target={target}
        rel={safeRel(target, rel)}
        className={classes}
        onClick={onClick}
        {...rest}
      >
        {children}
      </Link>
    );
  }

  if (href !== undefined) {
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        target={target}
        rel={safeRel(target, rel)}
        className={classes}
        onClick={onClick}
        {...rest}
      >
        {children}
      </a>
    );
  }

  // `rest` is typed for an anchor; the attributes a reader cares about
  // (aria-*, data-*, id, title, event handlers) are shared with a button.
  const buttonProps = rest as unknown as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      className={cn('cursor-pointer bg-transparent p-0 text-left', classes)}
      onClick={onClick}
      {...buttonProps}
      type="button"
    >
      {children}
    </button>
  );
});

TextLink.displayName = 'TextLink';

export { TextLink };
export default TextLink;
