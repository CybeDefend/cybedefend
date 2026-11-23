

import React, { useEffect } from "react";
import { AuthorizedContent, useAuthorization } from "react-rebac";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SidebarMenu from "../../../components/molecules/sidebar/sidebar-menu/SidebarMenu";
import ProjectTemplateWrapper from "../../../components/molecules/wrapper/ProjectTemplateWrapper";
import GeneralSettings from "../../../components/organismes/project-settings/GeneralSettings";
import IssuesSettings from "../../../components/organismes/project-settings/IssuesSettings";
import { JiraProject, JiraProjectConfig } from "../../../server/services/integrations/jiraIntegrationsService";
import type {
  LinearProjectConfig,
  LinearTeam,
  LinearTeamOptions,
} from "../../../server/services/integrations/linearIntegrationsService";
import NotificationsSettings from "../../../components/organismes/project-settings/NotificationsSettings";
import ScanningSettings from "../../../components/organismes/project-settings/ScanningSettings";
import SecurityContextSettings from "../../../components/organismes/project-settings/SecurityContextSettings";
import SecurityContextBanner from "../../../components/molecules/banners/SecurityContextBanner";
import { FeatureGate } from '@/components/molecules/feature-gate';
import { Bell, Cog, Search, ShieldHalved, Ticket } from '@/components/atoms/icon/icons';
import { spaceOf, useProduct } from '@/utils/product';
import { motion } from 'framer-motion';
import { useSlotEntries } from '@/edition/slots';
import { Button as VdButton } from '@/components/molecules/kit/ui';
import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { cn } from '@/utils/function/utils';

/*
  The settings menu of a space on the zinc kit,
  drawn with the kit's ghost Button: words in 32 px rows, the section shown in ink on a zinc
  tint with a 2 px ink marker that slides from row to row (framer `layoutId`;
  it jumps on a calm page), the others in zinc; no glyph, no accent fill. On a
  phone the rows sit side by side and scroll sideways. AppSec keeps its
  SidebarMenu byte for byte (pinned by ProjectSettingTemplate.product.test.tsx).
*/
const VD_MENU_TITLE = "mb-2 px-2.5 text-[13px] font-medium text-zinc-900 dark:text-zinc-100";
const VD_MENU_ROW = "relative h-8 justify-start px-2.5 text-[13px] md:w-full";
const VD_MENU_CURRENT =
  "bg-zinc-100 text-zinc-900 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-white/[0.06] dark:text-zinc-50 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50";
const VD_MENU_IDLE =
  "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.03] dark:hover:text-zinc-100";
const VD_MENU_MARKER =
  "pointer-events-none absolute inset-y-2 left-0 hidden w-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100 md:block";
/** About 200 ms to settle: the marker glides, it does not bounce. */
const VD_MENU_SLIDE = { type: 'spring', stiffness: 520, damping: 42 } as const;

/**
 * What a space that scores no findings (`findingSettings: false`) shows of
 * the settings: the project, and the compliance frameworks of its security
 * context. The other tabs configure AppSec scans and what is done with their
 * findings.
 */
const NO_FINDING_SECTIONS = ['general', 'securityContext'];

interface ProjectSettingTemplateProps {
  projectTitle: string;
  projectId: string | undefined;
  teamName: string;
  teamId: string;
  applicationType: string;
  onApplicationTypeChange: (value: string) => void;
  onDisableProject: () => void;
  onDeleteProject: () => void;
  analysisFrequency: string;
  onAnalysisFrequencyChange: (value: string) => void;
  aiMergeRequestEnabled: boolean;
  onAiMergeRequestToggle: () => void;
  improvingResultsEnabled: boolean;
  onCybeAnalysisToggle: () => void;
  onScanOnCommitToggle: () => void;
  scanOnCommitEnabled: boolean;
  isProjectLinkedToGithub: boolean;
  onUnlinkGithubProject: () => void;
  isProjectLinkedToGitlab: boolean;
  onUnlinkGitlabProject: () => void;
  scanTypes: {
    sast: boolean;
    dast: boolean;
    sca: boolean;
    container: boolean;
    api: boolean;
    iac: boolean;
    secret: boolean;
    aibom: boolean;
  };
  configurationSast: {
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[];
  };
  configurationIac: {
    severities: string[];
    agentCategories?: string[];
  };
  configurationSca: {
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  };
  configurationContainer: {
    severities: string[];
  };
  configurationSecret: {
    severities: string[];
  };
  onScanTypeToggle: (
    type: keyof ProjectSettingTemplateProps["scanTypes"]
  ) => void;
  onConfigureSast: (config: {
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[];
  }) => void;
  onConfigureIac: (config: {
    severities: string[];
    agentCategories?: string[];
  }) => void;
  onConfigureContainer: (config: { severities: string[] }) => void;
  onConfigureSecret: (config: { severities: string[] }) => void;
  onConfigureSca: (config: {
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  }) => void;

  // Notification preferences
  /** The project payload the page loaded, handed to the notifications the active edition adds. */
  project?: unknown;
  isSlackConnected: boolean;
  slackChannelName: string;
  onConfigureSlackChannel: () => void;
  onSlackChannelChange: (channelName: string) => void;

  notifSeverityThreshold: string[];
  onSeverityThresholdChange: (severities: string[]) => void;
  notifScannerTypes: string[];
  onScannerTypesChange: (types: string[]) => void;


  scanCompleteEmailEnabled: boolean;
  onScanCompleteEmailToggle: () => void;
  scanCompleteSlackEnabled: boolean;
  onScanCompleteSlackToggle: () => void;

  weeklyReportEnabled: boolean;
  onWeeklyReportToggle: () => void;
  weeklyReportSlackEnabled: boolean;
  onWeeklyReportSlackToggle: () => void;

  monthlyReportEnabled: boolean;
  onMonthlyReportToggle: () => void;
  monthlyReportSlackEnabled: boolean;
  onMonthlyReportSlackToggle: () => void;

  // Legacy (kept for backward compatibility)
  emailAlertEnabled: boolean;
  onEmailAlertToggle: () => void;
  onConfigureEmailAlert: () => void;

  incidentCreationOption: string;
  onIncidentCreationOptionChange: (value: string) => void;

  // GitHub/GitLab Issues settings
  githubIssueEnabled: boolean;
  onGithubIssueToggle: () => void;
  gitlabIssueEnabled: boolean;
  onGitlabIssueToggle: () => void;

  // Jira Issues settings
  isJiraConnected: boolean;
  jiraProjects: JiraProject[];
  jiraConfig: JiraProjectConfig | null;
  onJiraProjectChange: (project: JiraProject | null) => void;
  onJiraAllowedBranchesChange: (branches: string[]) => void;
  onJiraAutoCreateToggle: () => void;

  // Linear Issues settings
  isLinearConnected: boolean;
  linearTeams: LinearTeam[];
  linearTeamOptions: LinearTeamOptions | null;
  linearConfig: LinearProjectConfig | null;
  isLinearConfigLoading?: boolean;
  onLinearTeamChange: (teamId: string | null) => void;
  onLinearProjectChange: (id: string | null) => void;
  onLinearLabelsChange: (ids: string[]) => void;
  onLinearAllowedBranchesChange: (branches: string[]) => void;
  onLinearAutoCreateToggle: () => void;

  issueCreationMode: string;
  onIssueCreationModeChange: (value: string) => void;
  issueCreationBranches: string[];
  onIssueCreationBranchesChange: (branches: string[]) => void;
  branches: Array<{ name: string; isDefault?: boolean; isProtected?: boolean }>;

  // Paginated / backend-searched branch OPTIONS for the Issues multi-selects.
  // `branches` (GeneralSettings' reference-branch field) is built on the same
  // list and searches it with the same handlers.
  issueBranchOptions: Array<{ name: string; isDefault?: boolean; isProtected?: boolean }>;
  issueBranchesAsync?: boolean;
  onIssueBranchSearchChange?: (value: string) => void;
  onIssueBranchLoadMore?: () => void;
  issueBranchesHasMore?: boolean;
  issueBranchesSearching?: boolean;
  issueBranchesLoadingMore?: boolean;

  referenceBranch: string | null;
  onReferenceBranchChange: (branch: string | null) => void;

  // Security Context
  securityContextEnvironment: string;
  securityContextInternetExposure: string;
  securityContextDeploymentType: string;
  securityContextDataClassification: string;
  securityContextHandlesPii: boolean;
  securityContextHandlesPaymentData: boolean;
  securityContextBusinessCriticality: string;
  securityContextUserBaseSize: string;
  securityContextComplianceFrameworks: string[];
  securityContextSafetyCritical: boolean;
  securityContextNetworkSegmentation: string;
  onSecurityContextFieldChange: (field: string, value: any) => void;
  isSecurityContextCustomized: boolean;

  loading: boolean;
}

const ProjectSettingTemplate: React.FC<ProjectSettingTemplateProps> = ({
  projectTitle,
  projectId,
  teamName,
  teamId,
  applicationType,
  onApplicationTypeChange,
  onDisableProject,
  onDeleteProject,
  analysisFrequency,
  onAnalysisFrequencyChange,
  aiMergeRequestEnabled,
  onAiMergeRequestToggle,
  improvingResultsEnabled,
  onCybeAnalysisToggle,
  onScanOnCommitToggle,
  scanOnCommitEnabled,
  isProjectLinkedToGithub,
  onUnlinkGithubProject,
  isProjectLinkedToGitlab,
  onUnlinkGitlabProject,
  scanTypes,
  configurationSast,
  configurationIac,
  configurationSca,
  configurationContainer,
  configurationSecret,
  onScanTypeToggle,
  onConfigureSast,
  onConfigureContainer,
  onConfigureSecret,
  onConfigureIac,
  onConfigureSca,
  project,
  isSlackConnected,
  slackChannelName,
  onConfigureSlackChannel,
  onSlackChannelChange,
  notifSeverityThreshold,
  onSeverityThresholdChange,
  notifScannerTypes,
  onScannerTypesChange,
  scanCompleteEmailEnabled,
  onScanCompleteEmailToggle,
  scanCompleteSlackEnabled,
  onScanCompleteSlackToggle,
  weeklyReportEnabled,
  onWeeklyReportToggle,
  weeklyReportSlackEnabled,
  onWeeklyReportSlackToggle,
  monthlyReportEnabled,
  onMonthlyReportToggle,
  monthlyReportSlackEnabled,
  onMonthlyReportSlackToggle,
  emailAlertEnabled,
  onEmailAlertToggle,
  onConfigureEmailAlert,
  incidentCreationOption,
  onIncidentCreationOptionChange,
  githubIssueEnabled,
  onGithubIssueToggle,
  gitlabIssueEnabled,
  onGitlabIssueToggle,
  isJiraConnected,
  jiraProjects,
  jiraConfig,
  onJiraProjectChange,
  onJiraAllowedBranchesChange,
  onJiraAutoCreateToggle,
  isLinearConnected,
  linearTeams,
  linearTeamOptions,
  linearConfig,
  isLinearConfigLoading,
  onLinearTeamChange,
  onLinearProjectChange,
  onLinearLabelsChange,
  onLinearAllowedBranchesChange,
  onLinearAutoCreateToggle,
  issueCreationMode,
  onIssueCreationModeChange,
  issueCreationBranches,
  onIssueCreationBranchesChange,
  branches,
  issueBranchOptions,
  issueBranchesAsync,
  onIssueBranchSearchChange,
  onIssueBranchLoadMore,
  issueBranchesHasMore,
  issueBranchesSearching,
  issueBranchesLoadingMore,
  referenceBranch,
  onReferenceBranchChange,
  securityContextEnvironment,
  securityContextInternetExposure,
  securityContextDeploymentType,
  securityContextDataClassification,
  securityContextHandlesPii,
  securityContextHandlesPaymentData,
  securityContextBusinessCriticality,
  securityContextUserBaseSize,
  securityContextComplianceFrameworks,
  securityContextSafetyCritical,
  securityContextNetworkSegmentation,
  onSecurityContextFieldChange,
  isSecurityContextCustomized,
  loading,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const searchParams = new URLSearchParams(location.search);
  const initialTab = searchParams.get("tab") || "general";

  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization
  );

  const authorizationOrganization = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["administrator", "creator"]
  );

  const authorizationTeam = useAuthorization(teamId, "team", ["team_manager"]);

  const [selectedSubSection, setSelectedSubSection] =
    React.useState<string>(initialTab);

  // The page is served in every space; a link to an AppSec tab opened in a
  // space that scores no findings shows General.
  const product = useProduct();
  const space = spaceOf(product);
  const zinc = space.skin === 'zinc';
  const scanSettings = space.findingSettings !== false;
  // What a space adds under the project's name, as on its other tabs.
  const headerEntries = useSlotEntries('project.settings.sections');
  const menuMotion = useMotionAllowed();
  const shownSection =
    !scanSettings && !NO_FINDING_SECTIONS.includes(selectedSubSection)
      ? "general"
      : selectedSubSection;

  // Memoize menuItems to ensure it updates when props or authorization changes
  const menuItems = React.useMemo(() => {
    const hasAuthorization = authorizationOrganization || authorizationTeam;
    const hasIntegration = isProjectLinkedToGithub || isProjectLinkedToGitlab || isJiraConnected || isLinearConnected;

    if (!scanSettings) {
      return [
        { id: "general", label: t('navigation.general'), icon: <Cog className="h-5 w-5"  /> },
        ...(hasAuthorization
          ? [
            {
              id: "securityContext",
              label: t('pages.projectSetting.tabs.securityContext'),
              icon: <ShieldHalved className="h-5 w-5"  />,
            },
          ]
          : []),
      ];
    }

    return [
      { id: "general", label: t('navigation.general'), icon: <Cog className="h-4 w-4"  /> },
      ...(hasAuthorization
        ? [
          {
            id: "scanning",
            label: t('pages.projectSetting.tabs.scanning'),
            icon: <Search className="h-4 w-4"  />,
          },
          {
            id: "notifications",
            label: t('pages.projectSetting.tabs.notifications'),
            icon: <Bell className="h-4 w-4"  />,
          },
          {
            id: "securityContext",
            label: t('pages.projectSetting.tabs.securityContext'),
            icon: <ShieldHalved className="h-4 w-4"  />,
          },
        ]
        : []),
      // Issues tab - only visible when project is linked to GitHub or GitLab
      ...(hasIntegration && hasAuthorization
        ? [
          {
            id: "issues",
            label: t('pages.projectSetting.tabs.issues'),
            icon: <Ticket className="h-4 w-4"  />,
          },
        ]
        : []),
    ];
  }, [authorizationOrganization, authorizationTeam, isProjectLinkedToGithub, isProjectLinkedToGitlab, isJiraConnected, isLinearConnected, scanSettings, t]);

  const handleMenuChange = (id: string) => {
    setSelectedSubSection(id);
    navigate(`?tab=${id}`, { replace: true });
  };

  const renderSubSection = () => {
    switch (shownSection) {
      case "general":
        return (
          <GeneralSettings
            projectName={projectTitle}
            teamName={teamName}
            teamId={teamId}
            projectId={projectId || ""}
            applicationType={applicationType}
            onApplicationTypeChange={onApplicationTypeChange}
            onDisableProject={onDisableProject}
            onDeleteProject={onDeleteProject}
            isProjectLinkedToGithub={isProjectLinkedToGithub}
            onUnlinkGithubProject={onUnlinkGithubProject}
            isProjectLinkedToGitlab={isProjectLinkedToGitlab}
            onUnlinkGitlabProject={onUnlinkGitlabProject}
            branches={branches}
            branchesAsync={issueBranchesAsync}
            onBranchSearchChange={onIssueBranchSearchChange}
            onBranchLoadMore={onIssueBranchLoadMore}
            branchesHasMore={issueBranchesHasMore}
            branchesSearching={issueBranchesSearching}
            branchesLoadingMore={issueBranchesLoadingMore}
            referenceBranch={referenceBranch}
            onReferenceBranchChange={onReferenceBranchChange}
            scanOnCommitEnabled={scanOnCommitEnabled}
            onScanOnCommitToggle={onScanOnCommitToggle}
            loading={loading}
          />
        );
      case "scanning":
        return (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <ScanningSettings
              analysisFrequency={analysisFrequency}
              onAnalysisFrequencyChange={onAnalysisFrequencyChange}
              aiMergeRequestEnabled={aiMergeRequestEnabled}
              onAiMergeRequestToggle={onAiMergeRequestToggle}
              improvingResultsEnabled={improvingResultsEnabled}
              onCybeAnalysisToggle={onCybeAnalysisToggle}
              scanTypes={scanTypes}
              configurationSast={configurationSast}
              configurationIac={configurationIac}
              configurationSca={configurationSca}
              configurationContainer={configurationContainer}
              configurationSecret={configurationSecret}
              onScanTypeToggle={onScanTypeToggle}
              onConfigureSast={onConfigureSast}
              onConfigureIac={onConfigureIac}
              onConfigureSca={onConfigureSca}
              onConfigureContainer={onConfigureContainer}
              onConfigureSecret={onConfigureSecret}
              isProjectLinkedToGithub={isProjectLinkedToGithub}
              isProjectLinkedToGitlab={isProjectLinkedToGitlab}
            />
          </AuthorizedContent>
        );
      case "notifications":
        return (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <NotificationsSettings
              projectId={projectId || ""}
              project={project}
              isSlackConnected={isSlackConnected}
              slackChannelName={slackChannelName}
              onConfigureSlackChannel={onConfigureSlackChannel}
              onSlackChannelChange={onSlackChannelChange}
              notifSeverityThreshold={notifSeverityThreshold}
              onSeverityThresholdChange={onSeverityThresholdChange}
              notifScannerTypes={notifScannerTypes}
              onScannerTypesChange={onScannerTypesChange}
              scanCompleteEmailEnabled={scanCompleteEmailEnabled}
              onScanCompleteEmailToggle={onScanCompleteEmailToggle}
              scanCompleteSlackEnabled={scanCompleteSlackEnabled}
              onScanCompleteSlackToggle={onScanCompleteSlackToggle}
              weeklyReportEnabled={weeklyReportEnabled}
              onWeeklyReportToggle={onWeeklyReportToggle}
              weeklyReportSlackEnabled={weeklyReportSlackEnabled}
              onWeeklyReportSlackToggle={onWeeklyReportSlackToggle}
              monthlyReportEnabled={monthlyReportEnabled}
              onMonthlyReportToggle={onMonthlyReportToggle}
              monthlyReportSlackEnabled={monthlyReportSlackEnabled}
              onMonthlyReportSlackToggle={onMonthlyReportSlackToggle}
            />
          </AuthorizedContent>
        );
      case "securityContext":
        return (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <SecurityContextSettings
              environment={securityContextEnvironment}
              internetExposure={securityContextInternetExposure}
              deploymentType={securityContextDeploymentType}
              dataClassification={securityContextDataClassification}
              handlesPii={securityContextHandlesPii}
              handlesPaymentData={securityContextHandlesPaymentData}
              businessCriticality={securityContextBusinessCriticality}
              userBaseSize={securityContextUserBaseSize}
              complianceFrameworks={securityContextComplianceFrameworks}
              safetyCritical={securityContextSafetyCritical}
              networkSegmentation={securityContextNetworkSegmentation}
              onFieldChange={onSecurityContextFieldChange}
              loading={loading}
              complianceOnly={!scanSettings}
            />
          </AuthorizedContent>
        );
      case "issues":
        return (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <FeatureGate feature="issues" preview featureLabel="Issues Integration">
              <IssuesSettings
                isProjectLinkedToGithub={isProjectLinkedToGithub}
                isProjectLinkedToGitlab={isProjectLinkedToGitlab}
                githubIssueEnabled={githubIssueEnabled}
                onGithubIssueToggle={onGithubIssueToggle}
                gitlabIssueEnabled={gitlabIssueEnabled}
                onGitlabIssueToggle={onGitlabIssueToggle}
                isJiraConnected={isJiraConnected}
                jiraProjects={jiraProjects}
                jiraConfig={jiraConfig}
                onJiraProjectChange={onJiraProjectChange}
                onJiraAllowedBranchesChange={onJiraAllowedBranchesChange}
                onJiraAutoCreateToggle={onJiraAutoCreateToggle}
                isLinearConnected={isLinearConnected}
                linearTeams={linearTeams}
                linearTeamOptions={linearTeamOptions}
                linearConfig={linearConfig}
                isLinearConfigLoading={isLinearConfigLoading}
                onLinearTeamChange={onLinearTeamChange}
                onLinearProjectChange={onLinearProjectChange}
                onLinearLabelsChange={onLinearLabelsChange}
                onLinearAllowedBranchesChange={onLinearAllowedBranchesChange}
                onLinearAutoCreateToggle={onLinearAutoCreateToggle}
                issueCreationMode={issueCreationMode}
                onIssueCreationModeChange={onIssueCreationModeChange}
                issueCreationBranches={issueCreationBranches}
                onIssueCreationBranchesChange={onIssueCreationBranchesChange}
                branches={issueBranchOptions}
                branchesAsync={issueBranchesAsync}
                onBranchSearchChange={onIssueBranchSearchChange}
                onBranchLoadMore={onIssueBranchLoadMore}
                branchesHasMore={issueBranchesHasMore}
                branchesSearching={issueBranchesSearching}
                branchesLoadingMore={issueBranchesLoadingMore}
              />
            </FeatureGate>
          </AuthorizedContent>
        );
      default:
        return null;
    }
  };

  useEffect(() => {

    const currentTab = searchParams.get("tab") || "general";
    if (currentTab !== selectedSubSection) {
      setSelectedSubSection(currentTab);
    }
  }, [location.search]);

  const headerContext = { product, projectId, organizationId: selectedOrganization?.id, placement: 'header' as const };
  const headerNodes = headerEntries
    .map((entry) => ({ id: entry.id, node: entry.render(headerContext) }))
    .filter((entry) => entry.node !== null && entry.node !== undefined && entry.node !== false);

  return (
    <ProjectTemplateWrapper
      projectId={projectId}
      projectTitle={projectTitle}
      selectedTab="settings"
      // A space's project header is the same on every tab: what it adds under the name.
      subheader={
        headerNodes.length > 0 ? (
          <>
            {headerNodes.map((entry) => (
              <React.Fragment key={entry.id}>{entry.node}</React.Fragment>
            ))}
          </>
        ) : undefined
      }
    >
      {/* It asks for the context AppSec scores findings with: a space that scores none shows none of it. */}
      {scanSettings && (
        <SecurityContextBanner
          projectId={projectId || ""}
          isCustomized={isSecurityContextCustomized}
        />
      )}
      { }
      {/* A quarter of a 360px screen leaves about 40px of usable width: the
          icons fitted, the labels did not, and the menu became a column of
          unlabelled glyphs. Below `md` it sits above the content at full
          width instead. */}
      {/* Below `md` the page's own gutter is the only side padding: each layer
          adding 24px left a section about 160px at 320px. */}
      {/* The zinc kit: the tab's own width, like every other tab. Each column
          keeps its 24 px from md, and the row gives them back on its outer
          edges (`md:-m-6`): no second gutter around the settings, 48 px
          between the menu, of a fixed width, and the settings, which take
          the rest. AppSec keeps its quarter and three quarters. */}
      <div data-testid="project-settings-columns" className={cn("flex flex-col md:flex-row", zinc && "md:-m-6")}>
        <div className={zinc ? "w-full shrink-0 px-0 pb-4 md:w-60 md:p-6 xl:w-64" : "w-full px-0 pb-4 md:w-1/4 md:p-6"}>
          <h3 className={zinc ? VD_MENU_TITLE : "text-[13px] font-medium mb-3 text-zinc-500 dark:text-zinc-400"}>
            {t('pages.projectSetting.globalSettingsTitle')}
          </h3>
          {zinc ? (
            <ul className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-hide px-1 pb-1 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
              {menuItems.map((item) => {
                const current = item.id === shownSection;
                return (
                  <li key={item.id} className="shrink-0">
                    <VdButton
                      variant="ghost"
                      aria-current={current ? "true" : undefined}
                      onClick={() => handleMenuChange(item.id)}
                      className={cn(VD_MENU_ROW, current ? VD_MENU_CURRENT : VD_MENU_IDLE)}
                    >
                      {current ? (
                        <motion.span
                          aria-hidden="true"
                          layoutId="vd-project-settings-menu"
                          transition={menuMotion ? VD_MENU_SLIDE : { duration: 0 }}
                          className={VD_MENU_MARKER}
                        />
                      ) : null}
                      {item.label}
                    </VdButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <SidebarMenu
              items={menuItems}
              selectedItemId={shownSection}
              onChange={handleMenuChange}
            />
          )}
        </div>
        <div className={zinc ? "w-full min-w-0 px-0 md:flex-1 md:p-6" : "w-full px-0 md:w-3/4 md:p-6"}>{renderSubSection()}</div>
      </div>
    </ProjectTemplateWrapper>
  );
};

export default ProjectSettingTemplate;
