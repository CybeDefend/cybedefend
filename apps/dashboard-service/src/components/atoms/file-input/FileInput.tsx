import React from "react";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

interface FileInputProps {
  label?: string;
  accept?: string;
  onChange: (file: File | null) => void;
  error?: string;
  className?: string;
  /**
   * True (the default) refuses anything but a `.zip` with a toast. False hands
   * any picked file to `onChange`, for a caller that checks the file itself
   * (the SARIF import dialog).
   */
  zipOnly?: boolean;
  /** The control's id, which its label points at. */
  id?: string;
}

const FileInput: React.FC<FileInputProps> = ({
  label,
  accept,
  onChange,
  error,
  className,
  zipOnly = true,
  id = "file-input",
}) => {
  const { t } = useTranslation();
  
  return (
    <div className={`max-w-sm ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-black dark:text-gray-300 mb-1"
        >
          {label}
        </label>
      )}
      <input
        type="file"
        accept={accept}
        id={id}
        onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          if (file && !zipOnly) {
            onChange(file);
          } else if (file) {
            
            if (file.type === "application/zip" || file.name.endsWith(".zip")) {
              onChange(file);
            } else {
              onChange(null);
              toast.error(t('components.fileInput.error.zipOnly'));
            }
          } else {
            onChange(null);
          }
        }}
        // Dark theme: the surface, text and border of the Input atom, so the control sits with
        // the fields around it, and light text on the grey of its native button, which was
        // grey on grey. The light theme is unchanged.
        className="block w-full border border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 focus:border-secondary focus:ring-secondary disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-gray-100 file:bg-neutral-50 file:border-0 file:mr-4 file:py-3 file:px-4 dark:file:bg-neutral-700 dark:file:text-gray-100"
      />
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};

export default FileInput;
