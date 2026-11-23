/**
 * Utility functions for managing parsed branches
 * Used to determine AI feature availability based on branch parsing status
 */

import { ParsedBranch, ParsedBranchStatus, Project, ProjectAnalysis } from '@/server/interfaces/Project';

/**
 * Parsing status constants - matching backend string values
 */
export const PARSED_BRANCH_STATUS = {
  UNSPECIFIED: 'BRANCH_INGESTION_STATUS_UNSPECIFIED' as ParsedBranchStatus,
  PARSING: 'BRANCH_INGESTION_STATUS_PARSING' as ParsedBranchStatus,
  PARSED: 'BRANCH_INGESTION_STATUS_PARSED' as ParsedBranchStatus,
  FAILED: 'BRANCH_INGESTION_STATUS_FAILED' as ParsedBranchStatus,
} as const;

/**
 * Helper function to check if a branch is ready for AI features
 * A branch is considered "parsed" and ready if:
 * 1. Its status is explicitly PARSED, OR
 * 2. It has a lastParsedAt date (proof it was parsed at least once)
 * 
 * Note: Backend may use UNSPECIFIED status even for parsed branches,
 * so we also check lastParsedAt as a fallback indicator.
 */
function isBranchReady(branch: ParsedBranch | null | undefined): boolean {
  if (!branch) return false;
  
  const status = branch.status as string | number | undefined;
  
  // Check if status explicitly indicates parsed
  if (status) {
    if (typeof status === 'string') {
      if (status === PARSED_BRANCH_STATUS.PARSED || 
          status === 'PARSED' || 
          status.toUpperCase().includes('PARSED')) {
        return true;
      }
    }
    if (typeof status === 'number' && status === 2) {
      return true;
    }
  }
  
  // Fallback: if branch has lastParsedAt, it was parsed successfully at some point
  // This handles the case where status is UNSPECIFIED but branch was actually parsed
  if (branch.lastParsedAt) {
    return true;
  }
  
  return false;
}

/**
 * Check if a project has any parsed branches (ready for AI features)
 * @param project - Project or ProjectAnalysis object
 * @returns true if project has at least one successfully parsed branch
 */
export function hasParsedBranches(project: Project | ProjectAnalysis | null | undefined): boolean {
  if (!project) return false;
  const branches = project.parsedBranches;
  if (!branches || branches.length === 0) return false;
  return branches.some(b => isBranchReady(b));
}

/**
 * Get all successfully parsed branches (ready for AI features)
 * @param project - Project or ProjectAnalysis object
 * @returns Array of parsed branches that are ready for AI features
 */
export function getParsedBranches(project: Project | ProjectAnalysis | null | undefined): ParsedBranch[] {
  if (!project?.parsedBranches) return [];
  return project.parsedBranches.filter(b => isBranchReady(b));
}

/**
 * Check if a specific branch is parsed
 * @param project - Project or ProjectAnalysis object
 * @param branchName - Name of the branch to check
 * @returns true if the specific branch is parsed
 */
export function isBranchParsed(
  project: Project | ProjectAnalysis | null | undefined,
  branchName: string | null | undefined
): boolean {
  if (!project?.parsedBranches || !branchName) return false;
  const branch = project.parsedBranches.find(b => b.branch === branchName);
  return isBranchReady(branch);
}

/**
 * Get parsed branch data by branch name
 * @param project - Project or ProjectAnalysis object
 * @param branchName - Name of the branch to find
 * @returns ParsedBranch data if found and parsed, undefined otherwise
 */
export function getParsedBranchByName(
  project: Project | ProjectAnalysis | null | undefined,
  branchName: string | null | undefined
): ParsedBranch | undefined {
  if (!project?.parsedBranches || !branchName) return undefined;
  const branch = project.parsedBranches.find(b => b.branch === branchName);
  return branch && isBranchReady(branch) ? branch : undefined;
}

/**
 * Get the default parsed branch (prefers 'main', then 'master', then first available)
 * @param project - Project or ProjectAnalysis object
 * @returns Default parsed branch or undefined if none available
 */
export function getDefaultParsedBranch(project: Project | ProjectAnalysis | null | undefined): ParsedBranch | undefined {
  const parsedBranches = getParsedBranches(project);
  if (parsedBranches.length === 0) return undefined;
  
  // Prefer main branch
  const mainBranch = parsedBranches.find(b => b.branch === 'main');
  if (mainBranch) return mainBranch;
  
  // Fallback to master
  const masterBranch = parsedBranches.find(b => b.branch === 'master');
  if (masterBranch) return masterBranch;
  
  // Return first available parsed branch
  return parsedBranches[0];
}

/**
 * Get potpieProjectId for a specific branch (backward compatibility helper)
 * @param project - Project or ProjectAnalysis object
 * @param branchName - Optional branch name, defaults to main/master/first available
 * @returns potpieProjectId string or undefined
 */
export function getPotpieProjectId(
  project: Project | ProjectAnalysis | null | undefined,
  branchName?: string | null
): string | undefined {
  if (!project) return undefined;
  
  // If branch specified, try to get it
  if (branchName) {
    const parsedBranch = getParsedBranchByName(project, branchName);
    if (parsedBranch) return parsedBranch.potpieProjectId;
  }
  
  // Fallback to default branch
  const defaultBranch = getDefaultParsedBranch(project);
  return defaultBranch?.potpieProjectId;
}

/**
 * Check if AI features should be available for a project
 * @param project - Project or ProjectAnalysis object
 * @param branchName - Optional branch name to check specific branch
 * @returns true if AI features should be shown
 */
export function isAIAvailable(
  project: Project | ProjectAnalysis | null | undefined,
  branchName?: string | null
): boolean {
  if (!project) return false;
  
  // The AI chat flag must be enabled at project level
  if (!project.securityChampionEnabled) return false;
  
  // If no branch specified, check if any branch is parsed
  if (!branchName) {
    return hasParsedBranches(project);
  }
  
  // Check if specific branch is parsed
  return isBranchParsed(project, branchName);
}

/**
 * Get parsing status label for display
 * @param status - ParsedBranchStatus value
 * @returns Human-readable status string
 */
export function getParsingStatusLabel(status: ParsedBranchStatus): 'parsing' | 'parsed' | 'failed' {
  switch (status) {
    case PARSED_BRANCH_STATUS.PARSING:
      return 'parsing';
    case PARSED_BRANCH_STATUS.PARSED:
      return 'parsed';
    case PARSED_BRANCH_STATUS.FAILED:
      return 'failed';
    default:
      return 'failed';
  }
}

/**
 * Get all branches with their parsing status
 * @param project - Project or ProjectAnalysis object
 * @returns Array of all branches with status info
 */
export function getAllBranchesWithStatus(project: Project | ProjectAnalysis | null | undefined): ParsedBranch[] {
  return project?.parsedBranches ?? [];
}

/**
 * Check if any branch is currently being parsed
 * @param project - Project or ProjectAnalysis object
 * @returns true if at least one branch has status = 1 (PARSING)
 */
export function hasParsingInProgress(project: Project | ProjectAnalysis | null | undefined): boolean {
  if (!project?.parsedBranches) return false;
  return project.parsedBranches.some(b => b.status === PARSED_BRANCH_STATUS.PARSING);
}
