import React from 'react';

interface ToggleProps {
  id?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/*
 * A 32 × 18 switch, the kit's size, in every space (the field atoms take the
 * same look everywhere). The
 * track is zinc at rest and the accent when on — full strength in dark too,
 * 3.67:1 on the surface as a graphic; where the accent token is ink, the
 * switch turns ink, as the kit's does. A phone reaches it
 * through a 44 px square, the knob is lit by a hairline shadow, and the ring
 * shows for the keyboard only.
 */
const TRACK =
  'w-8 h-[18px] rounded-full bg-zinc-300 transition-colors duration-[160ms] ease-out peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-secondary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white peer-checked:bg-secondary dark:bg-white/[0.16] dark:peer-checked:bg-secondary dark:peer-focus-visible:ring-offset-as-surface';

const KNOB =
  'absolute left-0.5 top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.15)] transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] transform';

/** `AS_TOUCH_SQUARE` (atoms/appsec/styles), as a literal: this file imports nothing. */
const TOUCH =
  "max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']";

const Toggle: React.FC<ToggleProps> = ({ id, enabled, onChange }) => {
  const toggleId = id || `toggle-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <label htmlFor={toggleId} className={`relative inline-flex items-center cursor-pointer ${TOUCH}`}>
      {}
      <input
        type="checkbox"
        id={toggleId}
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      {}
      <div className={TRACK}>
        {}
        <span
          className={`${KNOB} ${
            enabled ? 'translate-x-3.5' : 'translate-x-0'
          }`}
        ></span>
      </div>
    </label>
  );
};

export default Toggle;
