import React, { createContext, useContext, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FOCUS_RING } from "@/components/molecules/kit/ui";
import { useMotionAllowed } from "@/components/molecules/kit/motion/useMotionAllowed";
import { CustomTabItem } from "@/components/molecules/sidebar/custom-tabs/CustomTabs";
import { cn } from "@/utils/function/utils";

/** How a settings tab row is drawn: the Platform's underline buttons, or the zinc kit's sliding text tabs. */
export type SettingsTabSkin = "appsec" | "zinc";

interface SettingsTabsState {
  skin: SettingsTabSkin;
  /** The tab of the page on screen; a value that is none of them marks nothing. */
  current: string;
  /**
   * The zinc underline's framer `layoutId`. Each settings page mounts its own
   * wrapper, so a per-mount id would never slide: a name shared by the pages
   * of one set lets the underline glide from the tab left to the tab opened.
   */
  layoutId: string;
}

/**
 * What a settings tab row tells its tabs. A tab registered on the
 * `settings.organization.tabs` or `settings.profile.tabs` slot reads `current`
 * to say whether it is the page on screen.
 */
export const SettingsTabsContext = createContext<SettingsTabsState>({ skin: "appsec", current: "", layoutId: "settings-tabs" });

export const useSettingsTabs = (): SettingsTabsState => useContext(SettingsTabsContext);

const TAB_LINK = cn(
  "relative inline-flex h-11 shrink-0 items-center rounded-sm text-[13px] font-medium sm:h-9",
  "transition-colors duration-[120ms]",
  FOCUS_RING
);
const TAB_CURRENT = "text-zinc-900 hover:text-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-50";
const TAB_IDLE = "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const TAB_UNDERLINE = "absolute inset-x-0 -bottom-px h-[1.5px] rounded-full bg-zinc-900 dark:bg-zinc-100";
/** About 200 ms to settle: the underline glides, it does not bounce. */
const TAB_SLIDE = { type: "spring", stiffness: 520, damping: 42 } as const;

/** The zinc tab: a link, the current one in ink over the sliding 1.5 px underline. */
const ZincSettingsTab: React.FC<{ label: string; to: string; active: boolean; layoutId: string }> = ({
  label,
  to,
  active,
  layoutId,
}) => {
  const motionAllowed = useMotionAllowed();
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className={cn(TAB_LINK, active ? TAB_CURRENT : TAB_IDLE)}>
      {active ? (
        <motion.span
          aria-hidden="true"
          data-tabs-indicator=""
          layoutId={layoutId}
          transition={motionAllowed ? TAB_SLIDE : { duration: 0 }}
          className={TAB_UNDERLINE}
        />
      ) : null}
      <span className="relative whitespace-nowrap">{label}</span>
    </Link>
  );
};

/** The Platform tab: the underline button of `CustomTabs`, which opens its page. */
const PlatformSettingsTab: React.FC<{ value: string; label: string; to: string; active: boolean }> = ({
  value,
  label,
  to,
  active,
}) => {
  const navigate = useNavigate();
  return (
    <CustomTabItem tab={{ label, value }} selectedTab={active ? value : undefined} onSelectTab={() => navigate(to)} />
  );
};

/**
 * One tab of a settings or profile row, drawn in the row's skin. The core tabs
 * and the registrations of the settings slots render this one component.
 */
export function SettingsTab({
  value,
  label,
  to,
  active,
}: {
  value: string;
  label: string;
  to: string;
  active: boolean;
}): ReactElement {
  const { skin, layoutId } = useSettingsTabs();
  if (skin === "zinc") return <ZincSettingsTab label={label} to={to} active={active} layoutId={layoutId} />;
  return <PlatformSettingsTab value={value} label={label} to={to} active={active} />;
}

export default SettingsTab;
