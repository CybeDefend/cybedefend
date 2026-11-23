import type { ScanResponseDto } from '@/server/interfaces/Scan';
import { apiErrorKey, translateKey } from '@/utils/function/apiErrorKey';

/**
 * What a results page puts in its loader around the start of an analysis,
 * before the backend has a scan to show. The start itself is `useStartAnalysis`;
 * this is only the AppSec loader's side of it.
 */

/**
 * The scan a results page shows while there is none yet: `initializing` once a
 * start was accepted (it also clears the error of a previous attempt), `failed`
 * when the start was refused.
 */
export function placeholderScan(
  projectId: string,
  state: 'initializing' | 'failed',
  errorMessage?: string,
): ScanResponseDto {
  return {
    id: '',
    name: '',
    language: [],
    projectId,
    state,
    progress: 0,
    step: state,
    vulnerabilityDetected: 0,
    private: false,
    containers: [],
    createAt: new Date(),
    updatedAt: new Date(),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  };
}

/**
 * The detail line of a refused start on a linked repository: a fixed
 * sentence chosen by the refusal's status, else the caller's generic one.
 * The server's and the HTTP client's own text are never shown.
 */
export function repositoryStartErrorMessage(error: unknown, generic: string): string {
  const key = apiErrorKey(error, { fallback: '' });
  return key ? translateKey(key) : generic;
}

/**
 * The detail line of a refused archive start: too large on a 413, else the
 * same fixed sentences as a repository start.
 */
export function archiveStartErrorMessage(
  error: unknown,
  messages: { generic: string; tooLarge: string },
): string {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  if (status === 413) return messages.tooLarge;
  return repositoryStartErrorMessage(error, messages.generic);
}
