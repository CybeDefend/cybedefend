import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

import { cn } from "@/utils/function/utils";
import Button from "@/components/atoms/button/Button";
import { EmptyState } from "@/components/molecules/empty-state/EmptyState";
import { BranchSelector } from "@/components/molecules/branch-selector";
import ProjectTemplateWrapper from "@/components/molecules/wrapper/ProjectTemplateWrapper";
import ExportButtons from "@/components/molecules/chart-export/ExportButtons";
import PostureHeadline from "@/components/molecules/project-overview/posture/PostureHeadline";
import { BandEyebrow } from "@/components/molecules/project-overview/posture/PosturePanel";
import SeverityStack from "@/components/molecules/project-overview/posture/SeverityStack";
import ScannerRanking from "@/components/molecules/project-overview/posture/ScannerRanking";
import OpenTrend from "@/components/molecules/project-overview/posture/OpenTrend";
import StateRows from "@/components/molecules/project-overview/posture/StateRows";
import NextSteps from "@/components/molecules/project-overview/posture/NextSteps";
import { countOf, sumCounts } from "@/components/molecules/project-overview/posture/postureTokens";
import { projectPath } from "@/utils/product";
import {
  GetProjectOverviewResponse,
  SeverityType,
  StateType,
  ProjectBranch,
} from "@/server/interfaces/Vulnerability";
import { GitBranch, Rocket, Sync, Upload } from '@/components/atoms/icon/icons';
import { EDITION } from '@/edition/edition';
import { useScansRun } from '@/edition/community/instanceCapabilities';
import { projectSectionIcon } from '@/components/atoms/icon/projectSectionIcons';
import { AS_PANEL, AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';

// The bands arrive one after the other, a few pixels up: enough to read as a sequence, never a show.
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.02,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" as const },
  },
};

/** A grey block where a figure or a panel will be, while the overview loads. */
const PULSE = "animate-pulse rounded-md bg-zinc-200 dark:bg-as-raised";

/**
 * The loading state, in the shape of the page: two bands of two panels, the
 * trend between them. Nothing jumps when the figures arrive.
 */
const OverviewSkeleton: React.FC = () => (
  <div className="space-y-8" aria-busy="true">
    {[0, 1].map((band) => (
      <div key={band} className="space-y-3">
        <div className={cn(PULSE, "h-3 w-24")} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className={cn(AS_PANEL, "h-64 p-5 lg:col-span-3")}>
            <div className={cn(PULSE, "h-4 w-48")} />
            <div className={cn(PULSE, "mt-6 h-3 w-full rounded-full")} />
            <div className={cn(PULSE, "mt-6 h-16 w-full")} />
          </div>
          <div className={cn(AS_PANEL, "h-64 p-5 lg:col-span-2")}>
            <div className={cn(PULSE, "h-4 w-36")} />
            <div className={cn(PULSE, "mt-6 h-32 w-full")} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

interface ProjectOverviewTemplateProps {
  projectId: string | undefined;
  projectTitle: string;
  teamName: string;
  overviewData: GetProjectOverviewResponse | null;
  loading: boolean;
  branches: ProjectBranch[];
  selectedBranch: string | null;
  onBranchChange: (branch: string | null) => void;
  onRefresh: () => void;
  onArchive?: (branchName: string) => void;
  onUnarchive?: (branchName: string) => void;
}

/**
 * The project's posture briefing, in four bands:
 * one sentence built from the figures; the posture now (open findings by
 * severity, and where they are); the trend; what to do next (the next step
 * the counts point to, and the findings by state). Every figure comes from
 * the one overview request the page already makes; every link and filter is
 * the one it had.
 */
const ProjectOverviewTemplate: React.FC<ProjectOverviewTemplateProps> = ({
  projectId,
  projectTitle,
  teamName,
  overviewData,
  loading,
  branches,
  selectedBranch,
  onBranchChange,
  onRefresh,
  onArchive,
  onUnarchive,
}) => {
  const { t } = useTranslation();
  // The Community Edition on an import-only instance runs no scanner: results
  // come by import, and the code analysis page holds the import
  // dialog. An instance that runs scans on a connected cluster starts them, as
  // the cloud.
  const scansRun = useScansRun();
  const importsResults = EDITION === 'community' && !scansRun;
  const navigate = useNavigate();

  // Refs for chart export
  const severityRef = useRef<HTMLDivElement>(null);
  const analysisTypeRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLDivElement>(null);
  const overTimeRef = useRef<HTMLDivElement>(null);

  /**
   * Handle severity click - navigate to the AppSec SAST page with severity filter
   */
  const handleSeverityClick = (severity: SeverityType) => {
    if (!projectId) return;
    // Convert to lowercase as the filter expects lowercase values
    navigate(`${projectPath("appsec", projectId, "sast")}?severity=${severity.toLowerCase()}`);
  };

  /**
   * Handle state click - navigate to the AppSec SAST page with state filter
   */
  const handleStateClick = (state: StateType) => {
    if (!projectId) return;
    navigate(`${projectPath("appsec", projectId, "sast")}?status=${state}`);
  };

  /** The same two lists as links, for the next step: the filtered findings it names. */
  const severityHref = (severity: SeverityType) =>
    `${projectPath("appsec", projectId ?? "", "sast")}?severity=${severity.toLowerCase()}`;
  const stateHref = (state: StateType) => `${projectPath("appsec", projectId ?? "", "sast")}?status=${state}`;

  /**
   * Determines if the overview data is effectively empty (no vulnerabilities)
   */
  const isEmptyData = (() => {
    if (!overviewData) return false;
    const hasSeverity = overviewData.totalBySeverity.length > 0;
    const hasState = overviewData.totalByState.length > 0;
    const hasOverTime = overviewData.vulnerabilitiesOverTime.length > 0;
    const hasAnalysisType = overviewData.totalByAnalysisType.some(
      (item) => item.count > 0
    );

    return !hasSeverity && !hasState && !hasOverTime && !hasAnalysisType;
  })();

  // The headline: three figures of the overview, written as one sentence.
  const ready = !loading && !!overviewData && !isEmptyData;
  const open = overviewData ? sumCounts(overviewData.totalBySeverity) : 0;
  const priority = overviewData
    ? countOf(overviewData.totalBySeverity, "severity", "CRITICAL") + countOf(overviewData.totalBySeverity, "severity", "HIGH")
    : 0;
  const resolved = overviewData ? countOf(overviewData.totalByState, "state", "resolved") : 0;
  const scanners = overviewData ? overviewData.totalByAnalysisType.filter((item) => item.count > 0).length : 0;
  const headlineParts = ready
    ? [
        { value: open, label: t("components.projectOverview.posture.headline.open", { count: open }) },
        { value: priority, label: t("components.projectOverview.posture.headline.priority", { count: priority }) },
        { value: resolved, label: t("components.projectOverview.posture.headline.resolved", { count: resolved }) },
      ]
    : [];

  // The facts under the headline as one phrase with ordinary commas (no hairline, no dot).
  // A branch name is an id and stays in mono; « All branches » is words.
  const metaFacts = [
    teamName ? t("components.projectOverview.posture.meta.teamInline", { name: teamName }) : null,
    ready ? t("components.projectOverview.posture.meta.scanners", { count: scanners }) : null,
  ].filter((fact): fact is string => Boolean(fact));
  const headlineMeta = (
    <>
      <span className={cn("inline-flex items-center gap-1.5 align-top", selectedBranch && "text-zinc-700 dark:text-zinc-200")}>
        <GitBranch aria-hidden="true" className="h-3.5 w-3.5 shrink-0 self-center text-zinc-400 dark:text-zinc-500" />
        {selectedBranch ? (
          <span className="font-mono text-[12px]">{selectedBranch}</span>
        ) : (
          t("components.projectOverview.posture.meta.allBranches")
        )}
      </span>
      {metaFacts.map((fact) => `, ${fact}`).join("")}
    </>
  );

  return (
    <ProjectTemplateWrapper
      projectId={projectId}
      projectTitle={projectTitle}
      selectedTab="overview"
      actions={
        // The vulnerability tabs of this same project offer "Start analysis"
        // right here; on this tab the slot was empty, so the project's main
        // action moved as you navigated. Scanning still happens on the
        // analysis tab — this takes you there rather than duplicating it.
        projectId ? (
          <Button
            variant="secondary"
            size="sm"
            to={projectPath("appsec", projectId, "sast")}
            icon={importsResults ? <Upload className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
          >
            {importsResults ? t('components.importResults.button') : t('components.analyseWrapper.startScan')}
          </Button>
        ) : undefined
      }
    >
      <motion.div
        className="space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Band 0, the headline: the sentence, the branch and the scope under it, the controls on the right. */}
        <motion.div variants={itemVariants}>
          <PostureHeadline
            parts={headlineParts}
            placeholder={
              loading ? (
                <div className="space-y-2 py-1" aria-hidden="true">
                  <div className={cn(PULSE, "h-6 w-[26rem] max-w-full")} />
                </div>
              ) : (
                <h2 className={AS_SECTION_TITLE}>{t("navigation.overview")}</h2>
              )
            }
            meta={headlineMeta}
            actions={
              <>
                <BranchSelector
                  branches={branches}
                  selectedBranch={selectedBranch}
                  onBranchChange={onBranchChange}
                  onArchive={onArchive}
                  onUnarchive={onUnarchive}
                  showAllOption
                  compact
                  loading={loading && branches.length === 0}
                />
                {/* Icon only on a phone, with its word from `sm` up; the same surface as the selector beside it. */}
                <Button
                  variant="white"
                  size="sm"
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label={t("common.refresh")}
                  icon={<Sync className={cn("h-4 w-4", loading && "animate-spin")} />}
                >
                  <span className="hidden sm:inline">{t("common.refresh")}</span>
                </Button>
              </>
            }
          />
        </motion.div>

        {/* Main Content */}
        {loading ? (
          <motion.div variants={itemVariants}>
            <OverviewSkeleton />
          </motion.div>
        ) : !overviewData ? (
          <motion.div variants={itemVariants}>
            <div className={cn(AS_PANEL, "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center")}>
              {React.createElement(projectSectionIcon('overview'), {
                className: 'h-5 w-5 text-zinc-400 dark:text-zinc-500',
              })}
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                {t('pages.projectOverview.noData')}
              </p>
            </div>
          </motion.div>
        ) : isEmptyData ? (
          <motion.div variants={itemVariants}>
            {/* The title used to announce good news while the description
                announced missing data, and the visual was the product logo —
                which identifies the product, not the state. */}
            <EmptyState
              tone="positive"
              title={t('pages.projectOverview.noVulnerabilitiesTitle')}
              description={t('pages.projectOverview.noVulnerabilitiesDescription')}
            />
          </motion.div>
        ) : (
          <>
            {/* Band 1, posture now: what is open, by severity, and where it is. */}
            <motion.section variants={itemVariants} className="space-y-3">
              <BandEyebrow label={t("components.projectOverview.posture.bands.now")} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div ref={severityRef} className="min-w-0 lg:col-span-3">
                  <SeverityStack
                    data={overviewData.totalBySeverity}
                    onSeverityClick={handleSeverityClick}
                    actions={<ExportButtons targetRef={severityRef} filename={`${projectTitle}-severity`} />}
                  />
                </div>
                <div ref={analysisTypeRef} className="min-w-0 lg:col-span-2">
                  <ScannerRanking
                    data={overviewData.totalByAnalysisType}
                    projectId={projectId}
                    actions={<ExportButtons targetRef={analysisTypeRef} filename={`${projectTitle}-analysis-type`} />}
                  />
                </div>
              </div>
            </motion.section>

            {/* Band 2, the trend: the open backlog over time, all of it and its critical or high part. */}
            <motion.section variants={itemVariants} className="space-y-3">
              <BandEyebrow label={t("components.projectOverview.posture.bands.trend")} />
              <div ref={overTimeRef}>
                <OpenTrend
                  data={overviewData.vulnerabilitiesOverTime}
                  meta={t("components.projectOverview.posture.trend.projectMeta")}
                  actions={<ExportButtons targetRef={overTimeRef} filename={`${projectTitle}-trend`} />}
                />
              </div>
            </motion.section>

            {/* Band 3, what to do next: the step the counts point to, and every finding by state. */}
            <motion.section variants={itemVariants} className="space-y-3">
              <BandEyebrow label={t("components.projectOverview.posture.bands.next")} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="min-w-0 lg:col-span-2">
                  <NextSteps
                    severity={overviewData.totalBySeverity}
                    state={overviewData.totalByState}
                    severityHref={severityHref}
                    stateHref={stateHref}
                  />
                </div>
                <div ref={stateRef} className="min-w-0 lg:col-span-3">
                  <StateRows
                    data={overviewData.totalByState}
                    onStateClick={handleStateClick}
                    actions={<ExportButtons targetRef={stateRef} filename={`${projectTitle}-state`} />}
                  />
                </div>
              </div>
            </motion.section>
          </>
        )}
      </motion.div>
    </ProjectTemplateWrapper>
  );
};

export default ProjectOverviewTemplate;
