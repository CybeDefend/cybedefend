import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS_RAIL, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

interface ThemeToggleButtonProps {
  isDarkMode: boolean;
  onToggle: () => void;
  /**
   * The button's accessible name, translated by the caller ("Switch to the
   * light theme"). Without it the button keeps the French names it always had.
   */
  ariaLabel?: string;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  isDarkMode,
  onToggle,
  ariaLabel,
}) => {
  // Both glyphs take the button's zinc: no accent on a theme toggle.
  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-white/[0.04] hover:text-zinc-100',
        AS_FOCUS_RAIL,
        AS_TOUCH_SQUARE
      )}
      aria-label={ariaLabel ?? (isDarkMode ? 'Activer le mode clair' : 'Activer le mode sombre')}
    >
      <div>
        <div className={`transform transition-transform duration-500 ${isDarkMode ? 'rotate-0' : '-rotate-90'}`}>
          {isDarkMode ? (
            <svg 
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
};

export default ThemeToggleButton;