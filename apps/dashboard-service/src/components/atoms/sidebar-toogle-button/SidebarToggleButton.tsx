

import React from "react";
import { useTranslation } from "react-i18next";
import { Bars, Times } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

interface SidebarToggleButtonProps {
  onClick: () => void;
  isOpen: boolean;
  ariaControls: string;
}

export const SidebarToggleButton: React.FC<SidebarToggleButtonProps> = ({
  onClick,
  isOpen,
  ariaControls,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative size-8 flex justify-center items-center rounded-lg border border-zinc-200 text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-50 hover:text-zinc-900 dark:border-as-line-strong dark:text-zinc-300 dark:hover:bg-white/[0.06]",
        AS_FOCUS,
        AS_TOUCH_SQUARE
      )}
      aria-expanded={isOpen}
      aria-controls={ariaControls}
      aria-label={t("components.appShell.toggleNavigation")}
    >
      {isOpen ? (
        <Times className="w-4 h-4"  />
      ) : (
        <Bars className="w-4 h-4"  />
      )}
    </button>
  );
};
