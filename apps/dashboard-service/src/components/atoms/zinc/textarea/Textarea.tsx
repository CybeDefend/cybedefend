import React from 'react';

import { FIELD, FIELD_FOCUS } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A multi-line field with the same hairline, halo and invalid state as
 * `Input`. Grows vertically only; `mono` for a rule body or a command.
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ mono = false, rows = 4, className, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(FIELD, FIELD_FOCUS, 'block min-h-[72px] resize-y px-2.5 py-2 leading-5', mono && 'font-mono text-xs', className)}
      {...rest}
    />
  ),
);

Textarea.displayName = 'VdTextarea';

export { Textarea };
export default Textarea;
