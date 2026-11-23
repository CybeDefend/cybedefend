// Fichier : SearchBox.tsx

import React, { useState, useEffect } from "react";

import { ProfileOrganization } from "../../../server/interfaces/Organization";
import { Search } from '@/components/atoms/icon/icons';

interface SearchBoxProps {
  initialValue?: string; // Optional initial value
  onSearch: (query: string) => void;
  withDropdown?: boolean;
  organizations?: ProfileOrganization[];
  onSelect?: (organization: ProfileOrganization) => void;
  placeholder?: string;
}

/*
  A 32 px search field (44 px and 16 px text on a phone), the same in every
  space: it matches the 32 px buttons and the
  compact selects of every toolbar it sits in, and the kit's `SearchField`.
*/
const FIELD =
  "block w-full h-8 rounded-lg border border-zinc-200 bg-white py-0 pl-8 pr-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 transition-[border-color,box-shadow] duration-[120ms] hover:border-zinc-300 focus:outline-none focus:border-secondary/60 focus:ring-[3px] focus:ring-secondary/15 max-md:h-11 max-md:text-base dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/[0.2] dark:focus:border-secondary-light/50 dark:focus:ring-secondary/25";

const DROPDOWN =
  "absolute w-full mt-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-as-line-strong dark:bg-as-raised dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]";

const ITEM =
  "flex items-center cursor-pointer h-8 w-full rounded-md px-2 text-[13px] text-zinc-700 transition-colors duration-[80ms] hover:bg-zinc-100 hover:text-zinc-900 max-md:h-11 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50";

const SearchBox: React.FC<SearchBoxProps> = ({
  initialValue, // Optional initial value
  onSearch,
  withDropdown = false,
  organizations = [],
  onSelect,
  placeholder = "Search...",
}) => {
  // Start from initialValue, else an empty string.
  const [value, setValue] = useState(initialValue || "");

  const [isOpen, setIsOpen] = useState(false);
  const [filteredOrganizations, setFilteredOrganizations] = useState<
    ProfileOrganization[]
  >([]);

  // Update the internal state when initialValue changes
  useEffect(() => {
    setValue(initialValue || "");
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    onSearch(newValue);

    if (withDropdown) {
      setIsOpen(true);
    }
  };

  const handleFocus = () => {
    if (withDropdown) {
      setIsOpen(true);
    }
  };

  useEffect(() => {
    if (withDropdown && organizations) {
      setFilteredOrganizations(
        organizations.filter((org) =>
          org.name.toLowerCase().includes(value.toLowerCase())
        )
      );
    }
  }, [value, organizations, withDropdown]);

  const handleSelect = (organization: ProfileOrganization) => {
    setValue(organization.name);
    onSearch(organization.name); // Notify the parent too.
    if (onSelect) {
      onSelect(organization);
    }
    setIsOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 100);
  };

  return (
    <div className="relative w-full max-w-sm">
      { }
      <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none pl-2.5 text-zinc-400 dark:text-zinc-500">
        <Search className="h-3.5 w-3.5"  />
      </div>
      <input
        className={FIELD}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {withDropdown && isOpen && (
        <div className={DROPDOWN}>
          <div className="max-h-72 overflow-y-auto custom-scrollbar">
            {filteredOrganizations.map((organization) => (
              <div
                key={organization.id}
                className={ITEM}
                onClick={() => handleSelect(organization)}
              >
                {organization.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchBox;
