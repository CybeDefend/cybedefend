import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Project } from "../../../server/interfaces/Project";
import { unlinkGithubRepository, getGithubRepositories } from "../../../server/services/integrations/githubIntegrationsService";
import { unlinkGitlabRepository, getGitlabRepositories } from "../../../server/services/integrations/gitlabIntegrationsService";
import {
  deleteProject,
  fetchProject,
  updateProject,
  fetchProjectSecurityContext,
  updateProjectSecurityContext,
} from "../../../server/services/projectService";
import {
  getSlackInstallation,
  getProjectSlackChannel,
  listSlackChannels,
  setProjectSlackChannel,
} from "../../../server/services/integrations/slackIntegrationsService";
import {
  getProjectJiraConfig,
  listJiraProjects,
  setProjectJiraConfig,
  removeProjectJiraConfig,
  JiraProject,
  JiraProjectConfig,
} from "../../../server/services/integrations/jiraIntegrationsService";
import {
  getLinearTeamOptions,
  getProjectLinearConfig,
  linearRefusalKey,
  linearRefusalOf,
  listLinearTeams,
  removeProjectLinearConfig,
  setProjectLinearConfig,
  LinearProjectConfig,
  LinearTeam,
  LinearTeamOptions,
} from "../../../server/services/integrations/linearIntegrationsService";
import { clearScannerStorage } from "../../../utils/function/utils";
import ProjectSettingTemplate from "./ProjectSettingTemplate";
import { useProjectPageData } from "../../../server/hooks/useProjectPageData";
import { useProjectBranchesList } from "@/server/hooks/useProjectBranchesList";
import { CICD_CATEGORY_NAMES } from "@/utils/data/agentCategoriesData";
import { productHome, spaceOf, useProduct } from "@/utils/product";
import { apiErrorKey } from '@/utils/function/apiErrorKey';

const ProjectSettingPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // The page is served in both product spaces: leaving it (project deleted or
  // not loadable) goes to the home of the space the user is in.
  const product = useProduct();
  const home = productHome(product);
  // A space that scores no findings shows no Notifications and no Issues tab:
  // what only they use (Slack, Jira, the branches issues may be created on)
  // is not asked.
  const readsAppSecOnlyTabs = spaceOf(product).findingSettings !== false;

  const [project, setProject] = useState<Project | null>(null);

  const [projectTitle, setProjectTitle] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [applicationType, setApplicationType] =
    useState<string>("web_application");

  const [analysisFrequency, setAnalysisFrequency] = useState<string>("daily");
  const [aiMergeRequestEnabled, setAiMergeRequestEnabled] =
    useState<boolean>(false);
  const [improvingResultsEnabled, setImprovingResultsEnabled] =
    useState<boolean>(false);
  const [scanOnCommitEnabled, setScanOnCommitEnabled] =
    useState<boolean>(true);
  const [scanTypes, setScanTypes] = useState<{
    sast: boolean;
    dast: boolean;
    sca: boolean;
    container: boolean;
    api: boolean;
    iac: boolean;
    secret: boolean;
    aibom: boolean;
  }>({
    sast: false,
    dast: false,
    sca: false,
    container: false,
    api: false,
    iac: false,
    secret: true,
    aibom: true,
  });
  const [configurationSast, setConfigurationSast] = useState<{
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[];
  }>({
    fastScan: false,
    severities: [],
    agentCategories: undefined,
  });

  const [configurationIac, setConfigurationIac] = useState<{
    severities: string[];
    agentCategories?: string[];
  }>({
    severities: [],
    agentCategories: undefined,
  });

  const [configurationSca, setConfigurationSca] = useState<{
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  }>({
    isDevDependenciesEnabled: false,
    isTransitiveDependenciesEnabled: false,
    isReachabilityPriorityEnabled: true,
    isReachabilityStatusEnabled: true,
    severities: [],
  });

  const [configurationContainer, setConfigurationContainer] = useState<{
    severities: string[];
  }>({
    severities: [],
  });

  const [configurationSecret, setConfigurationSecret] = useState<{
    severities: string[];
  }>({
    severities: [],
  });

  const [emailAlertEnabled, setEmailAlertEnabled] = useState<boolean>(false);
  const [monthlyReportEnabled, setMonthlyReportEnabled] =
    useState<boolean>(false);
  const [weeklyReportEnabled, setWeeklyReportEnabled] =
    useState<boolean>(false);
  const [incidentCreationOption, setIncidentCreationOption] =
    useState<string>("each_occurrence");

  const [isProjectLinkedToGithub, setIsProjectLinkedToGithub] = useState(false);

  // GitHub/GitLab Issues settings
  const [githubIssueEnabled, setGithubIssueEnabled] = useState<boolean>(false);
  const [gitlabIssueEnabled, setGitlabIssueEnabled] = useState<boolean>(false);
  const [issueCreationMode, setIssueCreationMode] = useState<string>("per_vulnerability_type");
  const [issueCreationBranches, setIssueCreationBranches] = useState<string[]>([]);
  const [referenceBranch, setReferenceBranch] = useState<string | null>(null);

  // Notification preferences
  const [notifSeverityThreshold, setNotifSeverityThreshold] = useState<string[]>(["critical"]);
  const [notifScannerTypes, setNotifScannerTypes] = useState<string[]>(["sast", "sca", "iac", "container"]);
  const [scanCompleteEmailEnabled, setScanCompleteEmailEnabled] = useState<boolean>(false);
  const [scanCompleteSlackEnabled, setScanCompleteSlackEnabled] = useState<boolean>(false);
  const [weeklyReportSlackEnabled, setWeeklyReportSlackEnabled] = useState<boolean>(false);
  const [monthlyReportSlackEnabled, setMonthlyReportSlackEnabled] = useState<boolean>(false);

  // Security Context state
  const [isSecurityContextCustomized, setIsSecurityContextCustomized] = useState(true);
  const [scEnvironment, setScEnvironment] = useState<string>("production");
  const [scInternetExposure, setScInternetExposure] = useState<string>("public");
  const [scDeploymentType, setScDeploymentType] = useState<string>("saas");
  const [scDataClassification, setScDataClassification] = useState<string>("confidential");
  const [scHandlesPii, setScHandlesPii] = useState<boolean>(false);
  const [scHandlesPaymentData, setScHandlesPaymentData] = useState<boolean>(false);
  const [scBusinessCriticality, setScBusinessCriticality] = useState<string>("medium");
  const [scUserBaseSize, setScUserBaseSize] = useState<string>("medium");
  const [scComplianceFrameworks, setScComplianceFrameworks] = useState<string[]>([]);
  const [scSafetyCritical, setScSafetyCritical] = useState<boolean>(false);
  const [scNetworkSegmentation, setScNetworkSegmentation] = useState<string>("flat");

  // Slack integration state
  const [isSlackConnected, setIsSlackConnected] = useState<boolean>(false);
  const [slackChannelName, setSlackChannelName] = useState<string>("");

  // Jira integration state
  const [isJiraConnected, setIsJiraConnected] = useState<boolean>(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraConfig, setJiraConfig] = useState<JiraProjectConfig | null>(null);

  // Linear integration state
  const [isLinearConnected, setIsLinearConnected] = useState<boolean>(false);
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [linearTeamOptions, setLinearTeamOptions] = useState<LinearTeamOptions | null>(null);
  const [linearConfig, setLinearConfig] = useState<LinearProjectConfig | null>(null);
  // False until the project's saved config has been read (or when it cannot be).
  const [isLinearConfigLoaded, setIsLinearConfigLoaded] = useState<boolean>(false);
  // What the Linear saves work from (see enqueueLinearSave): the config the user
  // wants, the last one the server confirmed, whether the stored one was read,
  // the queue of saves, and the project they belong to.
  const linearIntendedRef = useRef<LinearProjectConfig | null>(null);
  const linearConfirmedRef = useRef<LinearProjectConfig | null>(null);
  const linearConfigLoadedRef = useRef<boolean>(false);
  const linearSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const linearGenerationRef = useRef<number>(0);

  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization
  );
  const organizationId = selectedOrganization?.id || "";
  const [loading, setLoading] = useState<boolean>(false);
  const [isProjectLinkedToGitlab, setIsProjectLinkedToGitlab] = useState(false);

  // State for project branches (from API)
  const [projectBranches, setProjectBranches] = useState<string[]>([]);

  // The unified page data (Jira and Linear links). Its branches are only the
  // first page of the list below, which the reference-branch field reads instead.
  const { isJiraLinked: isJiraLinkedFromHook, isLinearLinked: isLinearLinkedFromHook } =
    useProjectPageData(projectId || "");

  // Paginated / backend-searched branch OPTIONS for the Issues multi-selects
  // (Jira allowed branches + issue-creation branches) and for GeneralSettings'
  // reference-branch field. The selection arrays remain page-owned
  // (`issueCreationBranches`, `jiraConfig.allowedBranches`, `referenceBranch`);
  // the fields merge selected-but-off-page values back into their options.
  // Same default view as the page data above: both share one request.
  const issueBranchList = useProjectBranchesList(readsAppSecOnlyTabs ? projectId || null : null);

  // Reference-branch options: the loaded page of the branch list, plus the
  // branches the project payload names (parsedBranches + issueCreationBranches)
  // when no search is typed. While a search is typed, its results alone.
  const combinedBranches = React.useMemo(() => {
    const listed = issueBranchList.branches.map((b) => ({
      name: b.name,
      isDefault: b.isDefault,
      isProtected: b.isProtected,
    }));
    if (issueBranchList.search) {
      return listed;
    }
    const known = new Set(listed.map((b) => b.name));
    const fromProject = projectBranches
      .filter((name) => !known.has(name))
      .map((name) => ({ name, isDefault: false, isProtected: false }));
    return [...listed, ...fromProject];
  }, [issueBranchList.branches, issueBranchList.search, projectBranches]);

  // First: Load project data and set all state immediately (don't wait for branches)
  useEffect(() => {
    if (projectId) {
      fetchProject(projectId)
        .then((data: any) => {
          // Set all project state immediately - don't wait for branches
          setProject(data);
          setProjectTitle(data.name);
          setTeamId(data.teamId);
          setTeamName(data.teamName);
          setApplicationType(data.applicationType || "web_application");

          setAnalysisFrequency(data.analysisFrequency || "daily");
          setScanTypes({
            sast: data.sastEnabled || false,
            dast: data.dastEnabled || false,
            sca: data.scaEnabled || false,
            container: data.containerEnabled || false,
            api: data.apiEnabled || false,
            iac: data.iacEnabled || false,
            secret: data.secretEnabled || false,
            aibom: data.aibomEnabled || false,
          });
          setConfigurationSast({
            fastScan: data.sastFastScanEnabled || false,
            severities: data.sastSeverities || [],
            agentCategories: (() => {
              const merged = [
                ...(data.agentCategoriesSast || []).map((c: any) => c.toLowerCase()),
                ...(data.agentCategoriesCicd || []).map((c: any) => c.toLowerCase()),
              ];
              return merged.length > 0 ? merged : undefined;
            })(),
          });
          setConfigurationIac({
            severities: data.iacSeverities || [],
            agentCategories: data.agentCategoriesIac ? data.agentCategoriesIac.map((c: any) => c.toLowerCase()) : undefined,
          });
          setConfigurationSca({
            isDevDependenciesEnabled: data.scaDevelopmentDependenciesEnabled || false,
            isTransitiveDependenciesEnabled: data.scaTransitiveDependenciesEnabled || false,
            isReachabilityPriorityEnabled: data.scaReachabilityPriorityEnabled ?? true,
            isReachabilityStatusEnabled: data.scaReachabilityStatusEnabled ?? true,
            severities: data.scaSeverities || [],
          });
          setConfigurationContainer({
            severities: data.containerSeverities || [],
          });
          setConfigurationSecret({
            severities: data.secretSeverities?.length ? data.secretSeverities : ['critical', 'high', 'medium', 'low'],
          });

          setScanOnCommitEnabled(data.scanOnCommitEnabled !== false);

          setEmailAlertEnabled(data.emailAlertEnabled || false);
          setMonthlyReportEnabled(data.monthlyReportEnabled || false);
          setWeeklyReportEnabled(data.weeklyReportEnabled || false);
          setIncidentCreationOption(
            data.incidentCreationOption || "each_occurrence"
          );

          // Set AI features states
          setAiMergeRequestEnabled(data.aiMergeRequestEnabled || false);
          setImprovingResultsEnabled(data.improvingResultsEnabled || false);

          // Set GitHub/GitLab Issues settings
          setGithubIssueEnabled(data.githubIssueEnabled || false);
          setGitlabIssueEnabled(data.gitlabIssueEnabled || false);
          setIssueCreationMode(data.issueCreationMode || "per_vulnerability_type");
          setIssueCreationBranches(data.issueCreationBranches || []);

          // Set reference branch (handle empty string as null)
          setReferenceBranch(data.referenceBranch && data.referenceBranch.trim() !== '' ? data.referenceBranch : null);

          // Collect all branches from project API (parsedBranches + issueCreationBranches)
          const apiBranches = new Set<string>();
          (data.parsedBranches || []).forEach((b: any) => apiBranches.add(typeof b === 'string' ? b : b.branch));
          (data.issueCreationBranches || []).forEach((b: string) => apiBranches.add(b));
          setProjectBranches(Array.from(apiBranches));

          // Set notification preferences
          setNotifSeverityThreshold(data.notifSeverityThreshold || ["critical"]);
          setNotifScannerTypes(data.notifScannerTypes || ["sast", "sca", "iac", "container"]);
          setScanCompleteEmailEnabled(data.scanCompleteEmailEnabled || false);
          setScanCompleteSlackEnabled(data.scanCompleteSlackEnabled || false);
          setWeeklyReportSlackEnabled(data.weeklyReportSlackEnabled || false);
          setMonthlyReportSlackEnabled(data.monthlyReportSlackEnabled || false);

          // Set integration linkage status from API response
          setIsProjectLinkedToGithub(data.isGithubLinked || false);
          setIsProjectLinkedToGitlab(data.isGitlabLinked || false);

          // Load security context via dedicated endpoint (clean DTO mapping)
          fetchProjectSecurityContext(projectId).then((sc) => {
            setScEnvironment(sc.environment || "production");
            setScInternetExposure(sc.internetExposure || "public");
            setScDeploymentType(sc.deploymentType || "saas");
            setScDataClassification(sc.dataClassification || "confidential");
            setScHandlesPii(sc.handlesPii || false);
            setScHandlesPaymentData(sc.handlesPaymentData || false);
            setScBusinessCriticality(sc.businessCriticality || "medium");
            setScUserBaseSize(sc.userBaseSize || "medium");
            setScComplianceFrameworks(sc.complianceFrameworks || []);
            setScSafetyCritical(sc.safetyCritical || false);
            setScNetworkSegmentation(sc.networkSegmentation || "flat");
            setIsSecurityContextCustomized(sc.isCustomized || false);
          }).catch(() => {
            setIsSecurityContextCustomized(false);
          });
        })
        .catch((error: any) => {
          navigate(home);
          toast.error(t('pages.projectSetting.errorFetchingProject'));
          throw error;
        });
    }
  }, [projectId, t, navigate, home]);

  const handleDisableProject = () => {
    toast.info(t('pages.projectSetting.toast.projectDisabled'));
  };

  const handleDeleteProject = () => {
    if (projectId) {
      setLoading(true);
      deleteProject(projectId)
        .then(() => {
          toast.success(t('pages.projectSetting.toast.deleteSuccess'));
          setLoading(false);
          navigate(home);
        })
        .catch((error: any) => {
          setLoading(false);
          toast.error(t(apiErrorKey(error, { fallback: 'pages.projectSetting.toast.deleteError' })));
          throw error;
        });
    }
  };

  const handleApplicationTypeChange = (value: string) => {
    setApplicationType(value);
    if (projectId) {
      updateProject(projectId, { applicationType: value })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.appTypeUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.appTypeUpdateError'));
          throw error;
        });
    }
  };

  const handleAnalysisFrequencyChange = (value: string) => {
    setAnalysisFrequency(value);
    if (projectId) {
      updateProject(projectId, { analysisFrequency: value })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.analysisFreqUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.analysisFreqUpdateError'));
          throw error;
        });
    }
  };

  const handleAiMergeRequestToggle = () => {
    const updatedValue = !aiMergeRequestEnabled;
    setAiMergeRequestEnabled(updatedValue);

    if (projectId) {
      updateProject(projectId, {
        aiMergeRequestEnabled: updatedValue,
      })
        .then(() => {
          toast.success(t('pages.projectSetting.toast.aiMergeRequestUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.aiMergeRequestUpdateError'));
          throw error;
        });
    }
  };

  // « Cybe Analysis » is one setting over two flags: it shows the one that
  // starts Cybe's analysis, and sets both to the new value in one request.
  const handleCybeAnalysisToggle = () => {
    const updatedValue = !improvingResultsEnabled;
    setImprovingResultsEnabled(updatedValue);
    if (projectId) {
      updateProject(projectId, {
        improvingResultsEnabled: updatedValue,
        sortsVulnerabilitiesEnabled: updatedValue,
      })
        .then(() => {
          toast.success(t('pages.projectSetting.toast.cybeAnalysisUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.cybeAnalysisUpdateError'));
          throw error;
        });
    }
  };

  const handleScanOnCommitToggle = () => {
    const updatedValue = !scanOnCommitEnabled;
    // Optimistic flip; reverted below if the PATCH fails.
    setScanOnCommitEnabled(updatedValue);
    if (projectId) {
      updateProject(projectId, {
        scanOnCommitEnabled: updatedValue,
      })
        .then(() => {
          toast.success(
            t('pages.projectSetting.toast.scanOnCommitUpdateSuccess'),
          );
        })
        .catch((error: any) => {
          setScanOnCommitEnabled(!updatedValue);
          toast.error(t('pages.projectSetting.toast.scanOnCommitUpdateError'));
          throw error;
        });
    }
  };

  const handleGithubIssueToggle = () => {
    const updatedValue = !githubIssueEnabled;
    setGithubIssueEnabled(updatedValue);
    if (projectId) {
      updateProject(projectId, {
        githubIssueEnabled: updatedValue,
      })
        .then(() => {
          toast.success(t('pages.projectSetting.toast.githubIssueUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.githubIssueUpdateError'));
          throw error;
        });
    }
  };

  const handleGitlabIssueToggle = () => {
    const updatedValue = !gitlabIssueEnabled;
    setGitlabIssueEnabled(updatedValue);
    if (projectId) {
      updateProject(projectId, {
        gitlabIssueEnabled: updatedValue,
      })
        .then(() => {
          toast.success(t('pages.projectSetting.toast.gitlabIssueUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.gitlabIssueUpdateError'));
          throw error;
        });
    }
  };

  const handleIssueCreationModeChange = (value: string) => {
    setIssueCreationMode(value);
    if (projectId) {
      updateProject(projectId, { issueCreationMode: value })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.issueCreationModeUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.issueCreationModeUpdateError'));
          throw error;
        });
    }
  };

  const handleIssueCreationBranchesChange = (branches: string[]) => {
    setIssueCreationBranches(branches);
    if (projectId) {
      updateProject(projectId, { issueCreationBranches: branches })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.issueCreationBranchesUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.issueCreationBranchesUpdateError'));
          throw error;
        });
    }
  };

  const handleReferenceBranchChange = (branch: string | null) => {
    setReferenceBranch(branch);
    if (projectId) {
      updateProject(projectId, { referenceBranch: branch })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.referenceBranchUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.referenceBranchUpdateError'));
          throw error;
        });
    }
  };

  const handleScanTypeToggle = (type: keyof typeof scanTypes) => {
    const newValue = !scanTypes[type];
    setScanTypes((prevScanTypes) => ({
      ...prevScanTypes,
      [type]: newValue,
    }));

    const updateFieldMap: { [key: string]: string } = {
      sast: "sastEnabled",
      dast: "dastEnabled",
      sca: "scaEnabled",
      container: "containerEnabled",
      api: "apiEnabled",
      iac: "iacEnabled",
      secret: "secretEnabled",
      aibom: "aibomEnabled",
    };

    const updateField = updateFieldMap[type];

    if (projectId) {
      updateProject(projectId, { [updateField]: newValue })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.scanTypeUpdateSuccess', { type: type.toUpperCase() }));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.scanTypeUpdateError', { type }));
          throw error;
        });
    }
  };

  const handleConfigureSast = (config: {
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[];
  }) => {
    if (projectId) {
      const allCats = config.agentCategories || [];
      const sastOnly = allCats.filter(c => !CICD_CATEGORY_NAMES.has(c));
      const cicdOnly = allCats.filter(c => CICD_CATEGORY_NAMES.has(c));
      updateProject(projectId, {
        sastFastScanEnabled: config.fastScan,
        sastSeverities: config.severities,
        ...(sastOnly.length > 0 ? { agentCategoriesSast: sastOnly.map(c => c.toUpperCase()) } : {}),
        agentCategoriesCicd: cicdOnly.length > 0 ? cicdOnly.map(c => c.toUpperCase()) : [],
      })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          setConfigurationSast(config);
          toast.success(t('pages.projectSetting.toast.sastConfigUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.sastConfigUpdateError'));
          throw error;
        });
    }
  };

  const handleConfigureContainer = (config: { severities: string[] }) => {
    if (projectId) {
      updateProject(projectId, {
        containerSeverities: config.severities,
      })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.containerConfigUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.containerConfigUpdateError'));
          throw error;
        });
    }
  };

  const handleConfigureSecret = (config: { severities: string[] }) => {
    if (projectId) {
      updateProject(projectId, {
        secretSeverities: config.severities,
      })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          setConfigurationSecret(config);
          toast.success(t('pages.projectSetting.toast.secretConfigUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.secretConfigUpdateError'));
          throw error;
        });
    }
    setConfigurationSecret(config);
  };

  const handleConfigureIac = (config: {
    severities: string[];
    agentCategories?: string[];
  }) => {
    if (projectId) {
      updateProject(projectId, {
        iacSeverities: config.severities,
        // Only send agentCategoriesIac if user explicitly selected (non-empty). If empty block should have been prevented upstream.
        ...(config.agentCategories && config.agentCategories.length > 0 ? { agentCategoriesIac: config.agentCategories.map(c => c.toUpperCase()) } : {}),
      })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          setConfigurationIac(config);
          toast.success(t('pages.projectSetting.toast.iacConfigUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.iacConfigUpdateError'));
          throw error;
        });
    }
  };

  const handleConfigureSca = (config: {
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  }) => {
    setConfigurationSca(config);
    if (projectId) {
      updateProject(projectId, {
        scaSeverities: config.severities,
        scaDevelopmentDependenciesEnabled: config.isDevDependenciesEnabled,
        scaTransitiveDependenciesEnabled: config.isTransitiveDependenciesEnabled,
        scaReachabilityPriorityEnabled: config.isReachabilityPriorityEnabled,
        scaReachabilityStatusEnabled: config.isReachabilityStatusEnabled,
      })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.scaConfigUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.scaConfigUpdateError'));
          throw error;
        });
    }
  };

  const handleEmailAlertToggle = () => {
    const newValue = !emailAlertEnabled;
    setEmailAlertEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { emailAlertEnabled: newValue })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.emailAlertUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.emailAlertUpdateError'));
          throw error;
        });
    }
  };

  const handleConfigureEmailAlert = () => {
    toast.info(t('pages.projectSetting.toast.configureEmailAlertComingSoon'));
  };

  const handleMonthlyReportToggle = () => {
    const newValue = !monthlyReportEnabled;
    setMonthlyReportEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { monthlyReportEnabled: newValue })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.monthlyReportUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.monthlyReportUpdateError'));
          throw error;
        });
    }
  };

  const handleWeeklyReportToggle = () => {
    const newValue = !weeklyReportEnabled;
    setWeeklyReportEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { weeklyReportEnabled: newValue })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.weeklyReportUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.weeklyReportUpdateError'));
          throw error;
        });
    }
  };

  const handleIncidentCreationOptionChange = (value: string) => {
    setIncidentCreationOption(value);
    if (projectId) {
      updateProject(projectId, { incidentCreationOption: value })
        .then((updatedProject: any) => {
          setProject(updatedProject);
          toast.success(t('pages.projectSetting.toast.incidentCreationUpdateSuccess'));
        })
        .catch((error: any) => {
          toast.error(t('pages.projectSetting.toast.incidentCreationUpdateError'));
          throw error;
        });
    }
  };

  /**
   * Unlinks the project from GitHub repository.
   * Uses the project ID directly - backend handles repository lookup.
   */
  const handleUnlinkGithubProject = async () => {
    if (!organizationId || organizationId.trim() === "" || !projectId) return;

    try {
      // Fetch repos to find the linked repository ID required by the API
      const response = await getGithubRepositories(organizationId);
      const allRepos = response.repositories.flatMap((inst) => inst.repository);
      const linkedRepo = allRepos.find((repo) => repo.projectId === projectId);

      if (!linkedRepo) {
        toast.error(t('pages.projectSetting.toast.unlinkGithubError'));
        return;
      }

      await unlinkGithubRepository(organizationId, projectId, { repositoryId: linkedRepo.id });
      toast.success(t('pages.projectSetting.toast.unlinkGithubSuccess'));
      setIsProjectLinkedToGithub(false);
    } catch (err) {
      toast.error(t('pages.projectSetting.toast.unlinkGithubError'));
      throw err;
    }
  };

  /**
   * Unlinks the project from GitLab repository.
   * Uses the project ID directly - backend handles repository lookup.
   */
  const handleUnlinkGitlabProject = async () => {
    if (!organizationId || organizationId.trim() === "" || !projectId) return;

    try {
      // Fetch repos to find the linked repository ID required by the API
      const response = await getGitlabRepositories(organizationId);
      const linkedRepo = response.repositories.find((repo) => repo.projectId === projectId);

      if (!linkedRepo) {
        toast.error(t('pages.projectSetting.toast.unlinkGitlabError'));
        return;
      }

      await unlinkGitlabRepository(organizationId, projectId, { repositoryId: linkedRepo.id });
      toast.success(t('pages.projectSetting.toast.unlinkGitlabSuccess'));
      setIsProjectLinkedToGitlab(false);
    } catch (err) {
      toast.error(t('pages.projectSetting.toast.unlinkGitlabError'));
    }
  };

  // Fetch Slack connection status and project channel mapping
  useEffect(() => {
    if (!organizationId || !readsAppSecOnlyTabs) return;
    getSlackInstallation(organizationId)
      .then((installation) => {
        // A 200 carrying isConfigured=false means "this organization has no
        // Slack installation" — a normal answer to a presence probe, not a
        // connection. Resolving is no longer proof of an installation: the
        // endpoint stopped answering 404 for absence. Only a rejection below
        // is a genuine failure. Same guard as SlackIntegrationModal.
        if (!installation?.isConfigured) {
          setIsSlackConnected(false);
          return;
        }
        setIsSlackConnected(true);
        if (projectId) {
          getProjectSlackChannel(projectId)
            .then((mapping) => {
              if (mapping?.isConfigured) {
                setSlackChannelName(mapping.channelName);
              }
            })
            .catch(() => {
              // No channel configured yet
            });
        }
      })
      .catch(() => {
        setIsSlackConnected(false);
      });
  }, [organizationId, projectId, readsAppSecOnlyTabs]);

  // Jira connection status now comes from /project/:id (isJiraLinked). The
  // dedicated jira/installation lookup is gone; we only fan out to
  // listJiraProjects + getProjectJiraConfig when we already know Jira is
  // installed.
  useEffect(() => {
    if (!organizationId || !readsAppSecOnlyTabs) return;
    if (isJiraLinkedFromHook === null) return; // project still loading
    if (isJiraLinkedFromHook === false) {
      setIsJiraConnected(false);
      setJiraConfig(null);
      return;
    }
    setIsJiraConnected(true);
    listJiraProjects(organizationId)
      .then((projects) => setJiraProjects(projects))
      .catch(() => {});
    if (projectId) {
      getProjectJiraConfig(organizationId, projectId)
        .then((config) => {
          if (config?.isConfigured) {
            setJiraConfig(config);
          }
        })
        .catch(() => {});
    }
  }, [organizationId, projectId, isJiraLinkedFromHook, readsAppSecOnlyTabs]);

  const handleJiraProjectChange = async (jiraProject: JiraProject | null) => {
    if (!projectId || !organizationId) return;
    if (!jiraProject) {
      try {
        await removeProjectJiraConfig(organizationId, projectId);
        setJiraConfig(null);
        toast.success(t('pages.projectSetting.toast.jiraConfigRemoveSuccess'));
      } catch {
        toast.error(t('pages.projectSetting.toast.jiraConfigRemoveError'));
      }
      return;
    }
    try {
      await setProjectJiraConfig(organizationId, projectId, {
        jiraProjectId: jiraProject.projectId,
        jiraProjectKey: jiraProject.key,
        jiraProjectName: jiraProject.name,
        allowedBranches: jiraConfig?.allowedBranches || [],
        autoCreateEnabled: jiraConfig?.autoCreateEnabled || false,
      });
      setJiraConfig({
        jiraProjectId: jiraProject.projectId,
        jiraProjectKey: jiraProject.key,
        jiraProjectName: jiraProject.name,
        allowedBranches: jiraConfig?.allowedBranches || [],
        autoCreateEnabled: jiraConfig?.autoCreateEnabled || false,
        isConfigured: true,
      });
      toast.success(t('pages.projectSetting.toast.jiraConfigUpdateSuccess'));
    } catch {
      toast.error(t('pages.projectSetting.toast.jiraConfigUpdateError'));
    }
  };

  const handleJiraAllowedBranchesChange = async (branches: string[]) => {
    if (!projectId || !organizationId || !jiraConfig) return;
    try {
      await setProjectJiraConfig(organizationId, projectId, {
        jiraProjectId: jiraConfig.jiraProjectId,
        jiraProjectKey: jiraConfig.jiraProjectKey,
        jiraProjectName: jiraConfig.jiraProjectName,
        allowedBranches: branches,
        autoCreateEnabled: jiraConfig.autoCreateEnabled || false,
      });
      setJiraConfig({ ...jiraConfig, allowedBranches: branches });
      toast.success(t('pages.projectSetting.toast.jiraConfigUpdateSuccess'));
    } catch {
      toast.error(t('pages.projectSetting.toast.jiraConfigUpdateError'));
    }
  };

  const handleJiraAutoCreateToggle = async () => {
    if (!projectId || !organizationId || !jiraConfig) return;
    const newValue = !jiraConfig.autoCreateEnabled;
    try {
      await setProjectJiraConfig(organizationId, projectId, {
        jiraProjectId: jiraConfig.jiraProjectId,
        jiraProjectKey: jiraConfig.jiraProjectKey,
        jiraProjectName: jiraConfig.jiraProjectName,
        allowedBranches: jiraConfig.allowedBranches || [],
        autoCreateEnabled: newValue,
      });
      setJiraConfig({ ...jiraConfig, autoCreateEnabled: newValue });
      toast.success(t('pages.projectSetting.toast.jiraConfigUpdateSuccess'));
    } catch {
      toast.error(t('pages.projectSetting.toast.jiraConfigUpdateError'));
    }
  };

  // Linear connection status comes from /project/:id (isLinearLinked), like
  // Jira's: the teams and the project's config are read only when the
  // organization has Linear, and, like the Issues tab itself, only in AppSec.
  useEffect(() => {
    // The page is reused across :projectId without a remount: a project starts
    // from nothing, never from the previous one's config, options or saves. A
    // save still on its way for the previous project is dropped by its
    // generation (below), and the queue starts empty.
    linearGenerationRef.current += 1;
    linearIntendedRef.current = null;
    linearConfirmedRef.current = null;
    linearConfigLoadedRef.current = false;
    linearSaveChainRef.current = Promise.resolve();
    setLinearConfig(null);
    setLinearTeamOptions(null);
    setIsLinearConfigLoaded(false);

    if (!organizationId || !readsAppSecOnlyTabs) return;
    if (isLinearLinkedFromHook !== true) {
      // Still loading, or no Linear in this organization: nothing to read.
      setIsLinearConnected(false);
      setLinearTeams((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    setIsLinearConnected(true);
    let cancelled = false;
    listLinearTeams(organizationId)
      .then((teams) => {
        if (!cancelled) setLinearTeams(teams);
      })
      .catch(() => {});
    if (projectId) {
      getProjectLinearConfig(organizationId, projectId)
        .then((config) => {
          if (cancelled) return;
          // A project with no config answers isConfigured=false: it has none, and
          // that is as settled as having one. A failed read settles nothing, so
          // the controls stay off: a save would replace a config nobody has seen.
          const stored = config?.isConfigured ? config : null;
          linearIntendedRef.current = stored;
          linearConfirmedRef.current = stored;
          linearConfigLoadedRef.current = true;
          setLinearConfig(stored);
          setIsLinearConfigLoaded(true);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [organizationId, projectId, isLinearLinkedFromHook, readsAppSecOnlyTabs]);

  // The projects, labels and members of the project's team. They belong to one
  // team: whenever the team changes, the previous team's are dropped at once and
  // the new team's are read.
  const linearTeamId = linearConfig?.teamId ?? "";
  useEffect(() => {
    setLinearTeamOptions(null);
    if (!organizationId || !readsAppSecOnlyTabs || !isLinearConnected || !linearTeamId) return;
    let cancelled = false;
    getLinearTeamOptions(organizationId, linearTeamId)
      .then((options) => {
        if (!cancelled) setLinearTeamOptions(options);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [organizationId, readsAppSecOnlyTabs, isLinearConnected, linearTeamId]);

  // A refusal from the server is a closed list of codes, each shown as a fixed
  // translated sentence; any other failure gets the generic one. The server's
  // own text is never shown.
  const linearErrorMessage = (error: unknown, fallbackKey: string) => {
    const refusal = linearRefusalOf(error);
    return refusal ? t(linearRefusalKey(refusal)) : t(fallbackKey);
  };

  // The server replaces the whole config on each save, so every save sends the
  // whole config, and two edits must never be computed from the same old one:
  //  - linearIntendedRef is the config the user wants (what the page shows, set
  //    at once so a multi-select does not bounce back while the request is out);
  //    each edit starts from it, never from the render's copy;
  //  - linearConfirmedRef is the last config the server took, where a refused
  //    save rolls back to;
  //  - saves run one at a time, each sending the latest intended config, so a
  //    save that finds the server already has it sends nothing.
  // The generation drops whatever a previous project left in flight.
  const enqueueLinearSave = () => {
    if (!projectId || !organizationId) return;
    const generation = linearGenerationRef.current;
    const save = async () => {
      if (generation !== linearGenerationRef.current) return;
      const toSend = linearIntendedRef.current;
      if (toSend === linearConfirmedRef.current) return;
      try {
        if (toSend) {
          await setProjectLinearConfig(organizationId, projectId, {
            teamId: toSend.teamId,
            linearProjectId: toSend.linearProjectId || undefined,
            labelIds: toSend.labels.map((label) => label.id),
            allowedBranches: toSend.allowedBranches,
            autoCreateEnabled: toSend.autoCreateEnabled,
          });
        } else {
          await removeProjectLinearConfig(organizationId, projectId);
        }
        if (generation !== linearGenerationRef.current) return;
        linearConfirmedRef.current = toSend;
        toast.success(
          t(toSend ? 'pages.projectSetting.toast.linearConfigUpdateSuccess' : 'pages.projectSetting.toast.linearConfigRemoveSuccess'),
        );
      } catch (error) {
        if (generation !== linearGenerationRef.current) return;
        // Back to what the server has: the edits made since are undone with the
        // one it refused, and the saves queued behind find nothing left to send.
        const confirmed = linearConfirmedRef.current;
        linearIntendedRef.current = confirmed;
        setLinearConfig(confirmed);
        toast.error(
          linearErrorMessage(
            error,
            toSend ? 'pages.projectSetting.toast.linearConfigUpdateError' : 'pages.projectSetting.toast.linearConfigRemoveError',
          ),
        );
      }
    };
    linearSaveChainRef.current = linearSaveChainRef.current.then(save);
    return linearSaveChainRef.current;
  };

  // Shows the new config at once and queues its save.
  const changeLinearConfig = (next: LinearProjectConfig | null) => {
    linearIntendedRef.current = next;
    setLinearConfig(next);
    return enqueueLinearSave();
  };

  const handleLinearTeamChange = async (teamId: string | null) => {
    // Until the stored config has been read, a team chosen would be saved over
    // its branches and auto-create.
    if (!linearConfigLoadedRef.current) return;
    const current = linearIntendedRef.current;
    if (!teamId) {
      await changeLinearConfig(null);
      return;
    }
    if (teamId === current?.teamId) return;
    const team = linearTeams.find((candidate) => candidate.id === teamId);
    if (!team) return;
    // The project and labels belong to the previous team: none of them goes with
    // the new one. The branches and auto-create do not depend on the team.
    await changeLinearConfig({
      isConfigured: true,
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name,
      linearProjectId: "",
      linearProjectName: "",
      labels: [],
      allowedBranches: current?.allowedBranches || [],
      autoCreateEnabled: current?.autoCreateEnabled || false,
    });
  };

  const handleLinearProjectChange = async (id: string | null) => {
    const current = linearIntendedRef.current;
    if (!current) return;
    const chosen = id ? linearTeamOptions?.projects.find((project) => project.id === id) : undefined;
    // Only one of the team's own projects can be chosen.
    if (id && !chosen) return;
    await changeLinearConfig({
      ...current,
      linearProjectId: chosen?.id ?? "",
      linearProjectName: chosen?.name ?? "",
    });
  };

  const handleLinearLabelsChange = async (ids: string[]) => {
    const current = linearIntendedRef.current;
    if (!current) return;
    const known = [...(linearTeamOptions?.labels ?? []), ...current.labels];
    const labels = ids.flatMap((id) => {
      const label = known.find((candidate) => candidate.id === id);
      return label ? [label] : [];
    });
    await changeLinearConfig({ ...current, labels });
  };

  const handleLinearAllowedBranchesChange = async (branches: string[]) => {
    const current = linearIntendedRef.current;
    if (!current) return;
    await changeLinearConfig({ ...current, allowedBranches: branches });
  };

  const handleLinearAutoCreateToggle = async () => {
    const current = linearIntendedRef.current;
    if (!current) return;
    await changeLinearConfig({ ...current, autoCreateEnabled: !current.autoCreateEnabled });
  };

  const handleConfigureSlackChannel = async () => {
    if (!organizationId || !projectId) return;
    try {
      const channels = await listSlackChannels(organizationId);
      // For now, prompt user to pick from available channels
      // This will be replaced by SlackChannelSelector modal
      if (channels.length > 0) {
        const firstChannel = channels[0];
        await setProjectSlackChannel(organizationId, projectId, firstChannel.channelId, firstChannel.name);
        setSlackChannelName(firstChannel.name);
        toast.success(t('pages.projectSetting.toast.slackChannelUpdateSuccess'));
      }
    } catch {
      toast.error(t('pages.projectSetting.toast.slackChannelUpdateError'));
    }
  };

  // Notification preference handlers
  const handleSeverityThresholdChange = (severities: string[]) => {
    setNotifSeverityThreshold(severities);
    if (projectId) {
      updateProject(projectId, { notifSeverityThreshold: severities }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleScannerTypesChange = (types: string[]) => {
    setNotifScannerTypes(types);
    if (projectId) {
      updateProject(projectId, { notifScannerTypes: types }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleScanCompleteEmailToggle = () => {
    const newValue = !scanCompleteEmailEnabled;
    setScanCompleteEmailEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { scanCompleteEmailEnabled: newValue }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleScanCompleteSlackToggle = () => {
    const newValue = !scanCompleteSlackEnabled;
    setScanCompleteSlackEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { scanCompleteSlackEnabled: newValue }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleWeeklyReportSlackToggle = () => {
    const newValue = !weeklyReportSlackEnabled;
    setWeeklyReportSlackEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { weeklyReportSlackEnabled: newValue }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleMonthlyReportSlackToggle = () => {
    const newValue = !monthlyReportSlackEnabled;
    setMonthlyReportSlackEnabled(newValue);
    if (projectId) {
      updateProject(projectId, { monthlyReportSlackEnabled: newValue }).catch((error: any) => {
        toast.error(t('pages.projectSetting.toast.notifUpdateError'));
        throw error;
      });
    }
  };

  const handleSecurityContextFieldChange = (field: string, value: any) => {
    const getters: Record<string, () => any> = {
      environment: () => scEnvironment,
      internetExposure: () => scInternetExposure,
      deploymentType: () => scDeploymentType,
      dataClassification: () => scDataClassification,
      handlesPii: () => scHandlesPii,
      handlesPaymentData: () => scHandlesPaymentData,
      businessCriticality: () => scBusinessCriticality,
      userBaseSize: () => scUserBaseSize,
      complianceFrameworks: () => scComplianceFrameworks,
      safetyCritical: () => scSafetyCritical,
      networkSegmentation: () => scNetworkSegmentation,
    };
    const setters: Record<string, (v: any) => void> = {
      environment: setScEnvironment,
      internetExposure: setScInternetExposure,
      deploymentType: setScDeploymentType,
      dataClassification: setScDataClassification,
      handlesPii: setScHandlesPii,
      handlesPaymentData: setScHandlesPaymentData,
      businessCriticality: setScBusinessCriticality,
      userBaseSize: setScUserBaseSize,
      complianceFrameworks: setScComplianceFrameworks,
      safetyCritical: setScSafetyCritical,
      networkSegmentation: setScNetworkSegmentation,
    };

    // Save previous value for rollback
    const previousValue = getters[field]?.();
    setters[field]?.(value);

    // Persist to API
    if (projectId) {
      updateProjectSecurityContext(projectId, { [field]: value })
        .then(() => {
          setIsSecurityContextCustomized(true);
          toast.success(t('components.securityContextSettings.saveSuccess'));
        })
        .catch(() => {
          // Rollback on failure
          setters[field]?.(previousValue);
          toast.error(t('components.securityContextSettings.saveError'));
        });
    }
  };

  useEffect(() => {
    clearScannerStorage();
  }, []);

  return (
    <ProjectSettingTemplate
      projectTitle={projectTitle}
      projectId={projectId}
      teamName={teamName}
      teamId={teamId}
      applicationType={applicationType}
      onApplicationTypeChange={handleApplicationTypeChange}
      onDisableProject={handleDisableProject}
      onDeleteProject={handleDeleteProject}
      analysisFrequency={analysisFrequency}
      onAnalysisFrequencyChange={handleAnalysisFrequencyChange}
      aiMergeRequestEnabled={aiMergeRequestEnabled}
      onAiMergeRequestToggle={handleAiMergeRequestToggle}
      improvingResultsEnabled={improvingResultsEnabled}
      onCybeAnalysisToggle={handleCybeAnalysisToggle}
      scanOnCommitEnabled={scanOnCommitEnabled}
      onScanOnCommitToggle={handleScanOnCommitToggle}
      scanTypes={scanTypes}
      configurationSast={configurationSast}
      configurationIac={configurationIac}
      configurationSca={configurationSca}
      configurationContainer={configurationContainer}
      configurationSecret={configurationSecret}
      onScanTypeToggle={handleScanTypeToggle}
      onConfigureSast={handleConfigureSast}
      onConfigureContainer={handleConfigureContainer}
      onConfigureSecret={handleConfigureSecret}
      onConfigureIac={handleConfigureIac}
      onConfigureSca={handleConfigureSca}
      project={project}
      isSlackConnected={isSlackConnected}
      slackChannelName={slackChannelName}
      onConfigureSlackChannel={handleConfigureSlackChannel}
      onSlackChannelChange={setSlackChannelName}
      notifSeverityThreshold={notifSeverityThreshold}
      onSeverityThresholdChange={handleSeverityThresholdChange}
      notifScannerTypes={notifScannerTypes}
      onScannerTypesChange={handleScannerTypesChange}
      scanCompleteEmailEnabled={scanCompleteEmailEnabled}
      onScanCompleteEmailToggle={handleScanCompleteEmailToggle}
      scanCompleteSlackEnabled={scanCompleteSlackEnabled}
      onScanCompleteSlackToggle={handleScanCompleteSlackToggle}
      weeklyReportEnabled={weeklyReportEnabled}
      onWeeklyReportToggle={handleWeeklyReportToggle}
      weeklyReportSlackEnabled={weeklyReportSlackEnabled}
      onWeeklyReportSlackToggle={handleWeeklyReportSlackToggle}
      monthlyReportEnabled={monthlyReportEnabled}
      onMonthlyReportToggle={handleMonthlyReportToggle}
      monthlyReportSlackEnabled={monthlyReportSlackEnabled}
      onMonthlyReportSlackToggle={handleMonthlyReportSlackToggle}
      emailAlertEnabled={emailAlertEnabled}
      onEmailAlertToggle={handleEmailAlertToggle}
      onConfigureEmailAlert={handleConfigureEmailAlert}
      incidentCreationOption={incidentCreationOption}
      onIncidentCreationOptionChange={handleIncidentCreationOptionChange}
      isProjectLinkedToGithub={isProjectLinkedToGithub}
      onUnlinkGithubProject={handleUnlinkGithubProject}
      isProjectLinkedToGitlab={isProjectLinkedToGitlab}
      onUnlinkGitlabProject={handleUnlinkGitlabProject}
      githubIssueEnabled={githubIssueEnabled}
      onGithubIssueToggle={handleGithubIssueToggle}
      gitlabIssueEnabled={gitlabIssueEnabled}
      onGitlabIssueToggle={handleGitlabIssueToggle}
      isJiraConnected={isJiraConnected}
      jiraProjects={jiraProjects}
      jiraConfig={jiraConfig}
      onJiraProjectChange={handleJiraProjectChange}
      onJiraAllowedBranchesChange={handleJiraAllowedBranchesChange}
      onJiraAutoCreateToggle={handleJiraAutoCreateToggle}
      isLinearConnected={isLinearConnected}
      linearTeams={linearTeams}
      linearTeamOptions={linearTeamOptions}
      linearConfig={linearConfig}
      isLinearConfigLoading={!isLinearConfigLoaded}
      onLinearTeamChange={handleLinearTeamChange}
      onLinearProjectChange={handleLinearProjectChange}
      onLinearLabelsChange={handleLinearLabelsChange}
      onLinearAllowedBranchesChange={handleLinearAllowedBranchesChange}
      onLinearAutoCreateToggle={handleLinearAutoCreateToggle}
      issueCreationMode={issueCreationMode}
      onIssueCreationModeChange={handleIssueCreationModeChange}
      issueCreationBranches={issueCreationBranches}
      onIssueCreationBranchesChange={handleIssueCreationBranchesChange}
      branches={combinedBranches}
      issueBranchOptions={issueBranchList.branches}
      issueBranchesAsync
      onIssueBranchSearchChange={issueBranchList.setSearch}
      onIssueBranchLoadMore={issueBranchList.loadMore}
      issueBranchesHasMore={issueBranchList.hasMore}
      issueBranchesSearching={issueBranchList.searching}
      issueBranchesLoadingMore={issueBranchList.loadingMore}
      referenceBranch={referenceBranch}
      onReferenceBranchChange={handleReferenceBranchChange}
      securityContextEnvironment={scEnvironment}
      securityContextInternetExposure={scInternetExposure}
      securityContextDeploymentType={scDeploymentType}
      securityContextDataClassification={scDataClassification}
      securityContextHandlesPii={scHandlesPii}
      securityContextHandlesPaymentData={scHandlesPaymentData}
      securityContextBusinessCriticality={scBusinessCriticality}
      securityContextUserBaseSize={scUserBaseSize}
      securityContextComplianceFrameworks={scComplianceFrameworks}
      securityContextSafetyCritical={scSafetyCritical}
      securityContextNetworkSegmentation={scNetworkSegmentation}
      onSecurityContextFieldChange={handleSecurityContextFieldChange}
      isSecurityContextCustomized={isSecurityContextCustomized}
      loading={loading}
    />
  );
};

export default ProjectSettingPage;
