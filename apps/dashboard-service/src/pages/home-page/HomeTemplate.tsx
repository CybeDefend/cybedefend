import React from "react";
import { destinationIcon } from '@/components/atoms/icon/destinationIcons';
import { productHome } from '@/utils/product';
import { Slot } from '@/edition/slots';
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { cn } from "@/utils/function/utils";
import { PageContainer } from "@/components/molecules/page-container";
import { PageHeader } from "@/components/molecules/page-header";
import Card from "@/components/atoms/card";
import CardIcon from "@/components/molecules/card/card-icon/CardIcon";
import CardVulnerabilities from "@/components/molecules/card/card-vulnerabilities/CardVulnerabilities";
import AnalysisTable from "@/components/organismes/table/analysis-table/AnalysisTable";
import {
  ProjectAnalysis,
  ProjectStatistics,
} from "@/server/interfaces/Project";
import { CircleCheck, Home, Plus, TriangleExclamation } from '@/components/atoms/icon/icons';
import { deltaTone } from '@/components/molecules/card/kpi/kpiTone';

interface HomeTemplateProps {
  projects: ProjectAnalysis[];
  mainStatistics: ProjectStatistics | null;
  currentPage: number;
  totalPages: number;
  totalProjects: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading: boolean;
  error: string | null;
  onSearchChange: (query: string) => void;
  onCreateProject: (
    projectName: string,
    teamId: string,
    aiMergeRequestEnabled?: boolean,
    improvingResultsEnabled?: boolean,
    sortsVulnerabilitiesEnabled?: boolean,
    securityChampionEnabled?: boolean,
    securityContext?: Record<string, any>,
  ) => void;
  teams: { label: string; value: string }[];
  cardsLoading: boolean;
  hasActiveScans: boolean;
}

// Animation variants for staggered card animations
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: "easeOut",
    },
  },
};

/**
 * HomeTemplate - Modern presentation component for the Home/Dashboard page
 * Uses unified components with consistent styling and animations
 */
const HomeTemplate: React.FC<HomeTemplateProps> = ({
  projects,
  mainStatistics,
  currentPage,
  totalPages,
  totalProjects,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  error,
  onSearchChange,
  onCreateProject,
  teams,
  cardsLoading,
  hasActiveScans,
}) => {
  const { t } = useTranslation();
  const {
    criticalRiskProjects = 0,
    criticalRiskProjectsInLast7Days = 0,
    solvedIssues = 0,
    solvedIssuesInLast7Days = 0,
    newIssues = 0,
    newIssuesInLast7Days = 0,
    criticalIssues = 0,
    highIssues = 0,
    mediumIssues = 0,
    lowIssues = 0,
  } = mainStatistics || {};

  return (
    <PageContainer background="default" padding="md">
      {/* Page Header */}
      <PageHeader
        title={t("pages.homeTemplate.title")}
        description={t("pages.homeTemplate.description")}
        icon={React.createElement(destinationIcon(productHome('appsec')), {
          className: 'h-6 w-6 text-zinc-500 dark:text-zinc-400',
        })}
        // The title glyph keeps its box and loses its violet tile.
        iconBgColor="border-transparent bg-transparent"
      />

      {/* Statistics Cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4"
      >
        {/* Critical Risk Projects Card */}
        <motion.div variants={cardVariants} className="h-full">
          <Card
            variant="default"
            padding="none"
            className={cn(
              "overflow-hidden h-full",
              "hover:border-zinc-300 dark:hover:border-white/[0.14]",
              "transition-colors duration-[120ms]",
            )}
            hoverable
          >
            <CardIcon
              icon={TriangleExclamation}
              title={`${criticalRiskProjects} ${t("pages.homeTemplate.criticalRiskProjects")}`}
              value={criticalRiskProjects}
              label={t("pages.homeTemplate.criticalRiskProjects")}
              description={`${criticalRiskProjectsInLast7Days} ${t("pages.homeTemplate.inLast7Days")}`}
              tone="critical"
              delta={criticalRiskProjectsInLast7Days}
              deltaNote={t("pages.homeTemplate.inLast7Days")}
              deltaTone={deltaTone(criticalRiskProjectsInLast7Days, "moreIsBad")}
              loading={cardsLoading}
            />
          </Card>
        </motion.div>

        {/* Solved Issues Card */}
        <motion.div variants={cardVariants} className="h-full">
          <Card
            variant="default"
            padding="none"
            className={cn(
              "overflow-hidden h-full",
              "hover:border-zinc-300 dark:hover:border-white/[0.14]",
              "transition-colors duration-[120ms]",
            )}
            hoverable
          >
            <CardIcon
              icon={CircleCheck}
              title={`${solvedIssues} ${t("pages.homeTemplate.solvedIssues")}`}
              value={solvedIssues}
              label={t("pages.homeTemplate.solvedIssues")}
              description={`${solvedIssuesInLast7Days} ${t("pages.homeTemplate.inLast7Days")}`}
              tone="good"
              delta={solvedIssuesInLast7Days}
              deltaNote={t("pages.homeTemplate.inLast7Days")}
              deltaTone={deltaTone(solvedIssuesInLast7Days, "moreIsGood")}
              loading={cardsLoading}
            />
          </Card>
        </motion.div>

        {/* New Issues Card */}
        <motion.div variants={cardVariants} className="h-full">
          <Card
            variant="default"
            padding="none"
            className={cn(
              "overflow-hidden h-full",
              "hover:border-zinc-300 dark:hover:border-white/[0.14]",
              "transition-colors duration-[120ms]",
            )}
            hoverable
          >
            <CardIcon
              icon={Plus}
              title={`${newIssues} ${t("pages.homeTemplate.newIssues")}`}
              value={newIssues}
              label={t("pages.homeTemplate.newIssues")}
              description={`${newIssuesInLast7Days} ${t("pages.homeTemplate.inLast7Days")}`}
              tone="warning"
              delta={newIssuesInLast7Days}
              deltaNote={t("pages.homeTemplate.inLast7Days")}
              deltaTone={deltaTone(newIssuesInLast7Days, "moreIsBad")}
              loading={cardsLoading}
            />
          </Card>
        </motion.div>

        {/* Vulnerabilities Summary Card */}
        <motion.div variants={cardVariants} className="h-full">
          <Card
            variant="default"
            padding="none"
            className={cn(
              "overflow-hidden h-full",
              "hover:border-zinc-300 dark:hover:border-white/[0.14]",
              "transition-colors duration-[120ms]",
            )}
            hoverable
          >
            <CardVulnerabilities
              criticalCount={criticalIssues}
              highCount={highIssues}
              mediumCount={mediumIssues}
              lowCount={lowIssues}
              borderWidth={4}
              loading={cardsLoading}
            />
          </Card>
        </motion.div>
      </motion.div>

      {/* The edition's home banners (the closed tree's AI statistics). */}
      <Slot name="home.banners" context={{ statistics: mainStatistics }} />

      {/* Analysis Table Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <AnalysisTable
          projects={projects}
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalProjects}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          loading={loading}
          error={error}
          onSearchChange={onSearchChange}
          onCreateProject={onCreateProject}
          teams={teams}
          hasActiveScans={hasActiveScans}
        />
      </motion.div>
    </PageContainer>
  );
};

// ─── Agent stat inline badge ────────────────────────────────────

function AgentStat({
  icon,
  value,
  label,
  loading,
}: {
  icon: any;
  value: number;
  label: string;
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-4 w-20 bg-zinc-200 dark:bg-as-raised rounded animate-pulse" />;
  }
  return (
    <div className="flex items-center gap-1.5">
      {React.createElement(icon, { className: "h-3 w-3 text-secondary/60 dark:text-secondary-light" })}
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-50 tabular-nums">{value}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}

export default HomeTemplate;
