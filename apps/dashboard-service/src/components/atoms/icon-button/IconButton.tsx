import React from "react";
import { Link } from "react-router-dom";
import type { IconProps } from '@/components/atoms/icon/icons';
import { AS_FOCUS_RAIL, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface IconButtonProps {
  icon: IconComponent;
  onClick?: () => void;
  label: string;
  href?: string;
  className?: string;
  hoverBgClass?: string;
  isActive?: boolean;
}

const IconButton: React.FC<IconButtonProps> = ({
  icon,
  onClick,
  label,
  className = "",
  hoverBgClass = "bg-alternative", 
  href,
  isActive = false,
}) => {
  
  const activeClass = isActive
    ? `${hoverBgClass} dark:${hoverBgClass} focus:outline-none`
    : "";

  // A 32 px icon control on the rail, with a 44 px reach on a phone.
  const combinedClassName = cn(
    'relative inline-flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:text-zinc-100',
    AS_FOCUS_RAIL,
    AS_TOUCH_SQUARE,
    className,
    activeClass,
    `hover:${hoverBgClass} dark:hover:${hoverBgClass}`
  );

  return href ? (
    <Link to={href}>
      <button type="button" onClick={onClick} className={combinedClassName}>
        {React.createElement(icon, { className: "h-4 w-4" })}
        <span className="sr-only">{label}</span>
      </button>
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={combinedClassName}>
      {React.createElement(icon, { className: "h-4 w-4" })}
      <span className="sr-only">{label}</span>
    </button>
  );
};

export default IconButton;
