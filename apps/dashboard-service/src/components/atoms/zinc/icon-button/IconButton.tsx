import React from 'react';

import Button, { type ButtonProps } from '@/components/atoms/zinc/button/Button';
import Tooltip from '@/components/atoms/zinc/tooltip/Tooltip';
import { cn } from '@/utils/function/utils';

/**
 * An icon-only button: a 28 px (`sm`) or 32 px (`md`) square, ghost by
 * default, the 16 px lucide glyph in zinc-400 turning ink on hover. A name is
 * required — it is the only thing a screen reader gets — and `tooltip` shows
 * the same words (or other ones) in the ink bubble.
 */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leadingIcon' | 'trailingIcon' | 'square' | 'aria-label'> {
  'aria-label': string;
  icon: React.ReactNode;
  /** `true`: the bubble repeats the name. A node: says that instead. */
  tooltip?: boolean | React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** A shortcut for the bubble (`⌘K`). */
  shortcut?: React.ReactNode;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, tooltip = false, tooltipSide = 'top', shortcut, variant = 'ghost', size = 'md', className, loading, ...rest }, ref) => {
    const button = (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        square
        loading={loading}
        className={cn(variant === 'ghost' && '[&_svg]:text-zinc-400 hover:[&_svg]:text-zinc-900 dark:[&_svg]:text-zinc-500 dark:hover:[&_svg]:text-zinc-100', className)}
        {...rest}
      >
        {loading ? null : (
          <span aria-hidden="true" className="inline-flex items-center justify-center">
            {icon}
          </span>
        )}
      </Button>
    );
    if (!tooltip) return button;
    return (
      <Tooltip content={tooltip === true ? rest['aria-label'] : tooltip} side={tooltipSide} shortcut={shortcut}>
        {button}
      </Tooltip>
    );
  },
);

IconButton.displayName = 'IconButton';

export { IconButton };
export default IconButton;
