import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState } from '@/server/store';
import scanService from '@/server/services/scanService';
import { startScanForLastCommitAndProject } from '@/server/services/integrations/githubIntegrationsService';
import { startScanForLastCommitAndProjectGitlab } from '@/server/services/integrations/gitlabIntegrationsService';
import type { Product } from '@/utils/product';
import { LocalizedError } from '@/utils/function/apiErrorKey';

/**
 * Starting an analysis of a project, in one place.
 *
 * Two paths, the two the backend offers: the last commit of the repository the
 * project is linked to (GitHub or GitLab), or an archive the user uploads. The
 * hook owns the modal's state, the validation, the calls, the upload progress
 * and a guard against a second submit while one is out.
 *
 * It owns nothing of what comes next. Following the analysis, showing a loader
 * or a note is the caller's business, told through the callbacks: the six
 * AppSec results pages open their loader, another space updates its notice.
 */
export type StartAnalysisKind = 'repository' | 'archive';

/** `creating`: the start request is out. `uploading`: the analysis exists, its archive is being sent. */
export type StartAnalysisPhase = 'idle' | 'creating' | 'uploading';

export interface StartAnalysisRepository {
  type: 'github' | 'gitlab' | 'none';
  repositoryId: string | null;
}

/**
 * Why a start did not happen, as a closed list read from the HTTP status only.
 * It is what a caller may put on screen: the backend's own message is never
 * part of it.
 *
 * Each value is what its status can mean at this endpoint, no more:
 *  - `already_running` (409): an analysis of the project is in progress;
 *  - `too_many_requests` (429): the request throttler. A spent trial or the
 *    concurrency limit do not answer 429 — the first is accepted and fails
 *    later, the second queues the analysis;
 *  - `not_allowed` (403): the role lacks `start_scan`, or the organisation is
 *    read-only;
 *  - `archive_too_large` (413);
 *  - `graph_only_project_busy` / `graph_only_org_limit` (429 with the body
 *    code `GRAPH_ONLY_PROJECT_BUSY` / `GRAPH_ONLY_ORG_LIMIT`): a graph-only
 *    analysis (another space's) is already in flight for the project, or three are
 *    for the organisation. Only the code, compared with these two literals,
 *    is read from the body.
 */
export type StartAnalysisRefusal =
  | 'already_running'
  | 'too_many_requests'
  | 'graph_only_project_busy'
  | 'graph_only_org_limit'
  | 'not_allowed'
  | 'archive_too_large'
  | 'failed';

export interface StartAnalysisFailure {
  kind: StartAnalysisKind;
  refusal: StartAnalysisRefusal;
  /**
   * The error as it was thrown. The AppSec results pages read their loader's
   * detail line from it, as they always have; nothing new should display it.
   */
  error: unknown;
}

export interface StartAnalysisBranchChoice {
  /** How many branches the picker offers. With none, the flow is the archive upload. */
  available: number;
  /** The branch the picker holds; empty when none can be chosen. */
  selected: string;
}

export interface UseStartAnalysisOptions {
  /** The repository the project is linked to. Absent, null or `none`: the archive upload. */
  repository?: StartAnalysisRepository | null;
  /**
   * Set by a page that lets the user pick the branch to analyse: the repository
   * path then needs a listed branch, and sends the one picked. Left out, the
   * analysis runs on the last commit of the repository's default branch.
   */
  branch?: StartAnalysisBranchChoice;
  /** Refuse an archive start while no organisation is selected. */
  requireOrganization?: boolean;
  /**
   * The product the analysis is for, on a linked repository as on an
   * uploaded archive. Another space than AppSec starts a graph-only
   * analysis (code graph and rule mining, no AppSec scanner, no counter).
   * Left out: AppSec, as before.
   */
  product?: Product;
  /** A start was accepted: the form is valid and the modal closed. Nothing has left yet. */
  onStart?: (kind: StartAnalysisKind) => void;
  /** Archive path: the analysis exists and its archive starts uploading. */
  onUploadStart?: () => void;
  /** The analysis was started (and, on the archive path, its archive uploaded). */
  onStarted?: (scanId: string | undefined, kind: StartAnalysisKind) => void;
  /** The start was refused or failed. */
  onError?: (failure: StartAnalysisFailure) => void;
}

export interface StartAnalysisErrors {
  file?: string;
  branchName?: string;
}

export interface StartAnalysis {
  isOpen: boolean;
  open: () => void;
  /** Closes the modal and drops the chosen file and the errors. The branch name stays. */
  close: () => void;
  /** What a submit will do. */
  mode: StartAnalysisKind;
  errors: StartAnalysisErrors;
  setSelectedFile: (file: File | null) => void;
  /** Branch the uploaded archive is filed under. */
  manualBranchName: string;
  setManualBranchName: (name: string) => void;
  submit: () => Promise<void>;
  phase: StartAnalysisPhase;
  /** A start is out, whichever path. */
  isStarting: boolean;
  /** An archive start is out, from the submit to the end of the upload. */
  isStartingArchive: boolean;
  /** The archive is being sent. */
  isUploading: boolean;
  /** 0 to 100 while the archive is being sent. */
  uploadProgress: number;
}

export function startAnalysisRefusal(error: unknown): StartAnalysisRefusal {
  const response =
    typeof error === 'object' && error !== null
      ? (error as { response?: { status?: unknown; data?: unknown } }).response
      : undefined;
  const status = response?.status;
  const code =
    typeof response?.data === 'object' && response.data !== null ? (response.data as { code?: unknown }).code : undefined;
  switch (status) {
    case 409:
      return 'already_running';
    case 429:
      if (code === 'GRAPH_ONLY_PROJECT_BUSY') return 'graph_only_project_busy';
      if (code === 'GRAPH_ONLY_ORG_LIMIT') return 'graph_only_org_limit';
      return 'too_many_requests';
    case 403:
      return 'not_allowed';
    case 413:
      return 'archive_too_large';
    default:
      return 'failed';
  }
}

/** The start calls answer their id as `scanId`, `scan_id` or `id`. */
function scanIdOf(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const { scanId, scan_id: snakeCaseId, id } = response as Record<string, unknown>;
  const found = scanId || snakeCaseId || id;
  return typeof found === 'string' && found.trim() !== '' ? found : undefined;
}

const DEFAULT_BRANCH_NAME = 'main';

export function useStartAnalysis(
  projectId: string | undefined,
  options: UseStartAnalysisOptions = {},
): StartAnalysis {
  const { t } = useTranslation();
  const organizationId = useSelector(
    (state: RootState) => state.organization.selectedOrganization?.id,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<StartAnalysisErrors>({});
  const [manualBranchName, setManualBranchName] = useState(DEFAULT_BRANCH_NAME);
  const [phase, setPhase] = useState<StartAnalysisPhase>('idle');
  const [kind, setKind] = useState<StartAnalysisKind | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // A ref, not the state: two clicks of the same render must see each other.
  const inFlight = useRef(false);
  // The callbacks of the latest render: a start outlives the render that began it.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const { repository, branch, requireOrganization, product } = options;
  const linked = !!repository && repository.type !== 'none';
  const mode: StartAnalysisKind =
    linked && (branch ? branch.available > 0 : !!repository.repositoryId) ? 'repository' : 'archive';

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setSelectedFile(null);
    setErrors({});
  }, []);

  const run = useCallback(
    async (startKind: StartAnalysisKind, start: () => Promise<string | undefined>) => {
      inFlight.current = true;
      setKind(startKind);
      setPhase('creating');
      try {
        const scanId = await start();
        latest.current.onStarted?.(scanId, startKind);
      } catch (error) {
        latest.current.onError?.({ kind: startKind, refusal: startAnalysisRefusal(error), error });
      } finally {
        inFlight.current = false;
        setPhase('idle');
        setUploadProgress(0);
      }
    },
    [],
  );

  const submit = useCallback(async () => {
    if (inFlight.current) return;

    if (mode === 'repository') {
      const branchName = branch ? branch.selected : undefined;
      if (branch && !branchName) {
        setErrors({ file: t('components.branchSelector.selectBranch') });
        return;
      }
      close();
      await run('repository', async () => {
        latest.current.onStart?.('repository');
        if (!projectId || !repository?.repositoryId) {
          throw new Error(t('components.startAnalysis.errors.noRepository'));
        }
        const { repositoryId } = repository;
        if (repository.type === 'github') {
          const organization = organizationId ?? '';
          if (product) {
            return scanIdOf(
              await startScanForLastCommitAndProject(projectId, repositoryId, organization, branchName, product),
            );
          }
          return scanIdOf(
            branchName
              ? await startScanForLastCommitAndProject(projectId, repositoryId, organization, branchName)
              : await startScanForLastCommitAndProject(projectId, repositoryId, organization),
          );
        }
        if (product) {
          return scanIdOf(
            await startScanForLastCommitAndProjectGitlab(projectId, repositoryId, branchName, product),
          );
        }
        return scanIdOf(
          branchName
            ? await startScanForLastCommitAndProjectGitlab(projectId, repositoryId, branchName)
            : await startScanForLastCommitAndProjectGitlab(projectId, repositoryId),
        );
      });
      return;
    }

    const validation: StartAnalysisErrors = {};
    if (!selectedFile) {
      validation.file = t('components.fileInput.error.zipOnly');
    }
    if (!manualBranchName || manualBranchName.trim() === '') {
      validation.branchName = t('components.analyseWrapper.branchNameRequired');
    }
    if (!selectedFile || Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    const file = selectedFile;
    close();
    if (!projectId) return;
    await run('archive', async () => {
      if (requireOrganization && !organizationId) {
        throw new LocalizedError('components.startAnalysis.errors.noOrganization');
      }
      latest.current.onStart?.('archive');
      const { url, scanId } = await scanService.startScan(projectId, {
        branch: manualBranchName || DEFAULT_BRANCH_NAME,
        ...(product ? { product } : {}),
      });
      setPhase('uploading');
      setUploadProgress(0);
      latest.current.onUploadStart?.();
      await scanService.uploadFileToSignedUrl(
        url,
        file,
        (progress: { loaded: number; total: number }) => {
          setUploadProgress(Math.round((progress.loaded * 100) / progress.total));
        },
      );
      return scanId;
    });
  }, [
    mode,
    branch,
    repository,
    requireOrganization,
    product,
    projectId,
    organizationId,
    selectedFile,
    manualBranchName,
    close,
    run,
    t,
  ]);

  const isStarting = phase !== 'idle';

  return {
    isOpen,
    open,
    close,
    mode,
    errors,
    setSelectedFile,
    manualBranchName,
    setManualBranchName,
    submit,
    phase,
    isStarting,
    isStartingArchive: isStarting && kind === 'archive',
    isUploading: phase === 'uploading',
    uploadProgress,
  };
}

export default useStartAnalysis;
