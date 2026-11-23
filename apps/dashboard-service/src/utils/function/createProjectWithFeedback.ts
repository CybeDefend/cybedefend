import { toast } from 'react-toastify';
import { createProject } from '@/server/services/projectService';
import type { Project } from '@/server/interfaces/Project';
import type { Product } from '@/utils/product';
import { apiErrorText } from '@/utils/function/apiErrorKey';

export interface CreateProjectInput {
  teamId: string;
  projectName: string;
  aiMergeRequestEnabled?: boolean;
  improvingResultsEnabled?: boolean;
  sortsVulnerabilitiesEnabled?: boolean;
  securityChampionEnabled?: boolean;
  securityContext?: Record<string, unknown>;
  /** The space the project is created from. */
  product?: Product;
}

interface BackendError {
  response?: { status?: number; data?: { message?: unknown } };
  __toastHandled?: boolean;
}

/**
 * True when project creation was refused because the plan's project limit is
 * reached: the backend's RESOURCE_EXHAUSTED, mapped to HTTP 429, or its message
 * under another status.
 *
 * The one definition, read by this module (which then stays silent) and by the
 * creation wizard (which shows its localized message): two copies could drift
 * and the user would get either two toasts or none.
 */
export const isProjectLimitError = (error: unknown): boolean => {
  const backend = error as BackendError | null | undefined;
  if (backend?.response?.status === 429) return true;
  const message = backend?.response?.data?.message; // not shown: matched against a fixed refusal
  return typeof message === 'string' && /project limit reached/i.test(message);
};

/**
 * Creates a project and surfaces a translated error sentence, shared by the AppSec
 * and the home pages of the other product spaces.
 *
 * A project-limit error (HTTP 429) is left to the wizard, which has a localized
 * message for it; any other failure is shown here as a fixed sentence and the error is
 * tagged so the wizard does not raise a second, generic toast. The error is
 * always re-thrown: the wizard keeps its state so the user can correct and retry.
 */
export async function createProjectWithFeedback(input: CreateProjectInput): Promise<Project> {
  try {
    return await createProject(
      input.teamId,
      input.projectName,
      input.aiMergeRequestEnabled,
      input.improvingResultsEnabled,
      input.sortsVulnerabilitiesEnabled,
      input.securityChampionEnabled,
      input.securityContext,
      input.product,
    );
  } catch (error) {
    const backend = error as BackendError;
    // A refusal the server answered gets its fixed sentence here; a request
    // that got no answer is left to the wizard's own message.
    if (!isProjectLimitError(error) && backend?.response) {
      toast.error(apiErrorText(error));
      backend.__toastHandled = true;
    }
    throw error;
  }
}
