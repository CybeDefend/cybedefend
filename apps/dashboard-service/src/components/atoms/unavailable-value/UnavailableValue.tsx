import React from 'react';

/**
 * A value that cannot be shown, said in words in the interface's font
 * (« Not available »), never a dash nor a zero (no dash in displayed text). The caller gives the words and, if it wants, a quieter tone.
 */
export interface UnavailableValueProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** What is said in place of the value. */
  label: string;
}

const UnavailableValue = React.forwardRef<HTMLSpanElement, UnavailableValueProps>(({ label, ...rest }, ref) => (
  <span ref={ref} data-unavailable="" {...rest}>
    {label}
  </span>
));

UnavailableValue.displayName = 'UnavailableValue';

export { UnavailableValue };
export default UnavailableValue;
