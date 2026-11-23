import React from 'react';
import { useTranslation } from 'react-i18next';

import { Loader2 } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';

/**
 * A quiet zinc spinner (lucide `Loader2`, stroke 1.5). Standalone it is a
 * `status` named "Loading"; inside a control that already says it is busy
 * (`Button loading`), pass `decorative` and it stays out of the tree.
 */
export type SpinnerSize = 'xs' | 'sm' | 'md';

export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: SpinnerSize;
  /** The words a screen reader hears. Default: "Loading". */
  label?: string;
  decorative?: boolean;
}

const PX: Record<SpinnerSize, number> = { xs: 12, sm: 14, md: 16 };

const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ size = 'sm', label, decorative = false, className, ...rest }, ref) => {
    const { t } = useTranslation();
    return (
      <span
        ref={ref}
        role={decorative ? undefined : 'status'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label ?? t('components.kit.loading')}
        className={cn('inline-flex shrink-0 items-center justify-center text-current opacity-70', className)}
        {...rest}
      >
        <Loader2 size={PX[size]} strokeWidth={1.5} className="animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]" />
      </span>
    );
  },
);

Spinner.displayName = 'Spinner';

export { Spinner };
export default Spinner;
