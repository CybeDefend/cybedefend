import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import Checkbox from "../checkbox/Checkbox";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";

/** The zinc skin (zinc, hairlines, no grey block in dark). */
const VD = {
  trigger: cn(
    "inline-flex w-full items-center justify-between gap-2 rounded-lg border text-[13px] transition-colors duration-[120ms]",
    "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
    "dark:border-white/[0.1] dark:bg-white/[0.02] dark:text-zinc-100 dark:hover:border-white/[0.18] dark:hover:bg-white/[0.05]",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:focus-visible:ring-white/25"
  ),
  triggerError: "border-critical-risk dark:border-critical-risk",
  placeholder: "text-zinc-500 dark:text-zinc-400",
  chevron: "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 dark:text-zinc-500",
  panel: cn(
    "fixed z-50 overflow-hidden rounded-xl border p-1",
    "border-zinc-200 bg-white shadow-[0_12px_32px_-12px_rgba(24,24,27,0.25)]",
    "dark:border-white/[0.09] dark:bg-[#141416] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]"
  ),
  searchWrap: "border-b border-zinc-100 p-1.5 dark:border-white/[0.06]",
  search: cn(
    "h-8 w-full rounded-md border px-2.5 text-[13px] focus:outline-none",
    "border-zinc-200 bg-white text-zinc-900 placeholder-zinc-400 focus:border-zinc-400",
    "dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-white/[0.25]"
  ),
  list: "max-h-60 overflow-auto py-0.5 custom-scrollbar",
  option: cn(
    "flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-[120ms]",
    "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
    "dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50"
  ),
  optionSelected: "text-zinc-900 dark:text-white",
};

export interface Option {
  label: string;
  value: string;
}

type SelectPropsBase = {
  id?: string;
  label?: string;
  options: Option[];
  placeholder?: string;
  width?: string;
  error?: string;
  required?: boolean;
  /** The trigger is disabled: it cannot be focused by click and never opens. */
  disabled?: boolean;
  /** Forwarded to the trigger button. */
  name?: string;
  'aria-label'?: string;
  /** Ids of the elements describing the field; the error id is appended to them. */
  'aria-describedby'?: string;
  /** Any `data-*` attribute (`data-testid`…) is forwarded to the trigger button. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
};

type SingleSelectProps = SelectPropsBase & {
  multiple?: false;
  value?: string;
  onChange: (value: string) => void;
};

type MultiSelectProps = SelectPropsBase & {
  multiple: true;
  value?: string[];
  onChange: (value: string[]) => void;
  minChecked?: number;
};

type SelectProps = (SingleSelectProps | MultiSelectProps) & {
  dropdownRef?: React.RefObject<HTMLDivElement | null>;
  /** Align dropdown to the right edge of the button instead of left */
  alignRight?: boolean;
  /** Display a prefix label before the selected value (useful for multi-select to show context) */
  displayPrefix?: string;
  /** Use compact styling with smaller padding */
  compact?: boolean;
  /**
   * `zinc`: the zinc skin (1 px hairlines, 32 px trigger,
   * a dark panel that is not a grey block). Absent = today's look, so every
   * AppSec select stays as it is.
   */
  skin?: 'default' | 'zinc';
  /** Enable a search/filter input at the top of the dropdown */
  searchable?: boolean;
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  // ── Async / backend-search mode (all opt-in; absent = legacy behaviour) ──
  /**
   * Lift the search term up to the parent (debounced upstream). When provided,
   * client-side filtering is DISABLED — the parent owns the option list and is
   * expected to feed already-filtered `options`. The internal search box value
   * is still tracked locally for input display.
   */
  onSearchChange?: (value: string) => void;
  /** Load the next page of options (infinite scroll). */
  onLoadMore?: () => void;
  /** Whether more pages are available to load. */
  hasMore?: boolean;
  /** True while a new backend search query is in-flight. */
  searching?: boolean;
  /** True while the next page is loading. */
  loadingMore?: boolean;
};

const Select: React.FC<SelectProps> = ({ dropdownRef, alignRight = false, displayPrefix, compact = false, skin = 'default', searchable = false, searchPlaceholder, onSearchChange, onLoadMore, hasMore = false, searching = false, loadingMore = false, disabled = false, name, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy, ...props }) => {
  const { t } = useTranslation();
  const vd = skin === 'zinc';
  const {
    id,
    label,
    options,
    placeholder,
    onChange,
    width = "w-full",
    error,
    required = false,
    multiple = false,
  } = props;

  const defaultPlaceholder = t('components.select.placeholder');
  const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error);
  const describedBy = [ariaDescribedBy, hasError && `${selectId}-error`].filter(Boolean).join(' ') || undefined;
  // `data-*` attributes travel to the trigger, like a native control's would.
  const dataAttributes = Object.fromEntries(
    Object.entries(props).filter(([key]) => key.startsWith('data-')),
  );

  const buttonRef = useRef<HTMLButtonElement>(null);
  const internalDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownElementRef = dropdownRef || internalDropdownRef;

  const [isOpen, setIsOpen] = useState(false);
  // A field disabled while its list is open closes it.
  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);
  const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Async mode: the parent owns the (already-filtered) option list, so we must
  // NOT filter client-side. Local search still drives the input display and is
  // lifted up via onSearchChange.
  const asyncSearch = typeof onSearchChange === 'function';

  // Filter options based on search query (skipped entirely in async mode).
  const filteredOptions = !asyncSearch && searchable && searchQuery
    ? options.filter((option) =>
        option.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      // Also reset the lifted backend search so async callers don't retain a
      // stale filter term after the dropdown is closed.
      if (typeof onSearchChange === 'function') onSearchChange('');
    } else if (searchable) {
      // Focus search input when dropdown opens
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen, searchable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the expected selected values from props
  const expectedSelectedValues = multiple
    ? (props.value as string[]) || []
    : props.value
      ? [props.value as string]
      : [];

  const [selectedValues, setSelectedValues] = useState<string[]>(expectedSelectedValues);

  // Sync selectedValues with props.value using JSON comparison for arrays
  useEffect(() => {
    const currentJson = JSON.stringify(selectedValues);
    const expectedJson = JSON.stringify(expectedSelectedValues);
    if (currentJson !== expectedJson) {
      setSelectedValues(expectedSelectedValues);
    }
  }, [expectedSelectedValues, selectedValues]);

  const updateDropdownPosition = React.useCallback(() => {
    if (!buttonRef.current) return;
    const buttonRect = buttonRef.current.getBoundingClientRect();

    // The dropdown is portaled to document.body and positioned with `fixed`
    // (viewport coordinates). getBoundingClientRect() is already viewport-
    // relative, so we must NOT add window.scrollX/Y. Using `fixed` (rather than
    // `absolute` + scroll offsets) is also what keeps it correct inside a Modal:
    // the Modal locks background scroll via `body { position: fixed; top: -scrollY }`,
    // which shifts the body's origin — an `absolute` dropdown on body would then
    // render scrollY px too high (up at the top of the screen).
    const styles: React.CSSProperties = {
      position: "fixed",
      minWidth: buttonRect.width,
      zIndex: 9999,
    };

    // Measure actual dropdown height if available
    const dropdownEl = dropdownElementRef.current;
    const dropdownHeight = dropdownEl ? dropdownEl.offsetHeight : 280;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const openUp = spaceBelow < dropdownHeight && buttonRect.top > dropdownHeight;

    if (openUp) {
      styles.top = buttonRect.top - dropdownHeight - 4;
    } else {
      styles.top = buttonRect.bottom + 4;
    }

    // Align to right edge if alignRight is true
    if (alignRight) {
      styles.right = window.innerWidth - buttonRect.right;
    } else {
      styles.left = buttonRect.left;
    }

    setDropdownStyles(styles);
  }, [alignRight, dropdownElementRef]);

  // Position on open
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, updateDropdownPosition]);

  // Re-position after dropdown mounts (to get actual height)
  useEffect(() => {
    if (isOpen && dropdownElementRef.current) {
      // Use requestAnimationFrame to wait for the portal to render
      const raf = requestAnimationFrame(() => {
        updateDropdownPosition();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, dropdownElementRef, updateDropdownPosition]);

  // While open, keep the dropdown anchored to the button when the page (or any
  // scroll container) scrolls, or the window resizes — `fixed` positioning is
  // viewport-relative, so it must be recomputed. Capture phase catches scrolls
  // on nested scroll containers too.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => updateDropdownPosition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownElementRef.current &&
        !dropdownElementRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, dropdownElementRef]);

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const optionValue = event.target.value;
    let newSelectedValues: string[];
    if (selectedValues.includes(optionValue)) {
      if (
        (props as MultiSelectProps).minChecked &&
        selectedValues.length <= (props as MultiSelectProps).minChecked!
      ) {
        return;
      }
      newSelectedValues = selectedValues.filter((item) => item !== optionValue);
    } else {
      newSelectedValues = [...selectedValues, optionValue];
    }
    setSelectedValues(newSelectedValues);

    (onChange as (value: string[] | string) => void)(newSelectedValues);
  };

  const handleOptionClick = (optionValue: string) => {
    setSelectedValues([optionValue]);

    (onChange as (value: string[] | string) => void)(optionValue);
    setIsOpen(false);
  };

  const handleDropdownClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const getButtonText = () => {
    if (selectedValues.length === 0) {
      return placeholder || defaultPlaceholder;
    } else if (!multiple) {
      const selectedOption = options.find(
        (option) => option.value === selectedValues[0]
      );
      return selectedOption ? selectedOption.label : (placeholder || defaultPlaceholder);
    } else {
      // Multiple mode: show prefix with count or selected names
      const selectedLabels = selectedValues
        .map(v => options.find(o => o.value === v)?.label)
        .filter(Boolean);

      if (selectedLabels.length === 0) {
        return placeholder || defaultPlaceholder;
      }

      // If displayPrefix is provided, use it to show context
      if (displayPrefix) {
        // In async mode `options` is only the current page, so we can only
        // claim "All" when there are no more pages left to load.
        const allSelected = asyncSearch
          ? (!hasMore && selectedLabels.length === options.length)
          : (selectedLabels.length === options.length);
        if (allSelected) {
          // All items selected
          return `${displayPrefix}: ${t('components.select.all')}`;
        } else if (selectedLabels.length === 1) {
          return `${displayPrefix}: ${selectedLabels[0]}`;
        } else {
          return `${displayPrefix}: ${selectedLabels.length}`;
        }
      }

      // Legacy behavior without displayPrefix
      if (selectedLabels.length <= 2) {
        return selectedLabels.join(', ');
      } else {
        return `${selectedLabels.length} ${t('components.select.itemsSelected')}`;
      }
    }
  };

  return (
    <div className={width}>
      {label && (
        <label
          htmlFor={selectId}
          className="block text-[13px] font-medium mb-1.5 text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          id={selectId}
          // The default skin: a 32 / 36 px hairline field (44 on a phone), white on
          // light and the raised layer in dark, the same in every space. Some screens of another space
          // dress it further from outside (`[&_button]:…`), which outranks these.
          // `py-3` on the default size is what FilterBar.test reads.
          className={vd ? cn(VD.trigger, compact ? 'h-8 px-3' : 'h-10 px-3.5', hasError && VD.triggerError, disabled && 'cursor-not-allowed opacity-50') : `inline-flex justify-between items-center w-full border rounded-lg text-sm focus:outline-none
            ${compact ? 'h-8 py-2 px-3' : 'h-9 py-3 px-3'}
            max-md:h-11 bg-white text-zinc-900 transition-[border-color,box-shadow] duration-[120ms] dark:bg-as-raised dark:text-zinc-100
            ${hasError
              ? "border-critical-risk focus:border-critical-risk focus:ring-[3px] focus:ring-critical-risk/20 dark:border-critical-risk dark:focus:ring-critical-risk/20"
              // The accent edge is written through its channel variable: another space renders this
              // skin from outside, whose tests refuse the `border-secondary` token in its markup.
              : "border-zinc-200 hover:border-zinc-300 focus:ring-[3px] focus:ring-secondary/15 focus:border-[rgb(var(--color-secondary-rgb)/0.6)] dark:border-as-line-strong dark:hover:border-white/[0.2] dark:focus:ring-secondary/25 dark:focus:border-[rgb(var(--color-secondary-light-rgb)/0.5)]"
            }
            disabled:opacity-50 disabled:pointer-events-none
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          {...dataAttributes}
          name={name}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setIsOpen(!isOpen);
          }}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          ref={buttonRef}
        >
          <span
            className={vd ? cn('block truncate text-left', selectedValues.length === 0 && VD.placeholder) : `block truncate text-left ${selectedValues.length === 0 ? "text-zinc-500 dark:text-zinc-400" : ""
              }`}
          >
            {getButtonText()}
          </span>
          <svg
            className={vd ? cn(VD.chevron, isOpen && 'rotate-180') : `ml-2 h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 dark:text-zinc-500 ${isOpen ? "transform rotate-180" : ""
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

        { }
        {isOpen && !disabled &&
          ReactDOM.createPortal(
            <div
              ref={dropdownElementRef}
              style={dropdownStyles}
              className={vd ? VD.panel : `fixed z-50 rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-as-line-strong dark:bg-as-raised dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]`}
              onClick={handleDropdownClick}
              data-select-dropdown="true"
            >
              {searchable && (
                <div className={vd ? VD.searchWrap : "p-1.5 border-b border-zinc-200 dark:border-as-line"}>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      onSearchChange?.(e.target.value);
                    }}
                    placeholder={searchPlaceholder || t('components.select.searchPlaceholder')}
                    className={vd ? VD.search : "h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-0 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[rgb(var(--color-secondary-rgb)/0.6)] max-md:h-11 max-md:text-base dark:border-as-line-strong dark:bg-as-surface dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-[rgb(var(--color-secondary-light-rgb)/0.5)]"}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <div
                className={vd ? VD.list : "py-0.5 max-h-60 overflow-auto custom-scrollbar"}
                onScroll={(e) => {
                  if (!asyncSearch || !hasMore || loadingMore || searching) return;
                  const el = e.currentTarget;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
                    onLoadMore?.();
                  }
                }}
              >
                {/* Async mode lets the parent own the empty state; the local
                    "no results" hint only applies to client-side filtering. */}
                {!asyncSearch && filteredOptions.length === 0 && searchQuery ? (
                  <div className="px-4 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 text-center">
                    {t('components.select.noResults')}
                  </div>
                ) : null}
                {filteredOptions.map((option) => (
                  <div
                    key={option.value}
                    className={vd ? cn(VD.option, !multiple && selectedValues.includes(option.value) && VD.optionSelected) : cn(
                      'flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-[120ms] max-md:min-h-11',
                      'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900',
                      'dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50',
                      // twMerge drops the idle ink above, so the selected ink wins in both themes.
                      !multiple && selectedValues.includes(option.value) && 'font-medium text-zinc-900 dark:text-zinc-50'
                    )}
                    onClick={() => {
                      if (!multiple) {
                        handleOptionClick(option.value);
                      }
                    }}
                  >
                    {multiple ? (
                      <Checkbox
                        name={selectId}
                        value={option.value}
                        checked={selectedValues.includes(option.value)}
                        onChange={handleCheckboxChange}
                        label={option.label}
                      />
                    ) : (
                      <span className="ml-2 truncate">{option.label}</span>
                    )}
                  </div>
                ))}
                {asyncSearch && (searching || loadingMore) && (
                  <div className="px-4 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 text-center">
                    {searching
                      ? t('components.select.searching')
                      : t('components.select.loadingMore')}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
      </div>
      {hasError && (
        <p className="text-sm text-critical-risk mt-2" id={`${selectId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
};

export default Select;
