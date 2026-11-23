import React from 'react';

interface ChevronIconProps {
  isExpanded: boolean;
  className?: string;
}

const ChevronIconExpand: React.FC<ChevronIconProps> = ({ isExpanded, className }) => (
  <svg
    className={`w-4 h-4 mt-1 transition-transform ${isExpanded ? 'rotate-90' : ''} ${className}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M9 5l7 7-7 7"
      className="dark:stroke-white"
    />
  </svg>
);

export default ChevronIconExpand;