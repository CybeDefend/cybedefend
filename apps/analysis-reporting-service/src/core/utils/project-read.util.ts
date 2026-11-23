import { lastValueFrom } from 'rxjs';
import {
  BranchIngestionInfo,
  BranchIngestionStatus,
  ProjectGetRequest,
} from '@grpc/global-management/project';
import { ProjectServiceClient } from '@grpc/global-management/global_management';

/**
 * The lean ProjectService/Get for a caller that reads only the
 * project's own settings (flags, name, organizationId, teamId, referenceBranch,
 * parsedBranches). It skips the vulnerability stats — which global-management
 * fetched from this very service — the integration status and the security
 * context. A global-management that predates the flags ignores them and
 * answers the full read.
 *
 * cyberRiskScore/cyberRiskLevel, detectedLanguages, isGithubLinked/
 * isGitlabLinked/isJiraLinked, defaultBranch, linkedRepository and
 * securityContext then read as absent: never read them from this response.
 */
export function projectSettingsRequest(projectId: string): ProjectGetRequest {
  return {
    projectId,
    skipVulnerabilityStats: true,
    skipIntegrationStatus: true,
    skipSecurityContext: true,
  };
}

/**
 * Same as projectSettingsRequest, but keeps the integration status for a
 * caller that reads defaultBranch (the linked repository's git default
 * branch, from external-integrations).
 */
export function projectWithDefaultBranchRequest(
  projectId: string,
): ProjectGetRequest {
  return {
    projectId,
    skipVulnerabilityStats: true,
    skipSecurityContext: true,
  };
}

/**
 * True when one of the project's branches has been parsed into a code graph,
 * the meaning of `isProjectParsed`. ProjectService/Get pre-filters its
 * parsedBranches to PARSED; GetProjectBranches returns every ingestion row
 * (parsing and failed ones too), so the status is checked here. The gRPC
 * loader decodes enums as strings (`enums: String`), the generated type says
 * number: both are accepted.
 */
export function hasParsedBranch(
  branches: ReadonlyArray<Pick<BranchIngestionInfo, 'status'>> | undefined,
): boolean {
  return (branches ?? []).some((branch) => {
    const value: unknown = branch?.status;
    return (
      value === BranchIngestionStatus.BRANCH_INGESTION_STATUS_PARSED ||
      value === 'BRANCH_INGESTION_STATUS_PARSED'
    );
  });
}

/** What `readArchivedBranches` read, or why it could not. */
export interface ArchivedBranchesRead {
  /** The archived branch names; null when global-management did not answer. */
  branches: ReadonlySet<string> | null;
  /** Why the read failed (the gRPC status and details), when it did. */
  failure?: string;
}

/**
 * The names of the branches archived in a project. An archived branch is one
 * the customer no longer ships: its findings stay in the database, but no
 * report or alert counts them. When global-management cannot answer, the
 * read says why; the caller then reports every branch, as before, and logs
 * that reason.
 */
export async function readArchivedBranches(
  client: Pick<ProjectServiceClient, 'getArchivedBranches'> | null | undefined,
  projectId: string,
): Promise<ArchivedBranchesRead> {
  if (!client) {
    return { branches: null, failure: 'no ProjectService client' };
  }
  try {
    const { branches } = await lastValueFrom(
      client.getArchivedBranches({ projectId }),
    );
    return {
      branches: new Set((branches ?? []).filter((branch) => branch)),
    };
  } catch (error) {
    return {
      branches: null,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
