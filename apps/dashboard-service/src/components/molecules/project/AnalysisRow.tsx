import React from "react";
import IssueBadges from "./IssueBadges";
import {
  AnalysisType,
  ScanSourceType,
} from "../../../server/interfaces/Project";
import { formatRelativeTime } from "@/utils/relativeTime";
import { LinkRow } from "../../atoms/link";
import { useTranslation } from "react-i18next";
import { productHome, projectPath } from "@/utils/product";
import { Book, ChevronRight, Code, FileCode, FileZipper, Github, Key, Lock, MousePointer, Plug, Server, Terminal } from '@/components/atoms/icon/icons';
import { scanSourceLabelKey } from '@/utils/scanSource';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';
import type { IconProps } from '@/components/atoms/icon/icons';
import { useDisabledFeatures } from "@/server/hooks/useDisabledFeatures";

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

/**
 * Analysis type configuration with colors
 */
const ANALYSIS_CONFIG: Record<
  string,
  {
    icon: IconComponent;
    bgColor: string;
    iconColor: string;
    hoverBg: string;
    borderColor: string;
  }
> = {
  sast: {
    icon: FileCode,
    bgColor: "bg-violet-100 dark:bg-violet-900/30",
    iconColor: "text-violet-600 dark:text-violet-400",
    hoverBg: "group-hover:bg-violet-200 dark:group-hover:bg-violet-900/50",
    borderColor: "border-l-violet-500",
  },
  sca: {
    icon: Book,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    hoverBg: "group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50",
    borderColor: "border-l-emerald-500",
  },
  iac: {
    icon: FileZipper,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    hoverBg: "group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50",
    borderColor: "border-l-blue-500",
  },
  cicd: {
    icon: Terminal,
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    iconColor: "text-orange-600 dark:text-orange-400",
    hoverBg: "group-hover:bg-orange-200 dark:group-hover:bg-orange-900/50",
    borderColor: "border-l-orange-500",
  },
  secret: {
    icon: Key,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    hoverBg: "group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50",
    borderColor: "border-l-amber-500",
  },
  container: {
    icon: Server,
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    hoverBg: "group-hover:bg-cyan-200 dark:group-hover:bg-cyan-900/50",
    borderColor: "border-l-cyan-500",
  },
};

const DEFAULT_CONFIG = {
  icon: FileZipper,
  bgColor: "bg-gray-100 dark:bg-gray-800",
  iconColor: "text-gray-600 dark:text-gray-400",
  hoverBg: "group-hover:bg-gray-200 dark:group-hover:bg-gray-700",
  borderColor: "border-l-gray-500",
};

/**
 * Returns the icon for the scan source type
 */
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

/**
 * Returns the display label for the scan source type. The API sends a plain
 * string: a source the dashboard does not know reads « Other source ».
 */
const getScanSourceLabel = (
  source: ScanSourceType,
  t: ReturnType<typeof useTranslation>["t"],
) => t(scanSourceLabelKey(source));

/** The analyses that have a results page of their own, named by their URL segment. */
const ANALYSIS_SEGMENTS = ["sast", "sca", "iac", "cicd", "secret", "container"];

interface AnalysisRowProps {
  analysis: AnalysisType;
  projectId: string;
  lastScanSourceType: ScanSourceType;
}

const AnalysisRow: React.FC<AnalysisRowProps> = ({
  analysis,
  projectId,
  lastScanSourceType,
}) => {
  const { t, i18n } = useTranslation();
  const disabledSet = useDisabledFeatures();
  const isContainer = analysis.type.toLowerCase() === "container";
  const isLocked = isContainer && disabledSet.has("container_scanning");

  const config = ANALYSIS_CONFIG[analysis.type.toLowerCase()] || DEFAULT_CONFIG;

  const lastScanDisplay = analysis.lastScan
    ? formatRelativeTime(analysis.lastScan, i18n.language) ?? t("components.analysisRow.neverScanned")
    : t("components.analysisRow.neverScanned");

  const getTypeLabel = (type: string) => {
    switch (type.toLowerCase()) {
      case "sast":
        return t("components.analysisRow.types.sast");
      case "iac":
        return t("components.analysisRow.types.iac");
      case "cicd":
        return t("components.analysisRow.types.cicd");
      case "secret":
        return t("components.analysisRow.types.secret");
      case "sca":
        return t("components.analysisRow.types.sca");
      case "container":
        return t("components.analysisRow.types.container");
      default:
        return type;
    }
  };

  // The row sits on the AppSec home: an analysis opens its AppSec results
  // page, and a type with no page stays on the AppSec home (the root would
  // hand the account to the landing rule, which may pick another space).
  const analysisTargetRoute: string = (() => {
    const typeKey = analysis.type.toLowerCase();
    return ANALYSIS_SEGMENTS.includes(typeKey)
      ? projectPath("appsec", projectId, typeKey)
      : productHome("appsec");
  })();

  return (
    <LinkRow
      to={analysisTargetRoute}
      className={`
        group cursor-pointer
        border-l-4 ${config.borderColor}
        ${
          isLocked
            ? "bg-gray-50 dark:bg-neutral-900/50 opacity-60"
            : "bg-white dark:bg-neutral-900 hover:bg-gray-50 dark:hover:bg-neutral-800"
        }
        border-b border-gray-100 dark:border-neutral-800
        transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary
      `}
      title={isLocked ? t("billing.container_scanning_locked") : undefined}
    >
      {/* Analysis Type */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={`
            flex items-center justify-center w-9 h-9 rounded-lg
            ${config.bgColor} ${config.hoverBg}
            transition-colors duration-200
          `}
          >
            <config.icon
              className={`w-5 h-5 ${config.iconColor}`}
             />
          </div>
          <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-secondary dark:group-hover:text-secondary-light transition-colors">
            {getTypeLabel(analysis.type)}
          </span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 ml-2 rounded-full bg-secondary/10 dark:bg-secondary/20 px-2 py-0.5 text-xs font-medium text-secondary">
              <Lock className="w-3.5 h-3.5"  />
              Pro
            </span>
          )}
        </div>
      </td>

      {/* Last Scan */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {lastScanDisplay}
        </span>
      </td>

      {/* Scan Source */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {React.createElement(getScanSourceIcon(lastScanSourceType), { className: "w-4 h-4 text-gray-500 dark:text-gray-400" })}
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {getScanSourceLabel(lastScanSourceType, t)}
          </span>
        </div>
      </td>

      {/* Issues */}
      <td className="px-4 py-3">
        <IssueBadges
          countCritical={analysis.issuesCount.critical}
          countHigh={analysis.issuesCount.high}
          countMedium={analysis.issuesCount.medium}
          countLow={analysis.issuesCount.low}
        />
      </td>

      {/* Action indicator */}
      <td className="px-4 py-3 w-24">
        <div className="flex items-center gap-1 text-xs font-medium text-secondary dark:text-secondary-light group-hover:translate-x-0.5 transition-transform duration-200">
          <span>{t("components.analysisRow.viewResults")}</span>
          <ChevronRight className="w-5 h-5" />
        </div>
      </td>
    </LinkRow>
  );
};

export default AnalysisRow;
