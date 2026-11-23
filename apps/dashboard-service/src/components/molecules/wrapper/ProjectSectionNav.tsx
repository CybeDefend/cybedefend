import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import { projectSectionIcon } from "@/components/atoms/icon/projectSectionIcons";
import type { IconComponent } from "@/components/atoms/icon/projectSectionIcons";
import { APPSEC, projectPath, spaceOf, useProduct } from "@/utils/product";
import { useSlotEntries } from "@/edition/slots";
import { CORE_SCANNER_TABS, isScannerTabEntry, scannerTabSegment } from "./scannerTabs";
import { ProjectSectionNavContext, ProjectSectionTab, type ProjectTabSkin } from "./ProjectSectionTab";

interface ProjectSectionNavProps {
  projectId: string | undefined;
  /**
   * Explicit active section. When omitted, the active tab is derived from the
   * current route.
   */
  active?: string;
  className?: string;
}

interface Section {
  key: string;
  label: string;
  to: string;
  icon: IconComponent;
  /** Its place in the row, among the registrations of the `project.tabs` slot. */
  order: number;
}

/**
 * Scan-type list segments that all belong to the "Vulnerabilities" section:
 * the core scanner tabs' keys (each is its URL segment) plus the segments of
 * the closed tree's scanner-list tabs (`project.tabs` registrations whose id
 * starts with `scanner:` — the AI-BOM one).
 */
const vulnSegments = (entries: ReturnType<typeof useSlotEntries>): string[] => [
  ...CORE_SCANNER_TABS.map((tab) => tab.key),
  ...entries.filter(isScannerTabEntry).map((entry) => scannerTabSegment(entry.id)),
];

/** Room left past the active tab once it is scrolled into view. */
const TAB_SCROLL_MARGIN = 24;

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The band under the tabs, per skin: the Platform's white band, or the zinc row on the page with its hairline. */
const BAND: Record<ProjectTabSkin, string> = {
  appsec: "bg-white dark:bg-as-surface border-b border-zinc-200 dark:border-as-line",
  zinc: "bg-transparent border-b border-zinc-200 dark:border-vd-line",
};

/**
 * Primary project navigation, rendered as an underline tab bar. Each product
 * has its own row: a project is the same repository in every space, but what
 * you do with it differs. The Platform's five tabs are the core's; every
 * other tab is a registration of the `project.tabs` slot, placed by its order.
 */
const ProjectSectionNav: React.FC<ProjectSectionNavProps> = ({ projectId, active, className }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const product = useProduct();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slotEntries = useSlotEntries("project.tabs");
  // The `scanner:` registrations belong to the results list (`AnalyseWrapper`),
  // not to this section row: they are not rendered here.
  const entries = slotEntries.filter((entry) => !isScannerTabEntry(entry));
  const VULN_SEGMENTS = vulnSegments(slotEntries);

  // On a phone the row is narrower than the tabs: bring the active one into
  // view, or the page a tab opens shows a row where no tab is marked.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (end > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = end - scroller.clientWidth + TAB_SCROLL_MARGIN;
    } else if (start < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, start - TAB_SCROLL_MARGIN);
    }
  }, [location.pathname, active, product, projectId]);

  if (!projectId) return null;

  const base = projectPath(product, projectId);
  const path = location.pathname;

  const skin: ProjectTabSkin = spaceOf(product).skin === "zinc" ? "zinc" : "appsec";
  const sections: Section[] =
    product === APPSEC
      ? [
          { key: "overview", label: t("components.projectWrapper.tabs.overview"), to: base, icon: projectSectionIcon("overview"), order: 10 },
          { key: "vulnerabilities", label: t("components.projectWrapper.tabs.vulnerabilities"), to: `${base}/sast`, icon: projectSectionIcon("vulnerabilities"), order: 20 },
          { key: "reports", label: t("components.projectWrapper.tabs.reports"), to: `${base}/reports`, icon: projectSectionIcon("reports"), order: 40 },
          { key: "compliance", label: t("components.projectWrapper.tabs.compliance"), to: `${base}/compliance`, icon: projectSectionIcon("compliance"), order: 50 },
          { key: "settings", label: t("components.projectWrapper.tabs.settings"), to: `${base}/settings`, icon: projectSectionIcon("settings"), order: 90 },
        ]
      : [];
  // A registered tab's key is its registration id, and its page sits at that segment of the project.
  const registered = entries.map((entry) => ({ key: entry.id, to: `${base}/${entry.id}` }));

  const resolveActive = (): string | null => {
    if (active && (sections.some((section) => section.key === active) || registered.some((tab) => tab.key === active))) {
      return active;
    }
    if (product === APPSEC) {
      if (path === base) return "overview";
      if (VULN_SEGMENTS.some((s) => startsWithSegment(path, `${base}/${s}`))) return "vulnerabilities";
    }
    const match = [...sections, ...registered].find((section) => section.to !== base && startsWithSegment(path, section.to));
    return match ? match.key : null;
  };

  const activeKey = resolveActive();
  const isZinc = skin === "zinc";
  const context = { projectId, product };
  const tabs = [
    ...sections.map((section) => ({
      order: section.order,
      key: `core:${section.key}`,
      node: (
        <ProjectSectionTab
          tabKey={section.key}
          label={section.label}
          to={section.to}
          icon={<section.icon className="h-4 w-4" aria-hidden="true" />}
          active={section.key === activeKey}
        />
      ),
    })),
    ...entries.map((entry) => ({ order: entry.order, key: `slot:${entry.id}`, node: entry.render(context) })),
  ].sort((a, b) => a.order - b.order);

  return (
    <ProjectSectionNavContext.Provider value={{ skin, activeKey }}>
      <div className={cn(BAND[skin], className)}>
        {/*
          overflow-x-auto lets the tabs scroll horizontally on narrow screens
          instead of wrapping. Per the CSS spec, `auto` on one axis coerces the
          other axis's default `visible` to `auto`, so the 1px vertical overflow
          from `py-4 -mb-px border-b-2` surfaces a phantom vertical scrollbar on
          the right of the row. overflow-y-hidden pins it away.
        */}
        {/* `relative`: the tabs measure their position from this scroller. */}
        {/* The zinc row, on a phone: its trailing edge fades out (a mask, no
            colour), so a row that goes on past the screen says so. */}
        <div
          ref={scrollerRef}
          className={cn(
            "relative overflow-x-auto overflow-y-hidden scrollbar-hide",
            isZinc && "max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]",
          )}
        >
          <nav
            aria-label={t("components.projectWrapper.sectionNavLabel")}
            className={isZinc ? "flex space-x-6 min-w-max pr-10 md:px-6" : "flex space-x-5 px-4 sm:px-6 min-w-max"}
          >
            {tabs.map((tab) => (
              <React.Fragment key={tab.key}>{tab.node}</React.Fragment>
            ))}
          </nav>
        </div>
      </div>
    </ProjectSectionNavContext.Provider>
  );
};

export default ProjectSectionNav;
