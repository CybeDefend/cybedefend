

import React, { useState, KeyboardEvent, ChangeEvent } from "react";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { isValidIpOrCidr } from "../../../utils/function/utils";

interface TagInputProps {
  id?: string;
  label?: string;
  placeholder?: string;
  value?: string[];
  onChange?: (tags: string[]) => void;
  error?: string;
  required?: boolean;
  width?: string;
}

const TagInput: React.FC<TagInputProps> = ({
  id,
  label,
  placeholder,
  value = [],
  onChange,
  error,
  required = false,
  width = "w-full",
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [tags, setTags] = useState<string[]>(value);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && inputValue.trim() !== "") {
      e.preventDefault();
      const ip = inputValue.trim();

      if (isValidIpOrCidr(ip)) {
        if (!tags.includes(ip)) {
          const newTags = [...tags, ip];
          setTags(newTags);
          setInputValue("");
          if (onChange) {
            onChange(newTags);
          }
        } else {
          toast.error(t('components.appShell.ipDuplicate'));
        }
      } else {
        toast.error(t('components.appShell.ipInvalid'));
      }
    }
  };

  const handleRemoveTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    setTags(newTags);
    if (onChange) {
      onChange(newTags);
    }
  };

  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error);

  return (
    <div className={width}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium mb-2 dark:text-gray-400"
        >
          {label}
        </label>
      )}
      <div
        className={`flex flex-wrap items-center gap-2 py-2 px-3 border rounded-lg ${
          hasError ? "border-red-500" : "border-gray-200"
        } dark:bg-neutral-700 dark:border-neutral-600`}
      >
        {tags.map((tag, index) => (
          <div
            key={index}
            className="flex items-center space-x-2 bg-alternative text-black px-3 py-1 rounded-lg dark:bg-neutral-800 dark:text-gray-300"
          >
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => handleRemoveTag(index)}
              className="focus:outline-none"
            >
              &times;
            </button>
          </div>
        ))}
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          required={required}
          className="flex-grow py-2 px-3 bg-transparent border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:text-gray-300 dark:placeholder-neutral-400 dark:focus:ring-gray-400"
        />
      </div>
      {hasError && (
        <p className="text-sm text-red-600 mt-2" id={`${inputId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
};

export default TagInput;
