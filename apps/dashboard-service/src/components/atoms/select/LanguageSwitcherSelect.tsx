import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactDOM from 'react-dom';
import { AS_FLOATING, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';

// Plain joins, no `cn`: `@/utils/function/utils` loads `@/i18n`, which the
// tests that mock react-i18next without `initReactI18next` cannot load.
const TRIGGER = [
  'relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-700 transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-200 dark:hover:bg-white/[0.09]',
  AS_FOCUS,
  AS_TOUCH,
].join(' ');

/** The ISO code chip, on the trigger and on each row of the menu. */
const ISO_CHIP =
  'rounded bg-zinc-100 px-1 py-px font-mono text-[11px] font-medium text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300';

/**
 * A row of the menu: the metrics of `AS_MENU_ITEM` (13 px, a zinc tint when
 * hovered), but two lines tall (name, native name), so its height comes from
 * them (44 px) rather than the menu's fixed 32.
 */
const LANGUAGE_ROW =
  'relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-zinc-700 transition-colors duration-[80ms] hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:bg-zinc-100 max-md:min-h-11 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50 dark:focus-visible:bg-white/[0.06]';

/**
 * A language option
 */
interface LanguageOption {
  value: string;
  label: string;
  /**
   * ISO code shown in place of a flag. A flag names a country, not a
   * language: 🇬🇧 on "English" reads as British English to an American user,
   * and adding 🇺🇸 beside it would imply two variants that do not exist.
   * Stripe, Linear and GitHub all drop the flag for the same reason.
   */
  code: string;
  nativeName: string;
  translationKey: string;
}

/**
 * Language picker, styled like the Select component
 */
const LanguageSwitcherSelect: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
  const searchInputId = "language-search-input";

  // Available languages
  const languages: LanguageOption[] = [
    { value: 'fr', label: 'Français', code: 'FR', nativeName: 'Français', translationKey: 'language.french' },
    { value: 'en', label: 'English', code: 'EN', nativeName: 'English', translationKey: 'language.english' }
  ];

  // Langue actuelle
  const currentLanguage = i18n.language;
  const selectedLanguage = languages.find(lang => lang.value === currentLanguage) || languages[0];

  // Change the language and save the choice in localStorage
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
    setIsOpen(false);
    setSearchTerm('');
  };

  // Compute and update the dropdown position
  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();

      const styles: React.CSSProperties = {
        position: 'fixed', // Changed to fixed to avoid scroll issues
        top: `${buttonRect.bottom}px`, // No need for window.scrollY with fixed positioning
        left: `${buttonRect.right - 220}px`, // Align the right edges
        width: '220px', // Fixed width instead of minWidth
        zIndex: 9999,
        marginTop: '4px'
      };

      setDropdownStyles(styles);
    }
  };

  // Focus the search field without scrolling
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Delay the focus with setTimeout to avoid the automatic scroll
      setTimeout(() => {
        const scrollPosition = window.scrollY;
        inputRef.current?.focus();
        // Restore the scroll position
        window.scrollTo(0, scrollPosition);
      }, 50);
    }
  }, [isOpen]);

  // Update the dropdown position while it is open
  useEffect(() => {
    if (isOpen) {
      // Save the current scroll position
      const scrollPosition = window.scrollY;

      // Update position immediately
      updateDropdownPosition();

      // Add a small delay to ensure the DOM has fully rendered
      const timer = setTimeout(() => {
        updateDropdownPosition();
        // Restore the scroll position
        window.scrollTo(0, scrollPosition);
      }, 0);

      // Add resize listener to keep position correct on window resize
      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition);

      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', updateDropdownPosition);
        window.removeEventListener('scroll', updateDropdownPosition);
      };
    }
  }, [isOpen]);

  // Close the dropdown on a click outside it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter the languages by the search
  const filteredLanguages = languages.filter(lang =>
    t(lang.translationKey).toLowerCase().includes(searchTerm.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Stop a click on the dropdown from propagating
  const handleDropdownClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  // Open or close the dropdown
  const handleToggleDropdown = (event: React.MouseEvent) => {
    // Prevent the default behaviour to avoid any scroll
    event.preventDefault();

    // Keep the current scroll position
    const scrollPosition = window.scrollY;

    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchTerm('');
    }

    // Make sure the scroll position stays the same
    window.scrollTo(0, scrollPosition);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={TRIGGER}
        onClick={handleToggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="flex items-center">
          <span className={`mr-1.5 ${ISO_CHIP}`}>
            {selectedLanguage.code}
          </span>
          <span className="hidden sm:inline">{t(selectedLanguage.translationKey)}</span>
        </span>
        <svg
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''
            }`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyles}
          className={`${AS_FLOATING} p-1 overflow-hidden`}
          onClick={handleDropdownClick}
        >
          <div className="p-1.5 border-b border-zinc-200 dark:border-as-line">
            <input
              ref={inputRef}
              id={searchInputId}
              name="language-search"
              type="text"
              placeholder={t('language.searchLanguage')}
              className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 max-md:h-11 max-md:text-base focus:outline-none focus:ring-0 focus:border-secondary/60 dark:border-as-line-strong dark:bg-as-surface dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-secondary-light/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="max-h-60 overflow-auto custom-scrollbar py-0.5">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => (
                <div
                  key={lang.value}
                  className={`${LANGUAGE_ROW} ${currentLanguage === lang.value ? 'bg-zinc-100 dark:bg-white/[0.06]' : ''}`}
                  onClick={() => changeLanguage(lang.value)}
                >
                  <span className={`mr-1 ${ISO_CHIP}`}>
                    {lang.code}
                  </span>
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{t(lang.translationKey)}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{lang.nativeName}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-2 py-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                {t('language.noLanguagesFound')}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default LanguageSwitcherSelect; 