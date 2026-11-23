import React from 'react';
import { ChevronDown, ChevronUp } from '@/components/atoms/icon/icons';

interface AccordionButtonProps {
  name: string;
  icon: any;
  isExpanded: boolean;
  onToggle: () => void;
}

export const AccordionButton: React.FC<AccordionButtonProps> = ({ name, icon, isExpanded, onToggle }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-start flex items-center gap-x-3.5 py-2 px-2.5 text-sm rounded-lg hover:bg-hover-dark focus:outline-none focus:bg-hover-dark"
      aria-expanded={isExpanded}
    >
      {React.createElement(icon, { className: "h-4 w-4" })}
      {name}
      <span className="ms-auto">
        {isExpanded ? (
          <ChevronUp className="w-5 h-5"  />
        ) : (
          <ChevronDown className="w-5 h-5"  />
        )}
      </span>
    </button>
  );
};
