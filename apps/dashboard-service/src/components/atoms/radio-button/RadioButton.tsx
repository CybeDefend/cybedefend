

import React from 'react';

interface RadioButtonProps {
  id?: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  /** A line under the label, announced as the input's accessible description. */
  description?: string;
  disabled?: boolean;
}

const RadioButton: React.FC<RadioButtonProps> = ({
  id,
  name,
  value,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}) => {
  const inputId = id || `radio-${name}-${value}`;

  return (
    <div className={description ? "flex items-start" : "flex items-center"}>
      <input
        id={inputId}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={description ? `${inputId}-description` : undefined}
        className="focus:ring-secondary h-4 w-4 text-secondary border-gray-300 dark:border-neutral-600 dark:bg-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <div className="ml-2 flex flex-col">
        <label htmlFor={inputId} className="block text-sm text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {description && (
          <p id={`${inputId}-description`} className="text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>
    </div>
  );
};

export default RadioButton;
