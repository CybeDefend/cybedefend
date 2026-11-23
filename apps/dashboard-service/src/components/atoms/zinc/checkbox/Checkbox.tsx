import React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';

import { Check, Minus } from '@/components/atoms/icon/icons';
import { FOCUS_RING, TOUCH_HIT_SQUARE } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A 16 px checkbox (Radix: `role="checkbox"`, `aria-checked` including
 * `mixed`): a hairline square that fills ink when checked or indeterminate,
 * the mark in the panel colour. Name it with `aria-label` or a label.
 */
export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, checked, ...rest }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      className={cn(
        'peer relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-zinc-300 bg-white transition-colors duration-[120ms]',
        'hover:border-zinc-400 data-[state=checked]:border-zinc-900 data-[state=checked]:bg-zinc-900 data-[state=indeterminate]:border-zinc-900 data-[state=indeterminate]:bg-zinc-900',
        'dark:border-white/[0.18] dark:bg-white/[0.02] dark:hover:border-white/[0.3] dark:data-[state=checked]:border-zinc-100 dark:data-[state=checked]:bg-zinc-100 dark:data-[state=indeterminate]:border-zinc-100 dark:data-[state=indeterminate]:bg-zinc-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
        FOCUS_RING,
        TOUCH_HIT_SQUARE,
        className,
      )}
      {...rest}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white dark:text-zinc-900">
        {checked === 'indeterminate' ? (
          <Minus aria-hidden="true" size={12} strokeWidth={2.25} />
        ) : (
          <Check aria-hidden="true" size={10} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);

Checkbox.displayName = 'VdCheckbox';

export { Checkbox };
export default Checkbox;
