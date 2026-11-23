import LoaderIcon from "@/components/atoms/loader/LoaderIcon";

import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Lock } from '@/components/atoms/icon/icons';
import Badge from '@/components/atoms/badge/Badge';
import {
  AS_FOCUS_INSET,
  AS_SEGMENT_ITEM,
  AS_SEGMENT_OFF,
  AS_SEGMENT_ON,
  AS_SEGMENT_TRACK,
} from '@/components/atoms/appsec/styles';

interface SettingsTabsProps {
  selectedTab?: string;
  onSelectTab?: (tab: string) => void;
  tabs: {
    label: string;
    value: string;
    link?: string;
    locked?: boolean;
    tooltip?: string;
    /** A count shown after the label, in the accent on the active tab. */
    count?: number;
  }[];
  backgroundColor?: string;
  vulnCounts?: {
    sast?: number;
    iac?: number;
    cicd?: number;
    secret?: number;
    sca?: number;
    container?: number;
    aibom?: number;
  };
  loading?: boolean;
  /**
   * `underline` — the project's top-level section nav.
   * `pill` — nested tabs, which sit inside a card and need to read as a
   * level below the section nav rather than as a second one of it.
   */
  variant?: 'underline' | 'pill';
  /** Tabs rendered after `tabs`, each a `CustomTabItem` (the settings tabs a slot registers). */
  children?: React.ReactNode;
}

/** Per-variant classes, so a tab's look is decided in one place. */
const tabStyles = {
  // The 2 px violet underline is the marker; the current tab's words are ink.
  underline: {
    bar: 'bg-white dark:bg-as-surface border-b border-zinc-200 dark:border-as-line',
    nav: 'flex gap-5 px-4 sm:px-6 min-w-max',
    base: `relative -mb-px flex h-11 md:h-10 items-center whitespace-nowrap flex-shrink-0 px-0.5 text-[13px] font-medium transition-colors duration-[120ms] ${AS_FOCUS_INSET}`,
    active: 'border-b-2 border-secondary text-zinc-900 dark:text-zinc-50',
    idle: 'border-b-2 border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/[0.2] dark:hover:text-zinc-100',
  },
  /*
    A segmented control, not a row of links.

    Only the selected option used to carry a surface; the rest were bare words
    on a near-white track, so at rest nothing said they could be pressed. The
    track is now defined against the page, and every option keeps its own
    outline — the selection is told by weight and colour, not by being the only
    thing that looks like a control.
  */
  pill: {
    // `max-w-full`: an inline bar is as wide as its tabs, so the scroller inside
    // it never scrolled and a French pair pushed the page sideways at 320px.
    bar: `${AS_SEGMENT_TRACK} max-w-full`,
    nav: 'flex gap-0.5 min-w-max',
    base: `${AS_SEGMENT_ITEM} cursor-pointer`,
    active: AS_SEGMENT_ON,
    idle: AS_SEGMENT_OFF,
  },
} as const;

type CustomTab = SettingsTabsProps['tabs'][number];

interface CustomTabItemProps extends Pick<SettingsTabsProps, 'selectedTab' | 'onSelectTab' | 'vulnCounts' | 'loading' | 'variant'> {
  tab: CustomTab;
}

/** One tab of the row, as `CustomTabs` draws it: a host that builds its own list renders these inside it. */
export const CustomTabItem: React.FC<CustomTabItemProps> = ({
  tab,
  selectedTab,
  onSelectTab,
  vulnCounts,
  loading,
  variant = 'underline',
}) => {
  const { t } = useTranslation();
  const style = tabStyles[variant];
  // The AI-BOM tab lists an inventory of AI components, not
  // vulnerabilities. A count badge there reads as "N vulnerabilities",
  // so it is intentionally suppressed (the inventory count lives in the
  // page header instead).
  const count =
    tab.value === 'aibom'
      ? undefined
      : vulnCounts?.[tab.value as keyof typeof vulnCounts];
  // A mono zinc figure after the label, no chip:
  // ink on the current tab, a step quieter elsewhere. The 2 px underline is the marker.
  const CountElement = (active: boolean) => loading ? (
    <span className="ml-2">
      <LoaderIcon />
    </span>
  ) : count !== undefined ? (
    <span
      className={`ml-1.5 font-mono text-xs tabular-nums ${
        active
          ? 'text-zinc-700 dark:text-zinc-200'
          : 'text-zinc-500 dark:text-zinc-450'
      }`}
    >
      {count}
    </span>
  ) : null;

  // A count carried by the tab itself, independent of vulnCounts.
  const tabCount = (active: boolean) =>
    tab.count !== undefined ? (
      <Badge size="xs" variant={active ? 'secondary' : 'default'} className="ml-2">
        {tab.count}
      </Badge>
    ) : null;

  // Locked tab — visually dimmed with a lock icon, still clickable (parent decides navigation)
  if (tab.locked) {
    return (
      <button
        key={tab.value}
        onClick={() => onSelectTab && onSelectTab(tab.value)}
        className={`${style.base} ${style.idle} gap-1.5 opacity-50 cursor-pointer`}
        title={tab.tooltip || t('billing.upgrade_to_pro')}
      >
        {tab.label}
        <Lock className="w-3.5 h-3.5"  />
      </button>
    );
  }

  if (tab.link) {
    return (
      <NavLink
        key={tab.value}
        to={tab.link}
        className={({ isActive }) =>
          `${style.base} ${isActive ? style.active : style.idle}`
        }
      >
        {({ isActive }) => (
          <>
            {tab.label}
            {CountElement(isActive)}
            {tabCount(isActive)}
          </>
        )}
      </NavLink>
    );
  } else {
    return (
      <button
        key={tab.value}
        onClick={() => onSelectTab && onSelectTab(tab.value)}
        className={`${style.base} ${selectedTab === tab.value ? style.active : style.idle}`}
      >
        {tab.label}
        {CountElement(selectedTab === tab.value)}
        {tabCount(selectedTab === tab.value)}
      </button>
    );
  }
};

const CustomTabs: React.FC<SettingsTabsProps> = ({
  selectedTab,
  onSelectTab,
  tabs,
  vulnCounts,
  loading,
  variant = 'underline',
  children,
}) => {
  const style = tabStyles[variant];

  return (
    <div className={style.bar}>
      <div className="min-w-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
        <nav className={style.nav}>
          {tabs.map((tab) => (
            <CustomTabItem
              key={tab.value}
              tab={tab}
              selectedTab={selectedTab}
              onSelectTab={onSelectTab}
              vulnCounts={vulnCounts}
              loading={loading}
              variant={variant}
            />
          ))}
          {children}
        </nav>
      </div>
    </div>
  );
};

export default CustomTabs;
