import React from 'react';
import { Link } from 'react-router-dom';
import type { IconProps } from '@/components/atoms/icon/icons';
import { AS_MENU_ITEM } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface DropdownItemProps {
  icon?: IconComponent | IconComponent;
  label: string;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
}

const DropdownItem: React.FC<DropdownItemProps> = ({
  icon,
  label,
  href,
  onClick,
  isActive = false,
}) => {
  // A 32 px menu row (44 px on a phone), the current one on a zinc tint.
  const baseClasses = cn(
    AS_MENU_ITEM,
    'gap-x-2.5 cursor-pointer',
    isActive && 'bg-zinc-100 dark:bg-white/[0.06]'
  );

  if (href) {
    return (
      <Link
        className={baseClasses}
        to={href}
        onClick={onClick}
      >
        {icon && React.createElement(icon, { className: "shrink-0 h-4 w-4 text-zinc-400 dark:text-zinc-500" })}
        {label}
      </Link>
    );
  } else {
    return (
      <button
        className={baseClasses}
        onClick={onClick}
        type="button"
      >
        {icon && React.createElement(icon, { className: "shrink-0 h-4 w-4 text-zinc-400 dark:text-zinc-500" })}
        {label}
      </button>
    );
  }
};

export default DropdownItem;
