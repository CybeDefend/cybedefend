import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS_INSET } from '@/components/atoms/appsec/styles';

export interface IssueTabButtonProps {
  tabName: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** The tab the page shows. */
  activeTab: string;
  onSelect: (tab: string) => void;
  /** Drawn in the quick-view drawer: tighter spacing. */
  embedded?: boolean;
}

/**
 * One tab of the SAST/IaC/CI/CD issue page's tab row, shared by the page's own
 * tabs and the tabs an edition's `finding.panels` registration adds to it, so
 * every tab of the row looks the same.
 */
const IssueTabButton: React.FC<IssueTabButtonProps> = ({ tabName, label, icon, activeTab, onSelect, embedded = false }) => (
  <button
    onClick={() => onSelect(tabName)}
    className={cn(
      "relative flex items-center font-medium transition-colors duration-[120ms] border-b-2 -mb-px whitespace-nowrap",
      AS_FOCUS_INSET,
      // 44 px tall on a phone in both arms (the drawer's tabs were 40 px).
      embedded ? "h-11 md:h-10 px-0.5 mr-4 text-[13px]" : "h-11 md:h-10 px-0.5 mr-5 text-[13px]",
      activeTab === tabName
        ? "border-secondary text-zinc-900 dark:text-zinc-50"
        : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/[0.2] dark:hover:text-zinc-100"
    )}
  >
    {React.createElement(icon, { className: "h-4 w-4 mr-1.5" })}
    <span>{label}</span>
  </button>
);

export default IssueTabButton;
