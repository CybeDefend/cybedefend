import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { productHome, projectPath } from "@/utils/product";
import { Book, ChevronRight, Code, FileCode, FileZipper, Github, Key, Lock, MousePointer, Plug, Server, Terminal } from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';
import {
  AnalysisType,
  ScanSourceType,
} from "../../../server/interfaces/Project";
import { formatRelativeTime } from "@/utils/relativeTime";
import type { IconProps } from '@/components/atoms/icon/icons';
import { useDisabledFeatures } from "@/server/hooks/useDisabledFeatures";

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

const ANALYSIS_CONFIG: Record<
  string,
  {
    icon: IconComponent;
    bgColor: string;
    iconColor: string;
    borderColor: string;
  }
> = {
  sast: {
    icon: FileCode,
    bgColor: "bg-violet-100 dark:bg-violet-900/30",
    iconColor: "text-violet-600 dark:text-violet-400",
    borderColor: "border-violet-300 dark:border-violet-700",
  },
  sca: {
    icon: Book,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    borderColor: "border-emerald-300 dark:border-emerald-700",
  },
  iac: {
    icon: FileZipper,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    borderColor: "border-blue-300 dark:border-blue-700",
  },
  cicd: {
    icon: Terminal,
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    iconColor: "text-orange-600 dark:text-orange-400",
    borderColor: "border-orange-300 dark:border-orange-700",
  },
  secret: {
    icon: Key,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    borderColor: "border-amber-300 dark:border-amber-700",
  },
  container: {
    icon: Server,
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    borderColor: "border-cyan-300 dark:border-cyan-700",
  },
};

const DEFAULT_CONFIG = {
  icon: FileZipper,
  bgColor: "bg-gray-100 dark:bg-gray-800",
  iconColor: "text-gray-600 dark:text-gray-400",
  borderColor: "border-gray-300 dark:border-gray-700",
};

const getScanSourceIcon = (source: ScanSourceType) => {
  switch (source) {
    case "github":
      return Github;
    case "gitlab":
      return Gitlab;
    case "manual":
      return MousePointer;
    case "cli":
      return Terminal;
    case "jetbrains":
    case "vscode":
      return Code;
    default:
      return Plug;
  }
};

const SHORT_LABELS: Record<string, string> = {
  sast: "SAST",
  sca: "SCA",
  iac: "IaC",
  cicd: "CI/CD",
  secret: "Secret",
  container: "Container",
};

/** The analyses that have a results page of their own, named by their URL segment. */
const ANALYSIS_SEGMENTS = ["sast", "sca", "iac", "cicd", "secret", "container"];

interface AnalysisPillProps {
  analysis: AnalysisType;
  projectId: string;
  lastScanSourceType: ScanSourceType;
}

const AnalysisPill: React.FC<AnalysisPillProps> = ({
  analysis,
  projectId,
  lastScanSourceType,
}) => {
  const { t, i18n } = useTranslation();
  const disabledSet = useDisabledFeatures();
  const typeKey = analysis.type.toLowerCase();
  const isContainer = typeKey === "container";
  const isLocked = isContainer && disabledSet.has("container_scanning");

  const config = ANALYSIS_CONFIG[typeKey] || DEFAULT_CONFIG;
  const label = SHORT_LABELS[typeKey] || analysis.type;
  const totalIssues =
    analysis.issuesCount.critical +
    analysis.issuesCount.high +
    analysis.issuesCount.medium +
    analysis.issuesCount.low;

  const lastScanDisplay =
    formatRelativeTime(analysis.lastScan, i18n.language) ??
    t("components.analysisRow.neverScanned");

  // An AppSec pill: it opens the AppSec results page of its analysis, and a
  // type with no page stays on the AppSec home rather than the root, which
  // would hand the account to the landing rule. A real link, so that it opens
  // in a new tab on cmd-click or middle-click; a locked pill still leads there.
  const target = ANALYSIS_SEGMENTS.includes(typeKey)
    ? projectPath("appsec", projectId, typeKey)
    : productHome("appsec");

  return (
    <Link
      to={target}
      title={isLocked ? t("billing.container_scanning_locked") : undefined}
      className={`
        group inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border
        ${config.borderColor}
        ${
          isLocked
            ? "bg-gray-50 dark:bg-neutral-900/50 opacity-50 cursor-not-allowed"
            : "bg-white dark:bg-neutral-900 hover:shadow-md hover:border-gray-400 dark:hover:border-neutral-500 cursor-pointer"
        }
        transition-all duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50
      `}
    >
      {/* Icon */}
      <div
        className={`flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${config.bgColor}`}
      >
        <config.icon
          className={`w-4.5 h-4.5 ${config.iconColor}`}
         />
      </div>

      {/* Name + meta */}
      <div className="flex flex-col items-start min-w-0">
        {/* Facts as words and spacing, no separator. */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {label}
          </span>
          {isLocked && (
            <Lock
              className="w-3.5 h-3.5 text-secondary dark:text-secondary-light"
             />
          )}
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t("components.analysisRow.issueCount", { count: totalIssues })}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-500">
          <span>{lastScanDisplay}</span>
          {React.createElement(getScanSourceIcon(lastScanSourceType), { className: "w-2.5 h-2.5" })}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight className="w-5 h-5 flex-shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-secondary dark:group-hover:text-secondary-light group-hover:translate-x-0.5 transition-all duration-200" />
    </Link>
  );
};

export default AnalysisPill;
