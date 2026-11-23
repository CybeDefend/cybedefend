import React from 'react';

import { Search } from '@/components/atoms/icon/icons';
import { FIELD, FIELD_FOCUS } from '@/components/atoms/zinc/styles';
import { INPUT_SIZES, type InputSize } from '@/components/atoms/zinc/input/Input';
import { cn } from '@/utils/function/utils';

/**
 * A search box: the field with a 14 px search glyph inside on the left and,
 * on the right, an optional hint (`<Kbd>⌘K</Kbd>`, a result count) that
 * steps aside while the field holds text. `type="search"` so Escape clears it
 * where the browser does that. Name it with `aria-label` (the placeholder is
 * not a name).
 */
export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: InputSize;
  /** Right-hand slot: a shortcut hint, a count. Hidden while there is text. */
  hint?: React.ReactNode;
  /** Classes of the wrapper (width, margins); `className` goes to the field. */
  wrapperClassName?: string;
}

const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ size = 'md', hint, wrapperClassName, className, value, defaultValue, onChange, ...rest }, ref) => {
    // Uncontrolled: remember whether the viewer typed, to tuck the hint away.
    const [typed, setTyped] = React.useState(() => String(defaultValue ?? '').length > 0);
    const hasText = value !== undefined ? String(value).length > 0 : typed;
    return (
      <div className={cn('group/search relative flex items-center', wrapperClassName)}>
        <Search
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-2.5 text-zinc-400 transition-colors duration-[120ms] group-focus-within/search:text-zinc-600 dark:text-zinc-500 dark:group-focus-within/search:text-zinc-300',
            size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5',
          )}
        />
        <input
          ref={ref}
          type="search"
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => {
            if (value === undefined) setTyped(event.target.value.length > 0);
            onChange?.(event);
          }}
          className={cn(
            FIELD,
            FIELD_FOCUS,
            INPUT_SIZES[size],
            size === 'sm' ? 'pl-7' : 'pl-8',
            hint ? 'pr-12' : null,
            '[&::-webkit-search-cancel-button]:hidden',
            className,
          )}
          {...rest}
        />
        {hint && !hasText ? (
          <span className="pointer-events-none absolute right-1.5 flex items-center gap-1 text-zinc-400">{hint}</span>
        ) : null}
      </div>
    );
  },
);

SearchField.displayName = 'SearchField';

export { SearchField };
export default SearchField;
