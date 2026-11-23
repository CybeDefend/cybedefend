import React from 'react';
import { cn } from '@/utils/function/utils';

type InputSize = 'sm' | 'md' | 'lg';

/**
 * Accepts and forwards anything a native input accepts — `name`, `autoComplete`,
 * `pattern`, `onBlur`… A closed prop list is why forms across the app went back
 * to raw `<input>` elements: the atom silently dropped whatever it had not
 * anticipated, so a form field could not even carry its own `name`.
 */
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  id?: string;
  label?: string;
  placeholder?: string;
  type?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string;
  required?: boolean;
  width?: string;
  readOnly?: boolean;
  maxLength?: number;
  textarea?: boolean;
  disabled?: boolean;
  ['aria-label']?: string;
  min?: number;
  max?: number;
  size?: InputSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
  /**
   * Textarea form only: the number of visible lines. When given, the field
   * drops its fixed height and the rows decide it.
   */
  rows?: number;
  /** Help text under the field, announced with it through aria-describedby. */
  hint?: React.ReactNode;
}

// One look in every space (the field atoms are not gated behind `appsec:`,
// so the common settings pages show no 46 px grey fields). A single-line field has a fixed height
// (32 / 36 / 40 px; 44 px and 16 px text on a phone so iOS does not zoom); a
// textarea never gets one, its rows or its own `h-32` decide. A caller's
// class wins over these through `cn` (the FilterBar toolbar's day field, the
// chat history search).
const INPUT_SIZE: Record<InputSize, string> = {
  sm: 'h-8 px-3 text-[13px] max-md:h-11 max-md:text-base',
  md: 'h-9 px-3 text-sm max-md:h-11 max-md:text-base',
  lg: 'h-10 px-3.5 text-sm max-md:h-11 max-md:text-base',
};
const TEXTAREA_SIZE: Record<InputSize, string> = {
  sm: 'px-3 py-2 text-[13px] leading-5 max-md:text-base',
  md: 'px-3 py-2 text-sm leading-5 max-md:text-base',
  lg: 'px-3.5 py-2.5 text-sm leading-6 max-md:text-base',
};

const Input: React.FC<InputProps> = ({
  id,
  label,
  placeholder,
  type = 'text',
  value = '',
  onChange,
  onKeyDown,
  error,
  required = false,
  width,
  readOnly = false,
  maxLength,
  textarea,
  disabled = false,
  'aria-label': ariaLabel,
  min,
  max,
  size = 'md',
  leftIcon,
  rightIcon,
  className,
  rows,
  hint,
  ...rest
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error);
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hasHint && hintId, hasError && errorId].filter(Boolean).join(' ') || undefined;

  const commonProps = {
    id: inputId,
    value: value,
    onChange: onChange,
    onKeyDown: onKeyDown,
    required: required,
    readOnly: readOnly,
    maxLength: maxLength,
    disabled: disabled,
    placeholder: placeholder,
    'aria-invalid': hasError,
    'aria-describedby': describedBy,
    'aria-label': ariaLabel || label,
    min: min,
    max: max,
    ...rest,
  };

  const inputClasses = cn(
    // Base: a hairline field, white on light, the raised layer in dark.
    'block w-full rounded-lg border transition-[border-color,box-shadow] duration-[120ms]',
    'bg-white text-zinc-900 placeholder:text-zinc-400',
    'dark:bg-as-raised dark:text-zinc-100 dark:placeholder:text-zinc-500',
    // Size variant (a textarea never takes a fixed height)
    textarea ? TEXTAREA_SIZE[size] : INPUT_SIZE[size],
    // Focus states — an editable field invites a click; a read-only one
    // must not, so it keeps neither the ring nor the hover border below.
    // The accent edge and a 3 px halo; in a space whose accent is ink, the token is ink.
    !readOnly && 'focus:outline-none focus:z-10 focus:ring-[3px] focus:ring-secondary/15 focus:border-secondary/60 dark:focus:ring-secondary/25 dark:focus:border-secondary-light/50',
    // Disabled state
    'disabled:opacity-50 disabled:pointer-events-none disabled:bg-zinc-50 dark:disabled:bg-white/[0.02]',
    // Read-only state. It used to differ from an editable field by a barely
    // perceptible grey; "you cannot change this" was only in the help text.
    readOnly && cn(
      'cursor-default select-all',
      'bg-zinc-50 dark:bg-white/[0.02]',
      'text-zinc-600 dark:text-zinc-400',
      'border-dashed',
    ),
    // Icon padding
    leftIcon && 'pl-9',
    (rightIcon || hasError) && 'pr-9',
    // Error/default border
    hasError
      ? 'border-red-500/70 focus:border-red-500 focus:ring-red-500/15 dark:border-red-400/60 dark:focus:ring-red-500/25'
      : cn(
          'border-zinc-200 dark:border-as-line-strong',
          !readOnly && 'hover:border-zinc-300 dark:hover:border-white/[0.2]',
        ),
    className
  );

  return (
    <div className={width}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[13px] font-medium mb-1.5 text-zinc-700 dark:text-zinc-300"
        >
          {label}
          {required && <span className="text-red-600 ml-0.5 dark:text-red-400">*</span>}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-400 dark:text-zinc-500 [&_svg]:h-4 [&_svg]:w-4">
            {leftIcon}
          </div>
        )}

        {textarea ? (
          // The rest props are typed for <input>; a textarea takes a narrower
          // set, so they are re-typed here rather than splitting the component.
          <textarea
            {...(commonProps as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={rows}
            className={cn(inputClasses, 'resize-none', rows === undefined && 'h-32')}
          />
        ) : (
          <input
            {...commonProps}
            type={type}
            className={inputClasses}
          />
        )}

        {rightIcon && !hasError && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-zinc-400 dark:text-zinc-500 [&_svg]:h-4 [&_svg]:w-4">
            {rightIcon}
          </div>
        )}

        {maxLength && (
          <div className={cn(
            'absolute bottom-1 text-xs tabular-nums',
            hasError ? 'right-10' : 'right-2',
            // The count is a word on the field, so meta ink (rule 7), not an icon grey.
            value.length >= maxLength
              ? 'text-red-600 dark:text-red-400'
              : 'text-zinc-500 dark:text-zinc-450'
          )}>
            {value.length}/{maxLength}
          </div>
        )}

        {hasError && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <svg
              className="w-4 h-4 text-red-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        )}
      </div>
      {hasHint && (
        <p id={hintId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      )}
      {hasError && (
        <p className="text-[13px] text-red-600 mt-1.5 flex items-center gap-1 dark:text-red-400" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
};

export default Input;
