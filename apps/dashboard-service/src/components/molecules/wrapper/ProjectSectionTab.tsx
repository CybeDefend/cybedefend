import React, { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/utils/function/utils";
import { useMotionAllowed } from "@/components/molecules/kit/motion/useMotionAllowed";
import { AS_FOCUS_INSET } from "@/components/atoms/appsec/styles";

/** How a project tab row is drawn: the Platform's underline tabs with glyphs, or the zinc kit's words. */
export type ProjectTabSkin = "appsec" | "zinc";

interface ProjectSectionNavState {
  skin: ProjectTabSkin;
  /** The key of the current tab, or null when none is. */
  activeKey: string | null;
}

/**
 * What the row tells its tabs: its skin, and which tab is current. A tab
 * registered on the `project.tabs` slot reads `activeKey` to say whether it is
 * the current one (its registration id is its key).
 */
export const ProjectSectionNavContext = createContext<ProjectSectionNavState>({ skin: "appsec", activeKey: null });

export const useProjectSectionNav = (): ProjectSectionNavState => useContext(ProjectSectionNavContext);

/*
  The zinc row: words over a hairline, the current tab in
  ink with a 1.5 px ink underline that slides to the tab you open, the others
  in zinc. No glyph, no accent: the space's own navigation already marks where
  you are. The Platform keeps its underline tabs exactly as they were.
*/
const ZINC_TAB =
  "relative flex h-11 items-center text-[13px] font-medium whitespace-nowrap flex-shrink-0 transition-colors duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500";
const ZINC_CURRENT = "text-zinc-900 dark:text-zinc-50";
const ZINC_IDLE = "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

/** About 200 ms to settle: the underline glides, it does not bounce. */
const SLIDE = { type: "spring", stiffness: 520, damping: 42 } as const;

/**
 * One name for the underline: a page holds one project tab row, and the row
 * stays mounted from tab to tab, so the underline slides to the tab opened.
 * A constant, so a Platform render calls no hook it did not call before.
 */
const INDICATOR_ID = "project-section-tab";

/**
 * The underline of the current zinc tab. Its own component, so the motion
 * preference is only read where it is drawn, never on a Platform page.
 */
const TabIndicator: React.FC = () => {
  const motionAllowed = useMotionAllowed();
  return (
    <motion.span
      aria-hidden="true"
      data-tabs-indicator=""
      layoutId={INDICATOR_ID}
      transition={motionAllowed ? SLIDE : { duration: 0 }}
      className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-zinc-900 dark:bg-zinc-100"
    />
  );
};

interface ProjectSectionTabProps {
  tabKey: string;
  label: string;
  to: string;
  /** The tab's glyph, drawn before its label on the Platform row (the zinc row writes words only). */
  icon: ReactNode;
  active: boolean;
}

/**
 * One tab of the project row, drawn in the row's skin. The core tabs and the
 * registrations of the `project.tabs` slot render this one component, so a
 * tab looks the same wherever it comes from.
 */
export function ProjectSectionTab({ tabKey, label, to, icon, active }: ProjectSectionTabProps): ReactElement {
  const { skin } = useProjectSectionNav();
  if (skin === "zinc") {
    return (
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(ZINC_TAB, active ? ZINC_CURRENT : ZINC_IDLE)}
      >
        {active && <TabIndicator />}
        {label}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-11 items-center gap-1.5 -mb-px border-b-2 text-[13px] font-medium whitespace-nowrap flex-shrink-0 transition-colors duration-[120ms]",
        AS_FOCUS_INSET,
        // The 2 px violet underline marks the current section; its words are ink.
        active
          ? "border-secondary text-zinc-900 dark:text-zinc-50"
          : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/[0.2] dark:hover:text-zinc-100",
      )}
    >
      {/* The word names the tab: every glyph is hidden from assistive tech (a lucide one does not hide itself). */}
      {icon}
      {label}
    </Link>
  );
}

export default ProjectSectionTab;
