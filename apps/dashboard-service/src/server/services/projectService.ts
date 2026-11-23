import gatewayAPI from "../api/gatewayAPI";
import {
  PaginatedProject,
  PaginatedProjectAalysis,
  Project,
  ProjectDeleteResponseDto,
  ProjectSecurityContext,
  ProjectStatistics,
  ProjectUpdateResponseDto
} from "../interfaces/Project";
import { profiler } from "@/utils/profiler";
import type { Product } from "@/utils/product";

// Module-level cache to deduplicate identical fetchProject requests
const pendingProjectRequests = new Map<string, Promise<Project>>();

// TTL-cached resolved project payloads. The same Project resource is
// consumed by ~5 hooks (useProject, useProjectPageData, useProjectOverview,
// useCurrentProject, useProjectAccess) and by a closed space's project page,
// which is registered on 4 sibling routes; tab switching there remounts the page
// and re-runs the useEffect, producing one GET /project/:id per click
// without this guard. Keep the resolved value reachable for a short
// window so adjacent consumers + remount-on-route-change patterns reuse
// it. Manual mutations (updateProject / deleteProject) invalidate.
interface ProjectCacheEntry {
  data: Project;
  expiresAt: number;
}
const projectCache = new Map<string, ProjectCacheEntry>();
const PROJECT_CACHE_TTL_MS = 60_000;

/**
 * Bust the resolved-project cache.
 *   - No argument: drop every entry (call this between unit tests).
 *   - With projectId: drop just that entry (consumers that just wrote to
 *     the resource and need their next fetchProject to be fresh).
 */
export const invalidateProjectCache = (projectId?: string): void => {
  if (projectId === undefined) {
    projectCache.clear();
    return;
  }
  projectCache.delete(projectId);
};

// Module-level cache to deduplicate identical in-flight org-projects requests.
// The "/" page requests this list from several places at once — the paginated
// page list and the always-mounted global chat drawer (which mounts the hook
// twice). Without this guard each caller fires its own HTTP request for the
// exact same (org, page, pageSize, search) tuple.
const pendingOrgProjectsRequests = new Map<
  string,
  Promise<PaginatedProjectAalysis>
>();

export const fetchProjectsForOrganization = profiler('fetchProjectsForOrganization')(async (
  organizationId: string,
  page: number,
  pageSize: number,
  searchQuery: string
): Promise<PaginatedProjectAalysis> => {
  const requestKey = `${organizationId}|${page}|${pageSize}|${searchQuery}`;
  const inFlight = pendingOrgProjectsRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = (async () => {
    try {
      const response = await gatewayAPI.get(
        `/organization/${organizationId}/projects`,
        {
          params: {
            page,
            pageSize,
            search: searchQuery,
          },
        }
      );
      return response.data;
    } catch (error: any) {
      return error;
    } finally {
      // In-flight dedup only — drop the key once settled so a later
      // (non-concurrent) call still re-fetches fresh data.
      pendingOrgProjectsRequests.delete(requestKey);
    }
  })();

  pendingOrgProjectsRequests.set(requestKey, requestPromise);
  return requestPromise;
});

/**
 * Org-wide home KPI cards. Decoupled from the project list (which used to carry
 * them) so that list returns fast; this loads the cards independently.
 */
export const fetchOrganizationMainStatistics = profiler(
  "fetchOrganizationMainStatistics",
)(async (organizationId: string): Promise<ProjectStatistics> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/main-statistics`,
  );
  return response.data;
});

export const fetchAllProjectsTeam = profiler('fetchAllProjectsTeam')(async (
  teamId: string,
  page: number,
  pageSize: number,
  searchQuery: string
): Promise<PaginatedProject> => {
  try {
    const response = await gatewayAPI.get(`/team/${teamId}/projects`, {
      params: {
        page,
        pageSize,
        search: searchQuery,
      },
    });
    return response.data;
  } catch (error) {
    throw error;
  }
});

export const fetchProject = profiler('fetchProject')(async (projectId: string): Promise<Project> => {
  // Return cached resolved value if still within the TTL afterglow.
  const cached = projectCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  if (cached) {
    projectCache.delete(projectId);
  }

  // Check if there's already a pending request for this project
  if (pendingProjectRequests.has(projectId)) {
    return pendingProjectRequests.get(projectId)!;
  }

  const requestPromise = (async () => {
    try {
      const response = await gatewayAPI.get(`/project/${projectId}`);
      const data = response.data as Project;

      const project: Project = {
        projectId: data.projectId,
        name: data.name,
        teamId: data.teamId,
        teamName: data.teamName,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        applicationType: data.applicationType,
        analysisFrequency: data.analysisFrequency,
        emailAlertEnabled: data.emailAlertEnabled,
        monthlyReportEnabled: data.monthlyReportEnabled,
        weeklyReportEnabled: data.weeklyReportEnabled,
        sastEnabled: data.sastEnabled,
        dastEnabled: data.dastEnabled,
        scaEnabled: data.scaEnabled,
        containerEnabled: data.containerEnabled,
        apiEnabled: data.apiEnabled,
        iacEnabled: data.iacEnabled,
        secretEnabled: data.secretEnabled,
        aibomEnabled: data.aibomEnabled,
        sastFastScanEnabled: data.sastFastScanEnabled,
        diffScanMinSeverity: data.diffScanMinSeverity,
        sastSeverities: data.sastSeverities,
        iacSeverities: data.iacSeverities,
        scaSeverities: data.scaSeverities,
        containerSeverities: data.containerSeverities,
        secretSeverities: data.secretSeverities,
        incidentCreationOption: data.incidentCreationOption,
        aiMergeRequestEnabled: data.aiMergeRequestEnabled,
        improvingResultsEnabled: data.improvingResultsEnabled,
        scaTransitiveDependenciesEnabled: data.scaTransitiveDependenciesEnabled,
        scaDevelopmentDependenciesEnabled: data.scaDevelopmentDependenciesEnabled,
        scaReachabilityPriorityEnabled: data.scaReachabilityPriorityEnabled,
        scaReachabilityStatusEnabled: data.scaReachabilityStatusEnabled,
        sortsVulnerabilitiesEnabled: data.sortsVulnerabilitiesEnabled,
        securityChampionEnabled: data.securityChampionEnabled,
        parsedBranches: data.parsedBranches,
        agentCategoriesSast: data.agentCategoriesSast,
        agentCategoriesIac: data.agentCategoriesIac,
        agentCategoriesCicd: data.agentCategoriesCicd,
        githubIssueEnabled: data.githubIssueEnabled,
        gitlabIssueEnabled: data.gitlabIssueEnabled,
        issueCreationMode: data.issueCreationMode,
        issueCreationBranches: data.issueCreationBranches,
        isGithubLinked: data.isGithubLinked,
        isGitlabLinked: data.isGitlabLinked,
        linkedRepository: data.linkedRepository,
        isJiraLinked: data.isJiraLinked,
        isLinearLinked: data.isLinearLinked,
        referenceBranch: data.referenceBranch,
        securityContext: data.securityContext,
        defaultBranch: (data as any).defaultBranch ?? '',
        notifSeverityThreshold: data.notifSeverityThreshold,
        notifScannerTypes: data.notifScannerTypes,
        zeroDayEmailEnabled: data.zeroDayEmailEnabled,
        zeroDaySlackEnabled: data.zeroDaySlackEnabled,
        zeroDaySeverityThreshold: data.zeroDaySeverityThreshold,
        scanCompleteEmailEnabled: data.scanCompleteEmailEnabled,
        scanCompleteSlackEnabled: data.scanCompleteSlackEnabled,
        weeklyReportSlackEnabled: data.weeklyReportSlackEnabled,
        monthlyReportSlackEnabled: data.monthlyReportSlackEnabled,
        detectedLanguages: data.detectedLanguages,
        codeGraphSupported: (data as any).codeGraphSupported,
        // Backend support ships later — default to enabled when the payload
        // omits the field so existing/older gateway responses don't hide it.
        // Fail-open here by design; the gateway's user-project-resolve controller
        // fail-closes the same flag with `?? false` — see
        // gateway-service/src/modules/project/user-project-resolve.controller.ts.
        // The asymmetry is intentional; do not "unify" them.
        vibedefendEnabled: data.vibedefendEnabled ?? true,
        scanOnCommitEnabled: data.scanOnCommitEnabled ?? true,
      };

      projectCache.set(projectId, {
        data: project,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
      });
      return project;
    } finally {
      // Clean up pending request after completion
      pendingProjectRequests.delete(projectId);
    }
  })();

  pendingProjectRequests.set(projectId, requestPromise);
  return requestPromise;
});

export const createProject = profiler('createProject')(async (
  teamId: string,
  projectName: string,
  aiMergeRequestEnabled?: boolean,
  improvingResultsEnabled?: boolean,
  sortsVulnerabilitiesEnabled?: boolean,
  securityChampionEnabled?: boolean,
  securityContext?: Partial<ProjectSecurityContext>,
  /**
   * The space the project is created from. An AppSec project counts against
   * the AppSec project limit; one of another space does not. Absent: the backend's
   * default.
   */
  product?: Product,
): Promise<Project> => {
  try {
    const response = await gatewayAPI.post(`/team/${teamId}/project`, {
      name: projectName,
      aiMergeRequestEnabled,
      improvingResultsEnabled,
      sortsVulnerabilitiesEnabled,
      securityChampionEnabled,
      ...(securityContext ? { securityContext } : {}),
      ...(product ? { product } : {}),
    });
    return response.data;
  } catch (error) {
    throw error;
  }
});

export interface CreateProjectAndLinkRepositoryParams {
  teamId: string;
  projectName: string;
  aiMergeRequestEnabled?: boolean;
  improvingResultsEnabled?: boolean;
  sortsVulnerabilitiesEnabled?: boolean;
  securityChampionEnabled?: boolean;
  securityContext?: Partial<ProjectSecurityContext>;
  /** The space the project is created from (see `createProject`). */
  product?: Product;
  /**
   * When provided, the helper will call `link(projectId, repositoryId)` after
   * a successful create. If linking fails, the just-created project is
   * deleted to avoid orphan projects with no repository linkage.
   */
  repoLink?: {
    repositoryId: string;
    link: (projectId: string, repositoryId: string) => Promise<void>;
  };
}

export const createProjectAndLinkRepository = profiler('createProjectAndLinkRepository')(async (
  params: CreateProjectAndLinkRepositoryParams,
): Promise<Project> => {
  const created = await createProject(
    params.teamId,
    params.projectName,
    params.aiMergeRequestEnabled,
    params.improvingResultsEnabled,
    params.sortsVulnerabilitiesEnabled,
    params.securityChampionEnabled,
    params.securityContext,
    params.product,
  );
  if (!params.repoLink) {
    return created;
  }
  try {
    await params.repoLink.link(created.projectId, params.repoLink.repositoryId);
    return created;
  } catch (linkErr) {
    try {
      await deleteProject(created.projectId);
    } catch (deleteErr) {
      console.error(
        'Rollback delete failed for project %s:',
        created.projectId,
        deleteErr,
      );
    }
    throw linkErr;
  }
});

export const updateProject = profiler('updateProject')(async (
  projectId: string,
  updateData: Partial<Project>
): Promise<Project> => {
  try {
    const response = await gatewayAPI.patch(
      `/project/${projectId}`,
      updateData
    );
    const data = response.data as ProjectUpdateResponseDto;
    const projectData = data.projectInformations;

    const updatedProject: Project = {
      projectId: projectData.projectId,
      name: projectData.name,
      teamId: projectData.teamId,
      teamName: projectData.teamName,
      createdAt: projectData.createdAt,
      updatedAt: projectData.updatedAt,
      applicationType: projectData.applicationType,
      analysisFrequency: projectData.analysisFrequency,
      emailAlertEnabled: projectData.emailAlertEnabled,
      monthlyReportEnabled: projectData.monthlyReportEnabled,
      weeklyReportEnabled: projectData.weeklyReportEnabled,
      sastEnabled: projectData.sastEnabled,
      dastEnabled: projectData.dastEnabled,
      scaEnabled: projectData.scaEnabled,
      containerEnabled: projectData.containerEnabled,
      apiEnabled: projectData.apiEnabled,
      iacEnabled: projectData.iacEnabled,
      secretEnabled: projectData.secretEnabled,
      aibomEnabled: projectData.aibomEnabled,
      sastFastScanEnabled: projectData.sastFastScanEnabled,
      diffScanMinSeverity: projectData.diffScanMinSeverity,
      sastSeverities: projectData.sastSeverities,
      iacSeverities: projectData.iacSeverities,
      scaSeverities: projectData.scaSeverities,
      containerSeverities: projectData.containerSeverities,
      secretSeverities: projectData.secretSeverities,
      incidentCreationOption: projectData.incidentCreationOption,
      aiMergeRequestEnabled: projectData.aiMergeRequestEnabled,
      improvingResultsEnabled: projectData.improvingResultsEnabled,
      sortsVulnerabilitiesEnabled: projectData.sortsVulnerabilitiesEnabled,
      securityChampionEnabled: projectData.securityChampionEnabled,
      scaTransitiveDependenciesEnabled: projectData.scaTransitiveDependenciesEnabled,
      scaDevelopmentDependenciesEnabled: projectData.scaDevelopmentDependenciesEnabled,
      scaReachabilityPriorityEnabled: projectData.scaReachabilityPriorityEnabled,
      scaReachabilityStatusEnabled: projectData.scaReachabilityStatusEnabled,
      ingestionProjectId: projectData.ingestionProjectId,
      parsedBranches: projectData.parsedBranches,
      agentCategoriesSast: projectData.agentCategoriesSast,
      agentCategoriesIac: projectData.agentCategoriesIac,
      agentCategoriesCicd: projectData.agentCategoriesCicd,
      notifSeverityThreshold: projectData.notifSeverityThreshold,
      notifScannerTypes: projectData.notifScannerTypes,
      zeroDayEmailEnabled: projectData.zeroDayEmailEnabled,
      zeroDaySlackEnabled: projectData.zeroDaySlackEnabled,
      zeroDaySeverityThreshold: projectData.zeroDaySeverityThreshold,
      scanCompleteEmailEnabled: projectData.scanCompleteEmailEnabled,
      scanCompleteSlackEnabled: projectData.scanCompleteSlackEnabled,
      weeklyReportSlackEnabled: projectData.weeklyReportSlackEnabled,
      monthlyReportSlackEnabled: projectData.monthlyReportSlackEnabled,
      // Backend support ships later — default to enabled when the payload
      // omits the field so existing/older gateway responses don't hide it.
      vibedefendEnabled: projectData.vibedefendEnabled ?? true,
      scanOnCommitEnabled: projectData.scanOnCommitEnabled ?? true,
    };

    // Settings just changed — any sibling consumer that calls fetchProject
    // next must see the new value.
    invalidateProjectCache(projectId);
    return updatedProject;
  } catch (error) {
    throw error;
  }
});

export const deleteProject = profiler('deleteProject')(async (
  projectId: string
): Promise<ProjectDeleteResponseDto> => {
  try {
    const response = await gatewayAPI.delete(`/project/${projectId}`);
    invalidateProjectCache(projectId);
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchProjectSecurityContext = profiler('fetchProjectSecurityContext')(async (
  projectId: string
): Promise<ProjectSecurityContext> => {
  try {
    const response = await gatewayAPI.get(`/project/${projectId}/security-context`);
    return response.data;
  } catch (error) {
    throw error;
  }
});

export const updateProjectSecurityContext = profiler('updateProjectSecurityContext')(async (
  projectId: string,
  data: Partial<ProjectSecurityContext>
): Promise<ProjectSecurityContext> => {
  try {
    const response = await gatewayAPI.put(`/project/${projectId}/security-context`, data);
    // useProjectPageData reads the Security Context (isCustomized,
    // updatedAt) from the cached fetchProject answer, which useProject also
    // returns: the next read must see what was just saved.
    invalidateProjectCache(projectId);
    return response.data;
  } catch (error) {
    throw error;
  }
});
