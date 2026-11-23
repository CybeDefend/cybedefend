import React from 'react';
import type { IconProps } from './icons';

interface IconLabelProps {
  /** Any icon from the registry — a component taking the shared icon props. */
  icon: React.ComponentType<IconProps>;
  label: string;
}

const IconLabel: React.FC<IconLabelProps> = ({ icon: Icon, label }) => (
  <span className="flex items-center text-gray-500 dark:text-gray-400">
    <Icon className="mr-2 h-5 w-5" />
    {label}
  </span>
);

export default IconLabel;
