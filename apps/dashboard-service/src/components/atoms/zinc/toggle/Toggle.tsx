import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { FOCUS_RING, TOUCH_HIT_SQUARE } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * An on/off switch (Radix Switch: `role="switch"`, Space toggles): a 32×18
 * zinc track that turns ink when on, the thumb gliding across in 160 ms.
 * Name it with `aria-label` or a `<label htmlFor>`.
 */
export type ToggleProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'md';
};

const TRACK = {
  md: 'h-[18px] w-8',
  sm: 'h-4 w-7',
} as const;
const THUMB = {
  md: 'h-3.5 w-3.5 data-[state=checked]:translate-x-[16px]',
  sm: 'h-3 w-3 data-[state=checked]:translate-x-[14px]',
} as const;

const Toggle = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, ToggleProps>(
  ({ size = 'md', className, ...rest }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-[160ms]',
        'bg-zinc-200 hover:bg-zinc-300 data-[state=checked]:bg-zinc-900 dark:bg-white/[0.12] dark:hover:bg-white/[0.16] dark:data-[state=checked]:bg-zinc-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
        FOCUS_RING,
        TOUCH_HIT_SQUARE,
        TRACK[size],
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block translate-x-0 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:shadow-none dark:data-[state=checked]:bg-zinc-900',
          THUMB[size],
        )}
      />
    </SwitchPrimitive.Root>
  ),
);

Toggle.displayName = 'VdToggle';

export { Toggle };
export default Toggle;
