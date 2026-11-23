import React from 'react';

import { FIELD, FIELD_FOCUS } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A text field of the zinc kit: 32 px (`md`) or 28 px (`sm`), a
 * hairline that darkens on hover, a soft 3 px zinc halo on focus, the red
 * hairline when `aria-invalid`. Everything a native `<input>` accepts is
 * forwarded. Label it: a `<label htmlFor>`, or `aria-label`.
 */
export type InputSize = 'sm' | 'md';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  /** Use Geist Mono: an id, a token, a path. */
  mono?: boolean;
}

export const INPUT_SIZES: Record<InputSize, string> = {
  sm: 'h-7 px-2 text-xs max-md:h-9',
  md: 'h-8 px-2.5 max-md:h-11',
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', mono = false, type = 'text', className, ...rest }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(FIELD, FIELD_FOCUS, INPUT_SIZES[size], mono && 'font-mono', className)}
      {...rest}
    />
  ),
);

Input.displayName = 'VdInput';

export { Input };
export default Input;
