import React from 'react';
import Button from '@/components/atoms/button/Button';
import { cn } from '@/utils/function/utils';

export interface FilterChipOption {
  value: string;
  label: string;
  /** Former colour dot (a severity swatch): no dot is drawn any more; kept so no caller breaks. */
  dotClassName?: string;
  /** The colour the label is written in, where the dot used to carry it (a severity word in its colour). */
  toneClassName?: string;
}

interface FilterChipGroupProps {
  /** Heading above the row of chips. */
  label: string;
  options: FilterChipOption[];
  /** Currently selected values. */
  selected?: string[];
  onToggle: (value: string) => void;
  className?: string;
}

/**
 * A labelled row of toggleable filter chips.
 *
 * Every filter panel in the app used to hand-roll this: the same twelve
 * Tailwind classes, the same selected/unselected ternary, copied once per
 * facet. Copies drift — one gets a focus ring, another does not — and none of
 * them announced their state to a screen reader. Here the chip is a `Button`,
 * so it inherits focus, disabled and dark-mode handling, and `aria-pressed`
 * makes the toggle audible.
 *
 * A selected chip is a quiet state: an ink word on a zinc
 * wash with an ink hairline, never the solid violet of a primary action.
 */
const FilterChipGroup: React.FC<FilterChipGroupProps> = ({
  label,
  options,
  selected,
  onToggle,
  className,
}) => (
  <div className={className}>
    <p className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">{label}</p>
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected?.includes(option.value) ?? false;
        return (
          <Button
            key={option.value}
            size="xs"
            variant="white"
            onClick={() => onToggle(option.value)}
            aria-pressed={isSelected}
            className={cn(
              '!rounded-md',
              isSelected &&
                'border-zinc-900 bg-zinc-100 text-zinc-900 hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-300 dark:bg-white/[0.08] dark:text-zinc-50 dark:hover:border-zinc-300 dark:hover:bg-white/[0.08]',
            )}
          >
            <span className={option.toneClassName}>{option.label}</span>
          </Button>
        );
      })}
    </div>
  </div>
);

export default FilterChipGroup;
