import React, { useId } from 'react';
import { cn } from '@/utils/function/utils';

export interface SliderProps {
  id?: string;
  /** The visible label; it names the slider for assistive tech. */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** What the value reads, shown and announced (`26+`); the number itself otherwise. */
  valueLabel?: string;
  /** A line under the track (its legend), announced as the slider's description. */
  description?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * A native range input: the browser gives it the
 * `slider` role, its bounds and its value to assistive tech; the label and
 * the value are visible next to it. The arrow keys, Home and End step it
 * here rather than in the browser, so every engine moves it the same way and
 * the value always goes through `onChange` as a number within the bounds.
 */
const Slider: React.FC<SliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  valueLabel,
  description,
  disabled = false,
  className,
  labelClassName,
  valueClassName,
}) => {
  const generated = useId();
  const inputId = id ?? `slider-${generated}`;
  const descriptionId = description ? `${inputId}-description` : undefined;

  const move = (next: number) => {
    const bounded = clamp(next, min, max);
    if (bounded !== value) onChange(bounded);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      Home: min,
      End: max,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={inputId} className={cn('text-sm font-medium text-zinc-900 dark:text-zinc-100', labelClassName)}>
        {label}
      </label>
      <output
        htmlFor={inputId}
        data-testid="slider-value"
        className={cn('tabular-nums text-zinc-900 dark:text-zinc-50', valueClassName)}
      >
        {valueLabel ?? value}
      </output>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueLabel}
        aria-describedby={descriptionId}
        onChange={(event) => move(Number(event.target.value))}
        onKeyDown={onKeyDown}
        className={cn(
          'h-2 w-full cursor-pointer rounded-full accent-secondary',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-as-surface',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // 44 px of reach on a phone, the track keeps its look.
          'max-md:h-11',
        )}
      />
      {description && (
        <p id={descriptionId} className="text-[13px] text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
    </div>
  );
};

export default Slider;
