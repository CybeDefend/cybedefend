import qs from 'qs';
import gatewayAPI from '../api/gatewayAPI';
import { isAxiosError } from 'axios';
import {
  PaginatedContainerImagesResults,
  PaginatedContainerPackagesResults,
  PaginatedScaPackagesResults,
  PaginatedGroupedContainerImagesResults,
} from '../interfaces/Packages';
import {
  CicdVulnerabilityResult,
  ContainerVulnerabilityResult,
  GetProjectOverviewResponse,
  GetProjectBranchesResponse,
  GetOrganizationOverviewResponse,
  OrganizationOverviewFilters,
  OrganizationSeverityDistributionResponse,
  OrganizationStateDistributionResponse,
  OrganizationVulnerabilitiesOverTimeResponse,
  IacVulnerabilityResult,
  PaginatedVulnerabilityResults,
  SastVulnerabilityResult,
  ScaVulnerabilityResult,
  SecretVulnerabilityResult,
  UpdateResultRequestDto,
  VulnerabilityResult,
  VulnerabilityByIdResponse,
  GenerateOwaspReportResponse,
  GenerateCweReportResponse,
  GetGeneratedReportResponse,
  GenerateAggregatedReportResponse,
  GetGeneratedAggregatedReportResponse,
  GenerateBatchReportBodyDto,
  ProjectBranchSelection,
  GetGroupedVulnerabilitiesResponse,
  GetGroupedScaVulnerabilitiesResponse,
  GetGroupedContainerVulnerabilitiesResponse,
  GetVulnerabilityWithSimilarResponse,
  BatchUpdateVulnerabilitiesRequest,
  BatchUpdateVulnerabilitiesResponse,
  EnqueueBatchUpdateResponse,
  PriorityDecompositionResponse,
  GetTopVulnerabilitiesResponse,
} from '../interfaces/Vulnerability';
import { ProjectDeleteResponseDto } from '../interfaces/Project';
import { profiler } from '@/utils/profiler';

// Exploitability filter bridge.
// Backend (gateway DTO) expects `exploitabilityVerdict` with one of the four
// verdicts it stores. The frontend also carries a `not_evaluated` sentinel
// that represents a NULL verdict — it must never be forwarded. The default
// "everything selected" state must not narrow the backend result either,
// otherwise the SQL IN clause silently drops items whose verdict is NULL.
const BACKEND_EXPLOITABILITY_VERDICTS = [
  'actively_exploited',
  'proven',
  'theoretical',
  'not_exploitable',
];
const applyExploitabilityVerdict = (
  params: Record<string, any>,
  exploitability?: string[],
): void => {
  if (!exploitability || exploitability.length === 0) return;
  const forwarded = exploitability
    .map(v => v.toLowerCase())
    .filter(v => BACKEND_EXPLOITABILITY_VERDICTS.includes(v));
  if (forwarded.length === 0) return;
  if (forwarded.length === BACKEND_EXPLOITABILITY_VERDICTS.length) return;
  params.exploitabilityVerdict = forwarded;
};

export const fetchSastResultsForProject = profiler('fetchSastResultsForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    sort?: string;
    order?: string;
    severity?: string[];
    status?: string[];
    language?: string[];
    sourcePath?: string;
    priority?: string[];
    searchQuery?: string;
    branch?: string;
    /** Filter by autofix status: true = only with autofix, false = only without autofix, undefined = all */
    hasAutofix?: boolean;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {
    pageNumber: 1,
    pageSizeNumber: 10,
  }
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const {
      pageNumber,
      pageSizeNumber,
      sort,
      order,
      severity,
      status,
      language,
      sourcePath,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      exploitability,
      scoringSource,
    } = options;

    const params: any = {
      pageNumber: pageNumber || 1,
      pageSizeNumber: pageSizeNumber || 10,
    };

    if (sort) {
      params.sort = sort;
    }
    if (order) {
      params.order = order;
    }

    if (severity && severity.length > 0) {
      params.severity = severity.map(s => s.toLowerCase());
    }
    if (status && status.length > 0) {
      params.status = status.map(s => s.toLowerCase());
    }
    if (priority && priority.length > 0) {
      params.priority = priority.map(p => p.toLowerCase());
    }
    applyExploitabilityVerdict(params, exploitability);
    if (scoringSource) params.scoringSource = scoringSource;

    if (language && language.length > 0) {
      params.language = language;
    }
    if (sourcePath) {
      params.sourcePath = sourcePath;
    }
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (branch) {
      params.branch = branch;
    }
    // Filter by autofix status (requires backend support)
    if (hasAutofix !== undefined) {
      params.hasAutofix = hasAutofix;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    // repeat format, so it becomes ?severity=crit&severity=high
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sast`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    // Transform the response to match the expected PaginatedVulnerabilityResults format
    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      pageSize: data.limit || data.pageSize,
      vulnerabilities: data.vulnerabilities.map((vuln: any) => {
        if (vuln.base) {
          // Extract history items correctly regardless of format
          const historyItems =
            vuln.base.historyItems?.items ||
            (Array.isArray(vuln.base.historyItems)
              ? vuln.base.historyItems
              : []);

          // Transform new format to expected format
          return {
            ...vuln.base,
            dataFlowItems: vuln.dataFlowItems || [],
            vulnerability: vuln.base.vulnerability,
            historyItems: historyItems,
            vulnerabilityType: vuln.base.vulnerabilityType,
          } as SastVulnerabilityResult;
        }
        return vuln;
      }),
    };

    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchSastVulnerabilityById = profiler('fetchSastVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string,
  language?: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sast/${vulnerabilityId}`,
      {
        params: {
          language,
        },
      }
    );

    // Transform to expected format based on response structure
    const responseData = response.data;
    const isProjectParsed = responseData.isProjectParsed ?? false;

    // Case 1: New format with sast.base structure
    if (responseData.sast && responseData.sast.base) {
      const vuln = responseData.sast;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          dataFlowItems: vuln.dataFlowItems || [],
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'sast',
        } as SastVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 2: Previous new format with vulnerability.base structure
    if (responseData.vulnerability && responseData.vulnerability.base) {
      const vuln = responseData.vulnerability;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          dataFlowItems: vuln.dataFlowItems || [],
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'sast',
        } as SastVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 3: Original format
    return {
      vulnerability: responseData.vulnerability,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchIacResultsForProject = profiler('fetchIacResultsForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    sort?: string;
    order?: string;
    severity?: string[];
    status?: string[];
    language?: string[];
    sourcePath?: string;
    priority?: string[];
    searchQuery?: string;
    branch?: string;
    /** Filter by autofix status: true = only with autofix, false = only without autofix, undefined = all */
    hasAutofix?: boolean;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {
    pageNumber: 1,
    pageSizeNumber: 10,
  }
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const {
      pageNumber,
      pageSizeNumber,
      sort,
      order,
      severity,
      status,
      language,
      sourcePath,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      exploitability,
      scoringSource,
    } = options;

    const params: any = {
      pageNumber: pageNumber || 1,
      pageSizeNumber: pageSizeNumber || 10,
    };

    if (sort) {
      params.sort = sort;
    }
    if (order) {
      params.order = order;
    }

    if (severity && severity.length > 0) {
      params.severity = severity.map(s => s.toLowerCase());
    }
    if (status && status.length > 0) {
      params.status = status.map(s => s.toLowerCase());
    }
    if (priority && priority.length > 0) {
      params.priority = priority.map(p => p.toLowerCase());
    }
    applyExploitabilityVerdict(params, exploitability);
    if (scoringSource) params.scoringSource = scoringSource;

    if (language && language.length > 0) {
      params.language = language;
    }
    if (sourcePath) {
      params.sourcePath = sourcePath;
    }
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (branch) {
      params.branch = branch;
    }
    // Filter by autofix status (requires backend support)
    if (hasAutofix !== undefined) {
      params.hasAutofix = hasAutofix;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(`/project/${projectId}/results/iac`, {
      params,
      paramsSerializer: p =>
        qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
    });

    // Transform the response to match the expected PaginatedVulnerabilityResults format
    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      pageSize: data.limit || data.pageSize,
      vulnerabilities: data.vulnerabilities.map((vuln: any) => {
        if (vuln.base) {
          // Extract history items correctly regardless of format
          const historyItems =
            vuln.base.historyItems?.items ||
            (Array.isArray(vuln.base.historyItems)
              ? vuln.base.historyItems
              : []);

          // Transform new format to expected format
          return {
            ...vuln.base,
            vulnerability: vuln.base.vulnerability,
            historyItems: historyItems,
            vulnerabilityType: 'iac',
          };
        }
        return vuln;
      }),
    };

    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchCicdResultsForProject = profiler('fetchCicdResultsForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    sort?: string;
    order?: string;
    severity?: string[];
    status?: string[];
    language?: string[];
    sourcePath?: string;
    priority?: string[];
    searchQuery?: string;
    branch?: string;
    /** Filter by autofix status: true = only with autofix, false = only without autofix, undefined = all */
    hasAutofix?: boolean;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {
    pageNumber: 1,
    pageSizeNumber: 10,
  }
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const {
      pageNumber,
      pageSizeNumber,
      sort,
      order,
      severity,
      status,
      language,
      sourcePath,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      exploitability,
      scoringSource,
    } = options;

    const params: any = {
      pageNumber: pageNumber || 1,
      pageSizeNumber: pageSizeNumber || 10,
    };

    if (sort) {
      params.sort = sort;
    }
    if (order) {
      params.order = order;
    }

    if (severity && severity.length > 0) {
      params.severity = severity.map(s => s.toLowerCase());
    }
    if (status && status.length > 0) {
      params.status = status.map(s => s.toLowerCase());
    }
    if (priority && priority.length > 0) {
      params.priority = priority.map(p => p.toLowerCase());
    }
    applyExploitabilityVerdict(params, exploitability);
    if (scoringSource) params.scoringSource = scoringSource;

    if (language && language.length > 0) {
      params.language = language;
    }
    if (sourcePath) {
      params.sourcePath = sourcePath;
    }
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (branch) {
      params.branch = branch;
    }
    // Filter by autofix status (requires backend support)
    if (hasAutofix !== undefined) {
      params.hasAutofix = hasAutofix;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(`/project/${projectId}/results/cicd`, {
      params,
      paramsSerializer: p =>
        qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
    });

    // Transform the response to match the expected PaginatedVulnerabilityResults format
    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      pageSize: data.limit || data.pageSize,
      vulnerabilities: data.vulnerabilities.map((vuln: any) => {
        if (vuln.base) {
          // Extract history items correctly regardless of format
          const historyItems =
            vuln.base.historyItems?.items ||
            (Array.isArray(vuln.base.historyItems)
              ? vuln.base.historyItems
              : []);

          // Transform new format to expected format
          return {
            ...vuln.base,
            vulnerability: vuln.base.vulnerability,
            historyItems: historyItems,
            vulnerabilityType: 'cicd',
          };
        }
        return vuln;
      }),
    };

    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchIacVulnerabilityById = profiler('fetchIacVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string,
  language?: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/iac/${vulnerabilityId}`,
      {
        params: {
          language,
        },
      }
    );

    // Transform to expected format based on response structure
    const responseData = response.data;
    const isProjectParsed = responseData.isProjectParsed ?? false;

    // Case 1: New format with iac.base structure
    if (responseData.iac && responseData.iac.base) {
      const vuln = responseData.iac;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'iac',
        } as IacVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 2: Previous new format with vulnerability.base structure
    if (responseData.vulnerability && responseData.vulnerability.base) {
      const vuln = responseData.vulnerability;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'iac',
        } as IacVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 3: Original format
    return {
      vulnerability: responseData.vulnerability,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchCicdVulnerabilityById = profiler('fetchCicdVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string,
  language?: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/cicd/${vulnerabilityId}`,
      {
        params: {
          language,
        },
      }
    );

    // Transform to expected format based on response structure
    const responseData = response.data;
    const isProjectParsed = responseData.isProjectParsed ?? false;

    // Case 1: New format with cicd.base structure
    if (responseData.cicd && responseData.cicd.base) {
      const vuln = responseData.cicd;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'cicd',
        } as CicdVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 2: Previous new format with vulnerability.base structure
    if (responseData.vulnerability && responseData.vulnerability.base) {
      const vuln = responseData.vulnerability;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'cicd',
        } as CicdVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 3: Original format
    return {
      vulnerability: responseData.vulnerability,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchSecretResultsForProject = profiler('fetchSecretResultsForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    sort?: string;
    order?: string;
    severity?: string[];
    status?: string[];
    language?: string[];
    sourcePath?: string;
    priority?: string[];
    searchQuery?: string;
    branch?: string;
    /** Filter by autofix status: true = only with autofix, false = only without autofix, undefined = all */
    hasAutofix?: boolean;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
    /** Filter by secret source: 'head' | 'history' */
    source?: string[];
    /** Filter by partial commit SHA */
    commitSha?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {
    pageNumber: 1,
    pageSizeNumber: 10,
  }
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const {
      pageNumber,
      pageSizeNumber,
      sort,
      order,
      severity,
      status,
      language,
      sourcePath,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      exploitability,
      scoringSource,
      source,
      commitSha,
    } = options;

    const params: any = {
      pageNumber: pageNumber || 1,
      pageSizeNumber: pageSizeNumber || 10,
    };

    if (sort) {
      params.sort = sort;
    }
    if (order) {
      params.order = order;
    }

    if (severity && severity.length > 0) {
      params.severity = severity.map(s => s.toLowerCase());
    }
    if (status && status.length > 0) {
      params.status = status.map(s => s.toLowerCase());
    }
    if (priority && priority.length > 0) {
      params.priority = priority.map(p => p.toLowerCase());
    }
    applyExploitabilityVerdict(params, exploitability);
    if (scoringSource) params.scoringSource = scoringSource;

    if (language && language.length > 0) {
      params.language = language;
    }
    if (sourcePath) {
      params.sourcePath = sourcePath;
    }
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (branch) {
      params.branch = branch;
    }
    // Filter by autofix status (requires backend support)
    if (hasAutofix !== undefined) {
      params.hasAutofix = hasAutofix;
    }
    if (source && source.length > 0) {
      params.source = source;
    }
    if (commitSha) {
      params.commitSha = commitSha;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(`/project/${projectId}/results/secret`, {
      params,
      paramsSerializer: p =>
        qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
    });

    // Transform the response to match the expected PaginatedVulnerabilityResults format
    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      pageSize: data.limit || data.pageSize,
      vulnerabilities: data.vulnerabilities.map((vuln: any) => {
        if (vuln.base) {
          // Extract history items correctly regardless of format
          const historyItems =
            vuln.base.historyItems?.items ||
            (Array.isArray(vuln.base.historyItems)
              ? vuln.base.historyItems
              : []);

          // Transform new format to expected format
          return {
            ...vuln.base,
            vulnerability: vuln.base.vulnerability,
            historyItems: historyItems,
            vulnerabilityType: 'secret',
            hasEncryptedSecret: vuln.hasEncryptedSecret ?? false,
            commitSha: vuln.commitSha,
            source: vuln.source,
          };
        }
        return vuln;
      }),
    };

    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchSecretVulnerabilityById = profiler('fetchSecretVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string,
  language?: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/secret/${vulnerabilityId}`,
      {
        params: {
          language,
        },
      }
    );

    // Transform to expected format based on response structure
    const responseData = response.data;
    const isProjectParsed = responseData.isProjectParsed ?? false;

    // Case 1: New format with secret.base structure
    if (responseData.secret && responseData.secret.base) {
      const vuln = responseData.secret;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'secret',
          hasEncryptedSecret: vuln.hasEncryptedSecret ?? false,
          commitSha: vuln.commitSha,
          source: vuln.source,
        } as SecretVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 2: Previous new format with vulnerability.base structure
    if (responseData.vulnerability && responseData.vulnerability.base) {
      const vuln = responseData.vulnerability;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.base.vulnerability,
          historyItems: historyItems,
          vulnerabilityType: 'secret',
          hasEncryptedSecret: vuln.hasEncryptedSecret ?? false,
          commitSha: vuln.commitSha,
          source: vuln.source,
        } as SecretVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 3: Original format
    return {
      vulnerability: responseData.vulnerability,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchScaResultsForProject = profiler('fetchScaResultsForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    sort?: string;
    order?: string;
    severity?: string[];
    status?: string[];
    language?: string[];
    sourcePath?: string;
    priority?: string[];
    searchQuery?: string;
    packageType?: string | string[];
    packageManager?: string[];
    packageSource?: string[];
    branch?: string;
    hasAutofix?: boolean;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
    /** When true, return ONLY malware findings; unset/false EXCLUDES malware. */
    malwareOnly?: boolean;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {
    pageNumber: 1,
    pageSizeNumber: 10,
  }
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const {
      pageNumber,
      pageSizeNumber,
      sort,
      order,
      severity,
      status,
      language,
      sourcePath,
      priority,
      searchQuery,
      packageType,
      packageManager,
      packageSource,
      branch,
      hasAutofix,
      exploitability,
      scoringSource,
      malwareOnly,
    } = options;

    const params: any = {
      pageNumber: pageNumber || 1,
      pageSizeNumber: pageSizeNumber || 10,
    };

    if (sort) {
      params.sort = sort;
    }
    if (order) {
      params.order = order;
    }

    if (severity && severity.length > 0) {
      params.severity = severity.map(s => s.toLowerCase());
    }
    if (status && status.length > 0) {
      params.status = status.map(s => s.toLowerCase());
    }
    if (priority && priority.length > 0) {
      params.priority = priority.map(p => p.toLowerCase());
    }
    applyExploitabilityVerdict(params, exploitability);
    if (scoringSource) params.scoringSource = scoringSource;

    if (language && language.length > 0) {
      params.language = language;
    }
    if (sourcePath) {
      params.sourcePath = sourcePath;
    }
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (packageType) {
      if (Array.isArray(packageType)) {
        // For multiple package types, filter out "all" and send the array
        const filteredTypes = packageType.filter(type => type !== 'all');
        if (filteredTypes.length > 0) {
          params.packageType = filteredTypes;
        }
      } else if (packageType !== 'all') {
        params.packageType = packageType;
      }
    }
    if (packageManager && packageManager.length > 0) {
      params.packageManager = packageManager;
    }
    if (packageSource && packageSource.length > 0) {
      params.packageSource = packageSource;
    }
    if (branch) {
      params.branch = branch;
    }
    if (hasAutofix !== undefined) {
      params.hasAutofix = hasAutofix;
    }
    // Only send malwareOnly when true — unset/false lets the backend
    // apply its default behaviour (EXCLUDE malware from the Vulnerabilities list).
    if (malwareOnly) {
      params.malwareOnly = true;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(`/project/${projectId}/results/sca`, {
      params,
      paramsSerializer: p =>
        qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
    });

    // Transform the response to match the expected PaginatedVulnerabilityResults format
    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      pageSize: data.limit || data.pageSize,
      // Project-wide malware total (independent of filter/pagination).
      malwareCount: data.malwareCount ?? 0,
      vulnerabilities: data.vulnerabilities.map((vuln: any) => {
        if (vuln.base) {
          // Extract history items correctly regardless of format
          const historyItems =
            vuln.base.historyItems?.items ||
            (Array.isArray(vuln.base.historyItems)
              ? vuln.base.historyItems
              : []);

          // Transform metadata to match expected interface
          const transformedMetadata = vuln.metadata
            ? {
                ...vuln.metadata,
                description:
                  vuln.metadata.details || vuln.metadata.description || '',
              }
            : null;

          // Transform new format to expected format for SCA
          return {
            ...vuln.base,
            vulnerability: transformedMetadata, // metadata contains the vulnerability information
            historyItems: historyItems,
            package: vuln.library, // library contains the package information
            cvssScore: vuln.cvssScore || 0,
            vulnerabilityType: 'sca',
            // Malware flag lives at the item top level (is_malware in
            // the raw gRPC-shaped response, isMalware once camelCased at gateway).
            isMalware: vuln.isMalware ?? vuln.is_malware ?? false,
            // SCA-specific autofix fields
            hasAutofix: vuln.hasAutofix || false,
            scaAutofixRecords: vuln.autofixRecords || [],
            // Mirrored under the common `autofixRecords` name so the shared
            // vulnerability row (AutoFix page, badges) reads one field for every type.
            autofixRecords: vuln.autofixRecords || [],
          };
        }
        return vuln;
      }),
    };

    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches container packages for a project with pagination and filtering.
 */
export const fetchContainerPackagesForProject = profiler('fetchContainerPackagesForProject')(async (
  projectId: string,
  options: {
    page?: number;
    limit?: number;
    searchQuery?: string;
    classType?: string[];
    imageId?: string;
  } = {}
): Promise<PaginatedContainerPackagesResults> => {
  try {
    const params = { ...options };
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container/packages`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data as PaginatedContainerPackagesResults;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches container images for a project.
 * This endpoint returns a paginated list of container images associated with the project.
 */
export const fetchContainerImagesForProject = profiler('fetchContainerImagesForProject')(async (
  projectId: string,
  options: {
    page?: number;
    limit?: number;
    branch?: string;
  } = {}
): Promise<PaginatedContainerImagesResults> => {
  try {
    const params = { ...options };
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container/images`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches container images grouped by repository for a project.
 * This endpoint returns images grouped by repository name, showing all tags within each image.
 */
export const fetchGroupedContainerImagesForProject = profiler('fetchGroupedContainerImagesForProject')(async (
  projectId: string,
  options: {
    page?: number;
    limit?: number;
    branch?: string;
    sort?: string;
    order?: string;
    searchQuery?: string;
  } = {}
): Promise<PaginatedGroupedContainerImagesResults> => {
  try {
    const params = { ...options };
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container/images/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches container vulnerabilities for a project with pagination and filtering.
 */
export const fetchContainerResultsForProject = profiler('fetchContainerResultsForProject')(async (
  projectId: string,
  options: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
    classType?: string[];
    severity?: string[];
    status?: string[];
    priority?: string[];
    searchQuery?: string;
    imageId?: string;
    branch?: string;
    exploitability?: string[];
    /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
    scoringSource?: string;
  } = {}
): Promise<PaginatedVulnerabilityResults> => {
  try {
    const { exploitability, ...rest } = options;
    const params: Record<string, any> = { ...rest };
    applyExploitabilityVerdict(params, exploitability);
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    const data = response.data;
    const transformedData: PaginatedVulnerabilityResults = {
      ...data,
      page: data.page,
      pageSize: data.limit,
      // Spread every detection scalar (cvssScore, cvss4*, epss*, scoringSource,
      // exploitability*, priorityScore, …) — the table columns read them
      // directly; hand-picking fields here showed CVSS "–" and exploitability
      // "Not Evaluated" despite the backend returning the values.
      vulnerabilities: data.vulnerabilities.map(
        ({ vuln, historyItems, updatedAt, ...scalars }: any) => ({
          ...scalars,
          updateAt: updatedAt,
          vulnerabilityType: 'container',
          vulnerability: vuln,
          historyItems: historyItems?.items || [],
        }),
      ) as ContainerVulnerabilityResult[],
    };
    return transformedData;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches a single container vulnerability by its ID.
 */
export const fetchContainerVulnerabilityById = profiler('fetchContainerVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container/${vulnerabilityId}`
    );
    const data = response.data;
    const isProjectParsed = data.isProjectParsed ?? false;
    // Spread every detection scalar (cvssScore, cvss4*, epss*, scoringSource,
    // exploitability*, priorityScore, cvssExplanation, branch, …) — only the
    // shape-specific keys are remapped. Hand-picking fields here silently
    // dropped all scoring data and broke the issue page (CVSS shown as N/A).
    const { vuln, historyItems, updatedAt, ...detectionScalars } =
      data.detection;
    return {
      vulnerability: {
        ...detectionScalars,
        updateAt: updatedAt,
        vulnerabilityType: 'container',
        vulnerability: vuln,
        historyItems: historyItems?.items || [],
      } as ContainerVulnerabilityResult,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchScaPackagesForProject = profiler('fetchScaPackagesForProject')(async (
  projectId: string,
  options: {
    pageNumber?: number;
    pageSizeNumber?: number;
    searchQuery?: string;
    packageType?: string | string[];
    branch?: string;
  } = { pageNumber: 1, pageSizeNumber: 10 }
): Promise<PaginatedScaPackagesResults> => {
  try {
    const { pageNumber, pageSizeNumber, searchQuery, packageType, branch } = options;
    const params: any = {
      page: pageNumber || 1,
      limit: pageSizeNumber || 10,
    };
    if (searchQuery) {
      params.searchQuery = searchQuery;
    }
    if (branch) {
      params.branch = branch;
    }
    if (packageType) {
      if (Array.isArray(packageType)) {
        // For multiple package types, filter out "all" and send the array
        const filteredTypes = packageType.filter(type => type !== 'all');
        if (filteredTypes.length > 0) {
          params.packageType = filteredTypes;
        }
      } else if (packageType !== 'all') {
        params.packageType = packageType;
      }
    }
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sca/packages`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchLicenseSummary = profiler('fetchLicenseSummary')(async (
  projectId: string,
  branch?: string,
  organizationId?: string,
  packageType?: string[],
): Promise<any> => {
  try {
    const params: any = {};
    if (branch) {
      params.branch = branch;
    }
    if (organizationId) {
      params.organizationId = organizationId;
    }
    if (packageType) {
      const filteredTypes = Array.isArray(packageType)
        ? packageType.filter(type => type !== 'all')
        : packageType !== 'all' ? [packageType] : [];
      if (filteredTypes.length > 0) {
        params.packageType = filteredTypes;
      }
    }
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sca/licenses/summary`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchPackagesByLicense = profiler('fetchPackagesByLicense')(async (
  projectId: string,
  spdxId: string,
  branch?: string,
  organizationId?: string,
  packageType?: string[],
): Promise<any> => {
  try {
    const params: any = {};
    if (branch) {
      params.branch = branch;
    }
    if (organizationId) {
      params.organizationId = organizationId;
    }
    if (packageType) {
      const filteredTypes = Array.isArray(packageType)
        ? packageType.filter(type => type !== 'all')
        : packageType !== 'all' ? [packageType] : [];
      if (filteredTypes.length > 0) {
        params.packageType = filteredTypes;
      }
    }
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sca/licenses/${encodeURIComponent(spdxId)}/packages`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const assignPackageLicense = profiler('assignPackageLicense')(async (
  projectId: string,
  packageId: string,
  spdxId: string,
): Promise<{ success: boolean }> => {
  try {
    const response = await gatewayAPI.put(
      `/project/${projectId}/sca/packages/${packageId}/license`,
      { spdxId },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const setPackageLicenseIgnored = profiler('setPackageLicenseIgnored')(async (
  projectId: string,
  packageId: string,
  ignored: boolean,
): Promise<{ success: boolean }> => {
  try {
    const response = await gatewayAPI.put(
      `/project/${projectId}/sca/packages/${packageId}/license-ignore`,
      { ignored },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const fetchScaVulnerabilityById = profiler('fetchScaVulnerabilityById')(async (
  projectId: string,
  vulnerabilityId: string
): Promise<VulnerabilityByIdResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sca/${vulnerabilityId}`
    );

    // Transform to expected format based on response structure
    const responseData = response.data;
    const isProjectParsed = responseData.isProjectParsed ?? false;

    // Case 1: New format with sca wrapper structure (detail page)
    if (responseData.sca && responseData.sca.base) {
      const scaData = responseData.sca;

      // Extract history items correctly regardless of format
      const historyItems =
        scaData.base.historyItems?.items ||
        (Array.isArray(scaData.base.historyItems)
          ? scaData.base.historyItems
          : []);

      // Transform metadata to match expected interface (details -> description)
      const transformedMetadata = scaData.metadata
        ? {
            ...scaData.metadata,
            description:
              scaData.metadata.details || scaData.metadata.description || '',
          }
        : null;

      return {
        vulnerability: {
          ...scaData.base,
          vulnerability: transformedMetadata,
          historyItems: historyItems,
          package: scaData.library,
          cvssScore: scaData.cvssScore || 0,
          vulnerabilityType: 'sca',
          // Malware flag lives at the item top level (is_malware in
          // the raw gRPC-shaped response, isMalware once camelCased at gateway).
          isMalware:
            scaData.isMalware ??
            scaData.is_malware ??
            scaData.base?.isMalware ??
            scaData.base?.is_malware ??
            false,
          // SCA-specific autofix fields
          hasAutofix: scaData.hasAutofix || false,
          scaAutofixRecords: scaData.autofixRecords || [],
          autofixRecords: scaData.autofixRecords || [],
          cvssExplanation: scaData.cvssExplanation,
        } as ScaVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 2: New format with direct base structure (list page)
    if (responseData.base) {
      // Extract history items correctly regardless of format
      const historyItems =
        responseData.base.historyItems?.items ||
        (Array.isArray(responseData.base.historyItems)
          ? responseData.base.historyItems
          : []);

      // Transform metadata to match expected interface
      const transformedMetadata = responseData.metadata
        ? {
            ...responseData.metadata,
            description:
              responseData.metadata.details ||
              responseData.metadata.description ||
              '',
          }
        : null;

      return {
        vulnerability: {
          ...responseData.base,
          vulnerability: transformedMetadata,
          historyItems: historyItems,
          package: responseData.library,
          cvssScore: responseData.cvssScore || 0,
          vulnerabilityType: 'sca',
          // Surface the malware flag so the detail view can hide the
          // CVSS/EPSS/exploitable-path cards (meaningless for a malicious package).
          isMalware:
            responseData.isMalware ??
            responseData.is_malware ??
            responseData.base?.isMalware ??
            responseData.base?.is_malware ??
            false,
          cvssExplanation: responseData.cvssExplanation,
        } as ScaVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 3: Previous format with vulnerability.base structure
    if (responseData.vulnerability && responseData.vulnerability.base) {
      const vuln = responseData.vulnerability;

      // Extract history items correctly regardless of format
      const historyItems =
        vuln.base.historyItems?.items ||
        (Array.isArray(vuln.base.historyItems) ? vuln.base.historyItems : []);

      return {
        vulnerability: {
          ...vuln.base,
          vulnerability: vuln.metadata || responseData.metadata,
          historyItems: historyItems,
          package: vuln.library || responseData.library,
          cvssScore: vuln.cvssScore || responseData.cvssScore || 0,
          vulnerabilityType: 'sca',
          // Surface the malware flag (legacy vulnerability.base shape).
          isMalware:
            vuln.isMalware ??
            vuln.is_malware ??
            vuln.base?.isMalware ??
            vuln.base?.is_malware ??
            responseData.isMalware ??
            responseData.is_malware ??
            false,
          cvssExplanation: vuln.cvssExplanation ?? responseData.cvssExplanation,
        } as ScaVulnerabilityResult,
        isProjectParsed,
      };
    }

    // Case 4: Original format
    return {
      vulnerability: responseData.vulnerability,
      isProjectParsed,
    };
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const updateVulnerability = profiler('updateVulnerability')(async (
  projectId: string,
  vulnerabilityId: string,
  updateData: UpdateResultRequestDto
): Promise<VulnerabilityResult> => {
  try {
    const response = await gatewayAPI.patch(
      `/project/${projectId}/results/${vulnerabilityId}`,
      updateData
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Batch update multiple vulnerabilities in a single request.
 * Allows updating status, priority, and/or adding comments for up to 100 vulnerabilities.
 * 
 * @param projectId - The project ID containing the vulnerabilities
 * @param request - The batch update request containing items to update
 * @returns Response with success/failure counts and individual results
 */
export const batchUpdateVulnerabilities = profiler('batchUpdateVulnerabilities')(async (
  projectId: string,
  request: BatchUpdateVulnerabilitiesRequest
): Promise<EnqueueBatchUpdateResponse> => {
  try {
    const response = await gatewayAPI.patch(
      `/project/${projectId}/results/batch`,
      request
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const getProjectOverview = profiler('getProjectOverview')(async (
  projectId: string,
  branch?: string,
  branches?: string[]
): Promise<GetProjectOverviewResponse> => {
  try {
    const params: Record<string, string> = {};
    if (branches && branches.length > 0) {
      params.branches = branches.join(',');
    } else if (branch) {
      params.branches = branch;
    }
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/overview`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetches aggregated overview statistics for an organization.
 * Returns comprehensive vulnerability data including severity distribution,
 * state distribution, analysis types, trends, and per-project/team summaries.
 * 
 * @param organizationId - The ID of the organization.
 * @param filters - Optional filters for customizing the overview data.
 * @returns Aggregated organization overview with all statistics.
 */
export const getOrganizationOverview = profiler('getOrganizationOverview')(async (
  organizationId: string,
  filters?: OrganizationOverviewFilters
): Promise<GetOrganizationOverviewResponse> => {
  try {
    const params: Record<string, any> = {};

    if (filters) {
      // Branches filter (send composite keys projectId::branchName as-is for per-project filtering)
      if (filters.branches?.length) {
        params.branches = filters.branches.join(',');
      }

      // Project IDs filter
      if (filters.projectIds?.length) {
        params.projectIds = filters.projectIds.join(',');
      }
      
      // Severity filter (comma separated)
      if (filters.severities?.length) {
        params.severityFilter = filters.severities.join(',');
      }
      
      // State filter (comma separated)
      if (filters.states?.length) {
        params.statusFilter = filters.states.join(',');
      }
      
      // Analysis type filter (comma separated)
      if (filters.analysisTypes?.length) {
        params.analysisTypes = filters.analysisTypes.join(',');
      }
      
      // Date range
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom;
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo;
      }

      // Sorting
      if (filters.sortBy) {
        params.sortBy = filters.sortBy;
      }
      if (filters.sortOrder) {
        params.sortOrder = filters.sortOrder;
      }
      
      // Include team stats
      if (filters.includeTeamStats !== undefined) {
        params.includeTeamStats = filters.includeTeamStats;
      }
    }

    const response = await gatewayAPI.get(
      `/organization/${organizationId}/results/overview`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

const buildOverviewFilterParams = (filters?: OrganizationOverviewFilters): Record<string, any> => {
  const params: Record<string, any> = {};
  if (!filters) return params;
  if (filters.branches?.length) params.branches = filters.branches.join(',');
  if (filters.projectIds?.length) params.projectIds = filters.projectIds.join(',');
  if (filters.severities?.length) params.severityFilter = filters.severities.join(',');
  if (filters.states?.length) params.statusFilter = filters.states.join(',');
  if (filters.analysisTypes?.length) params.analysisTypes = filters.analysisTypes.join(',');
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  return params;
};

export const getOrganizationSeverityDistribution = profiler('getOrganizationSeverityDistribution')(async (
  organizationId: string,
  filters?: OrganizationOverviewFilters,
): Promise<OrganizationSeverityDistributionResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/results/overview/severity-distribution`,
      { params: buildOverviewFilterParams(filters) },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const getOrganizationStateDistribution = profiler('getOrganizationStateDistribution')(async (
  organizationId: string,
  filters?: OrganizationOverviewFilters,
): Promise<OrganizationStateDistributionResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/results/overview/state-distribution`,
      { params: buildOverviewFilterParams(filters) },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

export const getOrganizationVulnerabilitiesOverTime = profiler('getOrganizationVulnerabilitiesOverTime')(async (
  organizationId: string,
  filters?: OrganizationOverviewFilters,
): Promise<OrganizationVulnerabilitiesOverTimeResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/results/overview/vulnerabilities-over-time`,
      { params: buildOverviewFilterParams(filters) },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Deletes a specific container image and its associated data from a project.
 * @param projectId - The ID of the project.
 * @param imageId - The ID of the container image to delete.
 * @returns A confirmation message.
 */
export const deleteContainerImage = async (
  projectId: string,
  imageId: string
): Promise<ProjectDeleteResponseDto> => {
  try {
    const response = await gatewayAPI.delete(
      `/project/${projectId}/results/container/images/${imageId}`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Generates an OWASP Top 10 report for a project.
 * @param projectId - The ID of the project.
 * @param format - Output format ("json", "html", or "pdf").
 * @param detailed - Whether to generate a detailed report (optional).
 * @param branch - Optional branch name. When provided, the gateway scopes the
 *                 report to that single branch; when omitted (undefined), the
 *                 report aggregates vulnerabilities across all branches.
 * @returns The generated OWASP report data.
 */
/**
 * Fetch the status of an async-generated report and, when ready, a freshly
 * signed download URL.
 */
export const getGeneratedReport = async (
  projectId: string,
  reportId: string,
): Promise<GetGeneratedReportResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/reports/${reportId}`,
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Enqueue an OWASP report generation job. Returns immediately with
 * `{ reportId, status: "queued" }`; the caller listens on the persistent
 * project `reports` realtime stream for REPORT_READY and then refetches the
 * signed URL via getGeneratedReport. The realtime stream is owned by the hook
 * (never opened/closed per generation here).
 */
export const generateOwaspReport = async (
  projectId: string,
  format: 'json' | 'html' | 'pdf',
  detailed?: boolean,
  branch?: string
): Promise<GenerateOwaspReportResponse> => {
  try {
    const params: any = {};
    if (detailed !== undefined) {
      params.detailed = detailed.toString();
    }
    if (branch) {
      params.branch = branch;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/owasp-report/${format}`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Generates a CWE Top 25 report for a project.
 * @param projectId - The ID of the project.
 * @param format - Output format ("json", "html", or "pdf").
 * @param detailed - Whether to generate a detailed report (optional, default: true).
 * @param branch - Optional branch name. When provided, the gateway scopes the
 *                 report to that single branch; when omitted (undefined), the
 *                 report aggregates vulnerabilities across all branches.
 * @returns The generated CWE report data.
 */
export const generateCweReport = async (
  projectId: string,
  format: 'json' | 'html' | 'pdf',
  detailed?: boolean,
  branch?: string
): Promise<GenerateCweReportResponse> => {
  try {
    const params: any = {};
    if (detailed !== undefined) {
      params.detailed = detailed.toString();
    }
    if (branch) {
      params.branch = branch;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/cwe-report/${format}`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Retrieves distinct branch names found in vulnerability detections.
 * Use this for projects not linked to GitHub/GitLab integrations.
 * @param projectId - The ID of the project.
 * @returns Object containing array of branches with name and isDefault.
 */
export const getProjectBranches = profiler('getProjectBranches')(async (
  projectId: string
): Promise<GetProjectBranchesResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/branches`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Get archived branches for a project.
 */
export const getArchivedBranches = profiler('getArchivedBranches')(async (
  projectId: string
): Promise<{ branches: string[] }> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/branches/archived`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Batch-fetch distinct branches for many projects in a single request.
 * Replaces the N-per-project fan-out that OrganizationBranchSelector
 * was firing on every dropdown open.
 *
 * @param organizationId - The org id (path scope, also drives Permify).
 * @param projectIds - Project ids the caller wants branches for.
 */
export interface BatchProjectsBranchesEntry {
  projectId: string;
  branches: string[];
  archivedBranches: string[];
  /** The project's reference branch; empty when none is configured. */
  defaultBranch?: string;
}
export const getBatchProjectsBranches = profiler('getBatchProjectsBranches')(async (
  organizationId: string,
  projectIds: string[],
): Promise<{ projects: BatchProjectsBranchesEntry[] }> => {
  if (!organizationId || projectIds.length === 0) {
    return { projects: [] };
  }
  try {
    // projectIds travel in the JSON body (endpoint moved from GET + CSV query
    // string to POST) so a 100×UUID list never bloats the URL.
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/projects/branches`,
      { projectIds },
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Archive a branch for a project (hide from selectors by default).
 */
export const archiveBranch = profiler('archiveBranch')(async (
  projectId: string,
  branchName: string
): Promise<{ success: boolean }> => {
  try {
    const response = await gatewayAPI.post(
      `/project/${projectId}/branches/${encodeURIComponent(branchName)}/archive`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Unarchive a branch for a project (make visible again).
 */
export const unarchiveBranch = profiler('unarchiveBranch')(async (
  projectId: string,
  branchName: string
): Promise<{ success: boolean }> => {
  try {
    const response = await gatewayAPI.delete(
      `/project/${projectId}/branches/${encodeURIComponent(branchName)}/archive`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Generates an aggregated security report for an Organization.
 * Consolidates reports from all projects within the organization.
 * @param organizationId - The ID of the organization.
 * @param reportType - Type of report ("owasp" or "cwe").
 * @param format - Output format ("json", "html", or "pdf").
 * @param detailed - Whether to generate a detailed report (optional, default: true).
 * @returns The aggregated organization report data.
 */
export const generateOrganizationReport = async (
  organizationId: string,
  reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
  format: 'json' | 'html' | 'pdf',
  detailed?: boolean,
  branchFilter?: string,
  projectBranchSelections?: ProjectBranchSelection[]
): Promise<GenerateAggregatedReportResponse> => {
  try {
    const params: any = {};
    if (detailed !== undefined) {
      params.detailed = detailed.toString();
    }
    if (branchFilter && branchFilter !== 'all') {
      params.branchFilter = branchFilter;
    }
    if (branchFilter === 'selected' && projectBranchSelections && projectBranchSelections.length > 0) {
      params.projectBranchSelections = JSON.stringify(projectBranchSelections);
    }

    const response = await gatewayAPI.get(
      `/organization/${organizationId}/report/${reportType}/${format}`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Generates an aggregated security report for a Team.
 * Consolidates reports from all projects within the team.
 * @param teamId - The ID of the team.
 * @param reportType - Type of report ("owasp", "cwe", or "license").
 * @param format - Output format ("json", "html", or "pdf").
 * @param detailed - Whether to generate a detailed report (optional, default: true).
 * @returns The aggregated team report data.
 */
export const generateTeamReport = async (
  teamId: string,
  reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
  format: 'json' | 'html' | 'pdf',
  detailed?: boolean,
  branchFilter?: string,
  projectBranchSelections?: ProjectBranchSelection[],
  organizationId?: string,
): Promise<GenerateAggregatedReportResponse> => {
  try {
    const params: any = {};
    if (detailed !== undefined) {
      params.detailed = detailed.toString();
    }
    if (branchFilter && branchFilter !== 'all') {
      params.branchFilter = branchFilter;
    }
    if (branchFilter === 'selected' && projectBranchSelections && projectBranchSelections.length > 0) {
      params.projectBranchSelections = JSON.stringify(projectBranchSelections);
    }
    if (organizationId) {
      params.organizationId = organizationId;
    }

    const response = await gatewayAPI.get(
      `/team/${teamId}/report/${reportType}/${format}`,
      { params }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Generates a report for a manual selection of projects.
 * Allows generating consolidated reports for specific project combinations.
 * @param organizationId - The ID of the organization (required for permissions).
 * @param projectIds - Array of project IDs to include in the report.
 * @param reportType - Type of report ("owasp" or "cwe").
 * @param format - Output format ("json", "html", or "pdf").
 * @param detailed - Whether to generate a detailed report (optional, default: true).
 * @returns The batch report data.
 */
export const generateBatchReport = async (
  organizationId: string,
  projectIds: string[],
  reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
  format: 'json' | 'html' | 'pdf',
  detailed?: boolean,
  branchFilter?: string,
  projectBranchSelections?: ProjectBranchSelection[]
): Promise<GenerateAggregatedReportResponse> => {
  try {
    const body: GenerateBatchReportBodyDto = {
      projectIds,
      detailed: detailed !== undefined ? detailed : true,
      branchFilter: branchFilter || 'all',
      projectBranchSelections: branchFilter === 'selected' ? projectBranchSelections : undefined,
    };

    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/report/batch/${reportType}/${format}`,
      body
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Poll an async aggregated report and, when ready, a freshly signed download
 * URL. Org + batch reports poll the org route; team reports poll the team
 * route. Mirrors getGeneratedReport (per-project) for error handling.
 */
export const getGeneratedAggregatedReport = async (
  scope: { type: 'organization' | 'team'; id: string },
  reportId: string
): Promise<GetGeneratedAggregatedReportResponse> => {
  try {
    const path =
      scope.type === 'team'
        ? `/team/${scope.id}/reports/${reportId}`
        : `/organization/${scope.id}/reports/${reportId}`;
    const response = await gatewayAPI.get(path);
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
};

/**
 * Stored-report history (list + delete). The list returns summaries
 * only (no download URL); the URL is re-minted on demand via
 * getGeneratedReport / getGeneratedAggregatedReport when the user downloads.
 */
export interface StoredReportItem {
  reportId: string;
  kind?: string; // per-project: owasp | cwe | eu_ai_act | scanner_type
  reportType?: string; // aggregated: owasp | cwe | license | ai-act
  scopeType?: string;
  scopeId?: string;
  format: string;
  status: 'queued' | 'ready' | 'failed';
  filename: string;
  branch?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface StoredReportsPage {
  items: StoredReportItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Org-wide shared stored-report usage. `used` counts project + org
 * reports against one common pool; `limit` is the plan's maxStoredReports
 * (-1 = unlimited / unknown).
 */
export interface ReportUsage {
  used: number;
  limit: number;
}

export const getProjectReportUsage = async (
  projectId: string
): Promise<ReportUsage> => {
  const response = await gatewayAPI.get(`/project/${projectId}/reports/usage`);
  return response.data;
};

export const getOrganizationReportUsage = async (
  organizationId: string
): Promise<ReportUsage> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/reports/usage`
  );
  return response.data;
};

export const listProjectReports = async (
  projectId: string,
  page = 1,
  pageSize = 10
): Promise<StoredReportsPage> => {
  const response = await gatewayAPI.get(`/project/${projectId}/reports`, {
    params: { page, pageSize },
  });
  return response.data;
};

export const listOrganizationReports = async (
  organizationId: string,
  page = 1,
  pageSize = 10
): Promise<StoredReportsPage> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/reports`,
    { params: { page, pageSize } }
  );
  return response.data;
};

export const listTeamReports = async (
  teamId: string,
  page = 1,
  pageSize = 10
): Promise<StoredReportsPage> => {
  const response = await gatewayAPI.get(`/team/${teamId}/reports`, {
    params: { page, pageSize },
  });
  return response.data;
};

export const deleteProjectReport = async (
  projectId: string,
  reportId: string
): Promise<void> => {
  await gatewayAPI.delete(`/project/${projectId}/reports/${reportId}`);
};

export const deleteOrganizationReport = async (
  organizationId: string,
  reportId: string
): Promise<void> => {
  await gatewayAPI.delete(`/organization/${organizationId}/reports/${reportId}`);
};

export const deleteTeamReport = async (
  teamId: string,
  reportId: string
): Promise<void> => {
  await gatewayAPI.delete(`/team/${teamId}/reports/${reportId}`);
};

/**
 * =========== GROUPED VULNERABILITIES ===============
 */

/**
 * Fetch grouped SAST vulnerabilities by rule
 */
export const fetchGroupedSastResults = profiler('fetchGroupedSastResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    languageFilter?: string[];
    sourcePath?: string;
    statusFilter?: string[];
    priorityFilter?: string[];
    categoryFilter?: string[];
    exploitabilityFilter?: string[];
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {}
): Promise<GetGroupedVulnerabilitiesResponse> => {
  try {
    const params: any = {
      page: options.page || 1,
      perPage: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severityFilter = options.severityFilter;
    }
    if (options.languageFilter && options.languageFilter.length > 0) {
      params.languageFilter = options.languageFilter;
    }
    if (options.sourcePath) {
      params.sourcePath = options.sourcePath;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.statusFilter = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priorityFilter = options.priorityFilter;
    }
    if (options.categoryFilter && options.categoryFilter.length > 0) {
      params.categoryFilter = options.categoryFilter;
    }
    if (options.exploitabilityFilter && options.exploitabilityFilter.length > 0) {
      params.exploitabilityFilter = options.exploitabilityFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sast/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch grouped IAC vulnerabilities by rule
 */
export const fetchGroupedIacResults = profiler('fetchGroupedIacResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    languageFilter?: string[];
    sourcePath?: string;
    statusFilter?: string[];
    priorityFilter?: string[];
    categoryFilter?: string[];
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {}
): Promise<GetGroupedVulnerabilitiesResponse> => {
  try {
    const params: any = {
      page: options.page || 1,
      perPage: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severityFilter = options.severityFilter;
    }
    if (options.languageFilter && options.languageFilter.length > 0) {
      params.languageFilter = options.languageFilter;
    }
    if (options.sourcePath) {
      params.sourcePath = options.sourcePath;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.statusFilter = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priorityFilter = options.priorityFilter;
    }
    if (options.categoryFilter && options.categoryFilter.length > 0) {
      params.categoryFilter = options.categoryFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/iac/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch grouped CICD vulnerabilities by rule
 */
export const fetchGroupedCicdResults = profiler('fetchGroupedCicdResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    languageFilter?: string[];
    sourcePath?: string;
    statusFilter?: string[];
    priorityFilter?: string[];
    categoryFilter?: string[];
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {}
): Promise<GetGroupedVulnerabilitiesResponse> => {
  try {
    const params: any = {
      page: options.page || 1,
      perPage: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severityFilter = options.severityFilter;
    }
    if (options.languageFilter && options.languageFilter.length > 0) {
      params.languageFilter = options.languageFilter;
    }
    if (options.sourcePath) {
      params.sourcePath = options.sourcePath;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.statusFilter = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priorityFilter = options.priorityFilter;
    }
    if (options.categoryFilter && options.categoryFilter.length > 0) {
      params.categoryFilter = options.categoryFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/cicd/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch grouped Secret vulnerabilities by rule
 */
export const fetchGroupedSecretResults = profiler('fetchGroupedSecretResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    languageFilter?: string[];
    sourcePath?: string;
    statusFilter?: string[];
    priorityFilter?: string[];
    categoryFilter?: string[];
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    /** Filter by secret source: 'head' | 'history' */
    source?: string[];
    scoringSource?: string;
    /** Leave the autofix counts out of the response (Results pages; the AutoFix page reads them). */
    excludeAutofixCounts?: boolean;
  } = {}
): Promise<GetGroupedVulnerabilitiesResponse> => {
  try {
    const params: any = {
      page: options.page || 1,
      perPage: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severityFilter = options.severityFilter;
    }
    if (options.languageFilter && options.languageFilter.length > 0) {
      params.languageFilter = options.languageFilter;
    }
    if (options.sourcePath) {
      params.sourcePath = options.sourcePath;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.statusFilter = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priorityFilter = options.priorityFilter;
    }
    if (options.categoryFilter && options.categoryFilter.length > 0) {
      params.categoryFilter = options.categoryFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.source && options.source.length > 0) {
      params.sourceFilter = options.source;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }

    if (options.excludeAutofixCounts) {
      params.excludeAutofixCounts = true;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/secret/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch grouped SCA vulnerabilities by CVE + package
 */
export const fetchGroupedScaResults = profiler('fetchGroupedScaResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    statusFilter?: string[];
    priorityFilter?: string[];
    exploitabilityFilter?: string[];
    packageManagerFilter?: string[];
    packageManager?: string[];
    packageSource?: string[];
    fixableFilter?: boolean;
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    scoringSource?: string;
    /** When true, return ONLY malware findings; unset/false EXCLUDES malware. */
    malwareOnly?: boolean;
  } = {}
): Promise<GetGroupedScaVulnerabilitiesResponse> => {
  try {
    const params: any = {
      page: options.page || 1,
      perPage: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severityFilter = options.severityFilter;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.statusFilter = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priorityFilter = options.priorityFilter;
    }
    if (options.exploitabilityFilter && options.exploitabilityFilter.length > 0) {
      params.exploitabilityVerdict = options.exploitabilityFilter;
    }
    if (options.packageManagerFilter && options.packageManagerFilter.length > 0) {
      params.packageManagerFilter = options.packageManagerFilter;
    }
    if (options.packageManager && options.packageManager.length > 0) {
      params.packageManager = options.packageManager;
    }
    if (options.packageSource && options.packageSource.length > 0) {
      params.packageSource = options.packageSource;
    }
    if (options.fixableFilter !== undefined) {
      params.hasAutofix = options.fixableFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }
    // Only send malwareOnly when true — unset/false lets the backend
    // apply its default behaviour (EXCLUDE malware from the Vulnerabilities list).
    if (options.malwareOnly) {
      params.malwareOnly = true;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/sca/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch container vulnerabilities grouped by package (name + version).
 * Accepts the same SCA-style option names as the other grouped fetchers and
 * translates them to the container route's DTO params (limit/severity/classType/…).
 */
export const fetchGroupedContainerResults = profiler('fetchGroupedContainerResults')(async (
  projectId: string,
  scanResultId?: string,
  options: {
    page?: number;
    perPage?: number;
    severityFilter?: string[];
    statusFilter?: string[];
    priorityFilter?: string[];
    exploitabilityFilter?: string[];
    classTypeFilter?: string[];
    fixableFilter?: boolean;
    searchQuery?: string;
    sort?: string;
    order?: string;
    branch?: string;
    scoringSource?: string;
    imageId?: string;
  } = {}
): Promise<GetGroupedContainerVulnerabilitiesResponse> => {
  try {
    const params: Record<string, any> = {
      page: options.page || 1,
      limit: options.perPage || 50,
    };

    if (scanResultId) {
      params.scanResultId = scanResultId;
    }
    if (options.severityFilter && options.severityFilter.length > 0) {
      params.severity = options.severityFilter;
    }
    if (options.statusFilter && options.statusFilter.length > 0) {
      params.status = options.statusFilter;
    }
    if (options.priorityFilter && options.priorityFilter.length > 0) {
      params.priority = options.priorityFilter;
    }
    if (options.exploitabilityFilter && options.exploitabilityFilter.length > 0) {
      params.exploitabilityVerdict = options.exploitabilityFilter;
    }
    if (options.classTypeFilter && options.classTypeFilter.length > 0) {
      params.classType = options.classTypeFilter;
    }
    if (options.fixableFilter !== undefined) {
      params.hasAutofix = options.fixableFilter;
    }
    if (options.searchQuery) {
      params.searchQuery = options.searchQuery;
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.order) {
      params.order = options.order;
    }
    if (options.branch) {
      params.branch = options.branch;
    }
    if (options.scoringSource) {
      params.scoringSource = options.scoringSource;
    }
    if (options.imageId) {
      params.imageId = options.imageId;
    }

    const response = await gatewayAPI.get(
      `/project/${projectId}/results/container/grouped`,
      {
        params,
        paramsSerializer: p =>
          qs.stringify(p, { arrayFormat: 'repeat', encode: false }),
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch similar vulnerabilities (same rule/CVE) for a given vulnerability
 */
export const fetchSimilarVulnerabilities = profiler('fetchSimilarVulnerabilities')(async (
  projectId: string,
  vulnerabilityId: string,
  scanResultId: string
): Promise<GetVulnerabilityWithSimilarResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/${vulnerabilityId}/similar`,
      {
        params: { scanResultId },
      }
    );

    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch the code knowledge graph for a project
 */
/**
 * Fetch priority decomposition for a vulnerability
 */
export const fetchPriorityDecomposition = profiler('fetchPriorityDecomposition')(async (
  projectId: string,
  vulnerabilityId: string,
  vulnerabilityType: string
): Promise<PriorityDecompositionResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/${vulnerabilityType}/${vulnerabilityId}/priority-decomposition`
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Fetch top vulnerabilities across all types for a project
 */
export const fetchTopVulnerabilities = profiler('fetchTopVulnerabilities')(async (
  projectId: string,
  limit: number = 5
): Promise<GetTopVulnerabilitiesResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/results/top-vulnerabilities`,
      { params: { limit } }
    );
    return response.data;
  } catch (error: any) {
    throw error.response?.data || error;
  }
});

/**
 * Paginated, searchable branch list for the unified branch selector.
 * Backed by GET /project/:projectId/branches/list
 */
export interface BranchListItem {
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  archived: boolean;
}
export interface BranchListResponse {
  branches: BranchListItem[];
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean };
  defaultBranch: string;
  scanBranch: string;
}

// Identical /branches/list requests in flight share one HTTP call: the results
// pages ask for the same default view from their page data and from the branch
// selector, in the same commit.
const pendingBranchesListRequests = new Map<string, Promise<BranchListResponse>>();

export const getProjectBranchesList = profiler('getProjectBranchesList')(async (
  projectId: string,
  params: { search?: string; page?: number; pageSize?: number; includeArchived?: boolean },
): Promise<BranchListResponse> => {
  const query = {
    search: params.search || undefined,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 30,
    includeArchived: params.includeArchived ?? false,
  };
  const requestKey = JSON.stringify([projectId, query.search ?? '', query.page, query.pageSize, query.includeArchived]);
  const inFlight = pendingBranchesListRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
      const response = await gatewayAPI.get(`/project/${projectId}/branches/list`, {
        params: query,
      });
      return response.data as BranchListResponse;
    } catch (error: any) {
      throw error.response?.data || error;
    } finally {
      pendingBranchesListRequests.delete(requestKey);
    }
  })();
  pendingBranchesListRequests.set(requestKey, request);
  return request;
});

