import React from 'react';

import { cn } from '@/utils/function/utils';
interface Option {
  label: string;
  value: string;
}

interface OptionGroupProps {
  name: string;
  selectedValues: string[];
  options: Option[];
  onChange: (selectedValues: string[]) => void;
  type: 'radio' | 'checkbox';
}

const OptionGroup: React.FC<OptionGroupProps> = ({ name, selectedValues, options, onChange, type }) => {
  React.useEffect(() => {
    if (type === 'radio' && selectedValues.length === 0 && options.length > 0) {
      onChange([options[0].value]);
    }
  }, [type, selectedValues, options, onChange]);

  const handleChange = (value: string) => {
    if (type === 'radio') {
      onChange([value]);
    } else {
      if (selectedValues.includes(value)) {
        if (selectedValues.length === 1) return;
        onChange(selectedValues.filter(v => v !== value));
      } else {
        onChange([...selectedValues, value]);
      }
    }
  };

  return (
    <div className="space-y-2.5">
      {options.map(option => {
        const inputId = `${name}-${option.value}`;
        const checked = selectedValues.includes(option.value);
        return (
          <div className="flex items-center" key={option.value}>
            <input
              id={inputId}
              name={name}
              type={type}
              value={option.value}
              checked={checked}
              onChange={() => handleChange(option.value)}
              className={cn("focus:ring-secondary h-4 w-4 text-secondary dark:text-secondary-light border-gray-300 dark:border-white/[0.2] dark:bg-as-raised", type === "checkbox" && "rounded-[4px]")}
            />
            <label htmlFor={inputId} className="ml-2 block text-sm text-zinc-700 dark:text-zinc-300">
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
};

export default OptionGroup;
