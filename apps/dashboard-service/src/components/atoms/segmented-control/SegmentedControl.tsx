import React from 'react';
import { cn } from '@/utils/function/utils';

export type SegmentedTone = 'default' | 'neutral' | 'critical' | 'high' | 'medium' | 'low' | 'success' | 'warning';
export type SegmentedSize = 'sm' | 'md';

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Fill of the option while it is selected. */
  tone?: SegmentedTone;
  disabled?: boolean;
  /** Overrides the `${testIdPrefix}-${value}` test id. */
  testId?: string;
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Names the group for assistive tech: the segments alone do not say what they choose. */
  ariaLabel: string;
  size?: SegmentedSize;
  /** Disables every segment. */
  disabled?: boolean;
  testIdPrefix?: string;
  className?: string;
}

/**
 * Active fills. The risk tokens and amber are light colours: white on them
 * falls under AA, so their label is dark.
 */
const activeToneClasses: Record<SegmentedTone, string> = {
  default: 'bg-secondary text-white',
  // « Off », « Disabled »: a choice that turns something off must not look
  // like the accent's active choice.
  neutral: 'bg-gray-500 text-white dark:bg-neutral-600',
  critical: 'bg-critical-risk text-gray-900',
  high: 'bg-high-risk text-gray-900',
  medium: 'bg-medium-risk text-gray-900',
  low: 'bg-low-risk text-gray-900',
  success: 'bg-green-600 text-white',
  warning: 'bg-amber-500 text-gray-900',
};

const sizeClasses: Record<SegmentedSize, string> = {
  // 40 px tall below `sm`, a finger's reach; 26 px from `sm` up, as it was.
  sm: 'px-2.5 py-3 sm:py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
};

/**
 * A row of mutually exclusive options: a filter (All / Critical / High…) or a
 * small state switch (Deny / Warn / Off). One option is always selected.
 *
 * Rendered as a labelled `role="group"` of toggle buttons, each carrying
 * `aria-pressed`, which is how the local copies it replaces were announced.
 */
function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  disabled = false,
  testIdPrefix,
  className,
}: SegmentedControlProps<V>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex overflow-hidden rounded-md border border-gray-200 dark:border-neutral-700',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const isDisabled = disabled || !!option.disabled;
        const testId = option.testId ?? (testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined);

        return (
          <button
            key={option.value}
            type="button"
            data-testid={testId}
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary/50',
              'disabled:cursor-not-allowed',
              sizeClasses[size],
              isActive
                ? cn(activeToneClasses[option.tone ?? 'default'], 'shadow-sm')
                : cn(
                    'bg-white text-gray-600 dark:bg-neutral-800 dark:text-gray-300',
                    'hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-neutral-700 dark:hover:text-white',
                    'disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-600',
                    'dark:disabled:hover:bg-neutral-800 dark:disabled:hover:text-gray-300',
                  ),
            )}
          >
            {option.icon && <span className="shrink-0">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export default SegmentedControl;
