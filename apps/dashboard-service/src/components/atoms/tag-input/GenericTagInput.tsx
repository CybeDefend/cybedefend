// ============================================================================
// GenericTagInput - A reusable tag input component
// ============================================================================

import React, { useState, KeyboardEvent, ChangeEvent } from 'react';

import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
import { Times } from '@/components/atoms/icon/icons';

interface GenericTagInputProps {
  id?: string;
  label?: string;
  placeholder?: string;
  value?: string[];
  onChange?: (tags: string[]) => void;
  error?: string;
  required?: boolean;
  width?: string;
  validator?: (value: string) => boolean;
  validationMessage?: string;
  formatValue?: (value: string) => string;
}

const GenericTagInput: React.FC<GenericTagInputProps> = ({
  id,
  label,
  placeholder = 'Press Enter to add...',
  value = [],
  onChange,
  error,
  required = false,
  width = 'w-full',
  validator,
  validationMessage = 'Invalid value',
  formatValue,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setLocalError(null);
  };

  const addTag = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Apply formatting if provided
    const formatted = formatValue ? formatValue(trimmed) : trimmed;

    // Validate if validator is provided
    if (validator && !validator(formatted)) {
      setLocalError(validationMessage);
      return;
    }

    // Check for duplicates
    if (value.includes(formatted)) {
      setLocalError('This value is already added');
      return;
    }

    const newTags = [...value, formatted];
    setInputValue('');
    setLocalError(null);
    if (onChange) {
      onChange(newTags);
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && inputValue.trim() !== '') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      // Remove last tag on backspace if input is empty
      const newTags = value.slice(0, -1);
      if (onChange) {
        onChange(newTags);
      }
    }
  };

  const handleRemoveTag = (index: number) => {
    const newTags = value.filter((_, i) => i !== index);
    if (onChange) {
      onChange(newTags);
    }
  };

  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error) || Boolean(localError);

  return (
    <div className={width}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[13px] font-medium mb-1.5 text-zinc-700 dark:text-zinc-300"
        >
          {label}
          {required && <span className="text-red-600 dark:text-red-400 ml-0.5">*</span>}
        </label>
      )}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 min-h-9 max-md:min-h-11 py-1 px-2 rounded-lg border transition-[border-color,box-shadow] duration-[120ms]',
          hasError
            ? 'border-red-500 dark:border-red-500'
            : 'border-zinc-200 dark:border-as-line-strong focus-within:border-secondary/60 focus-within:ring-[3px] focus-within:ring-secondary/15 dark:focus-within:ring-secondary/25',
          'bg-white dark:bg-as-raised'
        )}
      >
        {value.map((tag, index) => (
          <div
            key={index}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium',
              'bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light'
            )}
          >
            <span className="font-medium">{tag}</span>
            <button
              type="button"
              onClick={() => handleRemoveTag(index)}
              className={cn('relative inline-flex h-4 w-4 items-center justify-center rounded-sm transition-colors duration-[120ms] hover:bg-secondary/15', AS_FOCUS, AS_TOUCH_SQUARE)}
            >
              <Times className="h-3 w-3"  />
            </button>
          </div>
        ))}
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onBlur={() => {
            if (inputValue.trim()) {
              addTag();
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          required={required && value.length === 0}
          className={cn(
            // No border, side padding nor ring of its own (the forms plugin gives every text field one): the box around it is the field.
            'flex-1 min-w-[120px] border-0 px-0 py-0.5 bg-transparent text-sm max-md:text-base focus:outline-none focus:ring-0',
            'text-zinc-900 dark:text-zinc-100',
            'placeholder:text-zinc-400 dark:placeholder:text-zinc-500'
          )}
        />
      </div>
      {(error || localError) && (
        <p className="text-[13px] text-red-600 dark:text-red-400 mt-1.5" id={`${inputId}-error`}>
          {error || localError}
        </p>
      )}
    </div>
  );
};

export default GenericTagInput;
