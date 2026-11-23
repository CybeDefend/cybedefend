import React from "react";
import { Link } from "react-router-dom";
import { LinkRow } from "../../atoms/link";
import IssueBadges from "./IssueBadges";
import CyberRiskBadge from "./CyberRiskBadge";
import { ProjectAnalysis } from "../../../server/interfaces/Project";
import type { ScanSourceType } from "../../../server/interfaces/Project";
import { useTranslation } from "react-i18next";
import { projectPath } from "@/utils/product";
import { CircleInfo, Code, Cog, Eye, FileAlt, Github, MousePointer, Plug, Terminal } from '@/components/atoms/icon/icons';
import { isKnownScanSource, scanSourceLabelKey } from '@/utils/scanSource';
import { PROJECT_SECTION_ICONS } from '@/components/atoms/icon/projectSectionIcons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';
import { AS_FOCUS, AS_FOCUS_INSET, AS_TD, AS_TOUCH, AS_TOUCH_SQUARE, AS_TR } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/*
  Below `md` the row stacks instead of scrolling sideways (the table's head is
  hidden there): the name on its own line, then team, risk, issues, last scan
  and the actions wrapped after it. LinkRow moves a cell's classes onto the
  link it wraps the content in, so the cell itself is reached from the row.
*/
const PHONE_ROW =
  'max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:overflow-visible max-md:px-4 max-md:py-3 max-md:[&>td:first-child]:basis-full';
const PHONE_CELL = 'max-md:p-0 max-md:first:pl-0 max-md:last:pr-0';
/*
  A stacked row is five 20 px links to one page (LinkRow wraps each cell): a
  thumb landing between two of them hit nothing (too many small targets on a
  phone). Each link grows the 44 px reach, 6 px wider
  than its box so the 12 px gaps are covered too: the row is one target. The
  actions cell is not wrapped and keeps its own buttons' square reach.
*/
const PHONE_LINK_CELL = cn(PHONE_CELL, 'max-md:relative', AS_TOUCH, 'max-md:after:-inset-x-1.5');
const PHONE_TD = cn(AS_TD, PHONE_LINK_CELL);

interface ProjectRowProps {
  project: ProjectAnalysis;
  to: string;
  onInfoClick: () => void;
}

const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  to,
  onInfoClick,
}) => {
  const { t } = useTranslation();

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInfoClick();
  };

  return (
    <LinkRow
      to={to}
      className={`cursor-pointer ${AS_TR} overflow-x-auto custom-scrollbar ${AS_FOCUS_INSET} ${PHONE_ROW}`}
    >
      <td className={PHONE_TD}>
        <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {project.name}
          </span>
          {project.isScanning && (
            // A live state without a fill, a dot or a pulse:
            // the word itself is written in blue.
            <div
              className="inline-flex items-center whitespace-nowrap text-xs text-blue-600 dark:text-blue-400"
              role="status"
              aria-live="polite"
            >
              <span>{t("components.scanStatusIndicator.scanning")}</span>
            </div>
          )}
        </div>
      </td>
      <td className={PHONE_TD}>
        <span className="block text-[13px] text-zinc-500 dark:text-zinc-400">
          {project.teamName}
        </span>
      </td>
      <td className={PHONE_TD}>
        <CyberRiskBadge
          level={project.cyberRiskLevel ?? "none"}
          score={project.cyberRiskScore}
        />
      </td>
      <td className={PHONE_TD}>
        <div className="flex gap-1 max-md:[&>div]:flex-nowrap">
          <IssueBadges
            countCritical={project.issuesCount.critical}
            countHigh={project.issuesCount.high}
            countMedium={project.issuesCount.medium}
            countLow={project.issuesCount.low}
          />
        </div>
      </td>
      <td className={PHONE_TD}>
        {(() => {
          // Mixed sources on purpose: in-house drawings for the generic sources,
          // the official mark for GitLab. Typed on what both actually satisfy.
          const sourceIcons: Record<
            ScanSourceType,
            React.ComponentType<{ className?: string }>
          > = {
            manual: MousePointer,
            cli: Terminal,
            github: Github,
            gitlab: Gitlab,
            jetbrains: Code,
            vscode: Code,
          };
          // The API sends a plain string: a source added on the backend later
          // reads « Other source » with a neutral plug, never a raw key.
          const sourceIcon = isKnownScanSource(project.lastScanSourceType)
            ? sourceIcons[project.lastScanSourceType]
            : Plug;
          const lastScanDate = project.analyses
            ?.map((a) => a.lastScan)
            .filter(Boolean)
            .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];
          return (
            <div className="flex flex-col gap-1 max-md:flex-row max-md:items-center max-md:gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                {React.createElement(sourceIcon, { className: "h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" })}
                {t(scanSourceLabelKey(project.lastScanSourceType))}
              </span>
              <span className={cn("text-xs tabular-nums text-zinc-500 dark:text-zinc-400", lastScanDate && "font-mono")}>
                {lastScanDate
                  ? new Date(lastScanDate).toLocaleDateString()
                  : t("components.analysisTable.never")}
              </span>
            </div>
          );
        })()}
      </td>
      {/* data-no-link: cell already contains a button + 4 real <Link>s; skip the
          LinkRow auto-wrap to avoid nested <a> and to keep child links right-clickable. */}
      <td className={cn(AS_TD, 'text-right', PHONE_CELL, 'max-md:ml-auto')} data-no-link={true}>
        <div className="flex items-center justify-end gap-0.5">
          {/* Info opens an in-page side panel — stays a button (not a route). */}
          <div className="group/tip relative">
            <button
              type="button"
              onClick={handleInfoClick}
              aria-label={t("components.sidePanel.details")}
              className={`relative p-2 rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              <CircleInfo className="w-4 h-4"  />
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 rounded-md bg-zinc-900 px-2 py-1 text-xs leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900 whitespace-nowrap opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible pointer-events-none z-10">
              {t("components.sidePanel.details")}
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                <div className="border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
              </div>
            </div>
          </div>
          {/* Routes — rendered as `<a>` so right-click "Open in new tab" works. */}
          {[
            { icon: Eye, label: t("navigation.overview"), to: projectPath("appsec", project.projectId) },
            { icon: FileAlt, label: t("navigation.viewReports"), to: projectPath("appsec", project.projectId, "reports") },
            { icon: PROJECT_SECTION_ICONS.compliance, label: t("navigation.compliance"), to: projectPath("appsec", project.projectId, "compliance") },
            { icon: Cog, label: t("navigation.settings"), to: projectPath("appsec", project.projectId, "settings") },
          ].map((btn, i) => (
            <div key={i} className="group/tip relative">
              <Link
                to={btn.to}
                onClick={(e) => e.stopPropagation()}
                aria-label={btn.label}
                className={`relative inline-flex items-center justify-center p-2 rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
              >
                <btn.icon className="w-4 h-4"  />
              </Link>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 rounded-md bg-zinc-900 px-2 py-1 text-xs leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900 whitespace-nowrap opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible pointer-events-none z-10">
                {btn.label}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                  <div className="border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </td>
    </LinkRow>
  );
};

export default ProjectRow;
