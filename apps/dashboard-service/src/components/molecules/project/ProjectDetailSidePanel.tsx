import React from "react";
import { Book, ChevronRight, FileCode, FileZipper, Key, Server, Terminal } from '@/components/atoms/icon/icons';
import SideSheet from '@/components/atoms/side-sheet/SideSheet';
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { projectPath } from "@/utils/product";
import IssueBadges from "./IssueBadges";
import CyberRiskBadge from "./CyberRiskBadge";
import {
  ProjectAnalysis,
  AnalysisType,
} from "../../../server/interfaces/Project";
import type { IconProps } from '@/components/atoms/icon/icons';
import { AS_FOCUS } from '@/components/atoms/appsec/styles';
import { AS_GLYPH, AS_GLYPH_BOX } from '@/components/atoms/appsec/recipes';

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
    borderColor: "border-l-violet-500",
  },
  sca: {
    icon: Book,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-700 dark:text-emerald-400",
    borderColor: "border-l-emerald-500",
  },
  iac: {
    icon: FileZipper,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    borderColor: "border-l-blue-500",
  },
  cicd: {
    icon: Terminal,
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    iconColor: "text-orange-600 dark:text-orange-400",
    borderColor: "border-l-orange-500",
  },
  secret: {
    icon: Key,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    borderColor: "border-l-amber-500",
  },
  container: {
    icon: Server,
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    borderColor: "border-l-cyan-500",
  },
};

const DEFAULT_CONFIG = {
  icon: FileZipper,
  bgColor: "bg-zinc-100 dark:bg-as-raised",
  iconColor: "text-zinc-600 dark:text-zinc-400",
  borderColor: "border-l-zinc-500",
};

interface ProjectDetailSidePanelProps {
  project: ProjectAnalysis | null;
  onClose: () => void;
}

const ANALYSIS_ROUTES: Record<string, string> = {
  sast: "sast",
  sca: "sca",
  iac: "iac",
  cicd: "cicd",
  secret: "secret",
  container: "container",
};

const AnalysisCard: React.FC<{
  analysis: AnalysisType;
  projectId: string;
}> = ({ analysis, projectId }) => {
  const { t } = useTranslation();
  const typeKey = analysis.type.toLowerCase();
  const config = ANALYSIS_CONFIG[typeKey] || DEFAULT_CONFIG;

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

  const lastScanDisplay = analysis.lastScan
    ? formatDistanceToNow(new Date(analysis.lastScan), { addSuffix: true })
    : t("components.analysisRow.neverScanned");

  const route = ANALYSIS_ROUTES[typeKey];

  return (
    <Link
      to={projectPath("appsec", projectId, route)}
      className={`w-full text-left block rounded-lg border border-zinc-200 border-l-2 ${config.borderColor} bg-white p-3 transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line dark:bg-transparent dark:hover:border-white/[0.14] dark:hover:bg-white/[0.03] group cursor-pointer ${AS_FOCUS}`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        {/* The analysis type's colour stays on the left edge; the icon is a quiet glyph, no tile. */}
        <div className={AS_GLYPH_BOX}>
          <config.icon className={AS_GLYPH} />
        </div>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex-1">
          {getTypeLabel(analysis.type)}
        </span>
        <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-[color,transform] duration-[120ms]" />
      </div>
      <div className="flex items-center justify-between">
        <IssueBadges
          countCritical={analysis.issuesCount.critical}
          countHigh={analysis.issuesCount.high}
          countMedium={analysis.issuesCount.medium}
          countLow={analysis.issuesCount.low}
        />
        {/* « 3 days ago » is words: the UI font (mono is for figures only). */}
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {lastScanDisplay}
        </span>
      </div>
    </Link>
  );
};

const ProjectDetailSidePanel: React.FC<ProjectDetailSidePanelProps> = ({
  project,
  onClose,
}) => {
  const { t } = useTranslation();
  const isOpen = project !== null;

  const totalIssues = project
    ? project.issuesCount.critical +
      project.issuesCount.high +
      project.issuesCount.medium +
      project.issuesCount.low
    : 0;

  // The right-hand sheet of every record detail: flush with the edges, no shadow, a scrim.
  return (
    <SideSheet open={isOpen} onClose={onClose} title={project?.name ?? ''} width="sm">
      {project ? (
        <div className="space-y-5">
              {/* Project Info */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("components.analysisTable.linkedTeam")}
                  </span>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {project.teamName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("components.analysisTable.cyberRiskLevel")}
                  </span>
                  <CyberRiskBadge
                    level={project.cyberRiskLevel ?? "none"}
                    score={project.cyberRiskScore}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("components.sidePanel.totalIssues")}
                  </span>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {totalIssues}
                  </span>
                </div>
                <div className="pt-1">
                  <IssueBadges
                    countCritical={project.issuesCount.critical}
                    countHigh={project.issuesCount.high}
                    countMedium={project.issuesCount.medium}
                    countLow={project.issuesCount.low}
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-zinc-200 dark:border-as-line" />

              {/* Analysis Categories */}
              <div>
                <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mb-3">
                  {t("components.sidePanel.analysisCategories")}
                </h4>
                <div className="space-y-2">
                  {project.analyses.length > 0 ? (
                    project.analyses.map((analysis) => (
                      <AnalysisCard
                        key={analysis.type}
                        analysis={analysis}
                        projectId={project.projectId}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                      {t("components.sidePanel.noAnalyses")}
                    </p>
                  )}
                </div>
              </div>
        </div>
      ) : null}
    </SideSheet>
  );
};

export default ProjectDetailSidePanel;
