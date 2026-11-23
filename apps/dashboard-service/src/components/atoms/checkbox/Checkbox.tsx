import React from 'react';

interface CheckboxProps {
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

/*
  A 16 px box with a 4 px radius on a hairline, the accent when checked (the
  `text-` colour is what @tailwindcss/forms fills a checked box with), a ring
  for the keyboard only. The look is the same in every space: where the accent token is ink, so the box fills ink
  there, as the kit's checkbox does. `border-gray-300` and a `dark:border-`
  are what the dark-mode test reads. In dark the box is a faint well, and the
  checked fill is written again under `checked:`, otherwise the well paints
  over it (@tailwindcss/forms and a utility have the same specificity).
*/
const INPUT =
  'h-4 w-4 rounded-[4px] border-gray-300 text-secondary transition-colors duration-[120ms] focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-white/[0.2] dark:bg-white/[0.03] dark:checked:border-transparent dark:checked:bg-current dark:focus-visible:ring-offset-as-surface disabled:cursor-not-allowed disabled:opacity-60';

const LABEL = 'relative ml-2 block text-sm text-zinc-700 dark:text-zinc-300';

const DESCRIPTION = 'ml-2 text-sm text-zinc-500 dark:text-zinc-400';

/*
  The 44 px reach of a phone, drawn by the label's `::after` so a tap on it
  reaches the box. With a word, the reach is the label's width plus the box
  on its left (16 px and the 8 px gap). With an empty label (a row's box in a
  repository table) the label is 0 px wide, so the reach is a 44 px square
  centred on the box: 38 px to the left of the label's edge, where the box's
  centre is 16 px left of it (verify finding T4a-1).
*/
const REACH_WITH_WORD =
  "max-md:after:absolute max-md:after:-left-6 max-md:after:right-0 max-md:after:top-1/2 max-md:after:h-11 max-md:after:-translate-y-1/2 max-md:after:content-['']";
const REACH_BOX_ONLY =
  "max-md:after:absolute max-md:after:-left-[38px] max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-y-1/2 max-md:after:content-['']";

const Checkbox: React.FC<CheckboxProps> = ({
  id,
  name,
  value,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}) => {
  const inputId = id || `checkbox-${name}-${value}`;
  const labelElement = (
    <label
      htmlFor={inputId}
      className={`${LABEL} ${label ? REACH_WITH_WORD : REACH_BOX_ONLY}`}
    >
      {label}
    </label>
  );

  return (
    <div className={description ? 'flex items-start' : 'flex items-center'}>
      <input
        id={inputId}
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={description ? `${inputId}-description` : undefined}
        className={INPUT}
      />
      {description ? (
        <div className="flex flex-col">
          {labelElement}
          <p id={`${inputId}-description`} className={DESCRIPTION}>
            {description}
          </p>
        </div>
      ) : (
        labelElement
      )}
    </div>
  );
};

export default Checkbox;
