import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { GitHistoryPass } from '@grpc/security-scanning/scan';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import {
  fetchBranchHistory,
  FetchedBranchHistory,
} from '../../../core/utils/git-history/fetch-branch-history';
import {
  resolveGitHistoryBudgetBytes,
  resolveGitHistoryDeadlineMs,
} from '../../../core/utils/git-history/history-budget';
import { writeHistoryTar } from '../../../core/utils/git-history/history-tar';
import {
  signedUploadHeaders,
  uploadFileToSignedUrl,
} from '../../../core/utils/signed-url-upload';

/**
 * The git history of one scan, ready for the archive or for its own upload.
 *
 * - `in_archive`: `gitDir` is a bare repository that goes into the scan zip as
 *   `.git`; `null` when the scan carries no history.
 * - `incremental_artifact`: `tarPath` is the history tar uploaded next to the
 *   archive (`null` when there is none), alone in a private directory of its
 *   own, and `pass` what is recorded on the scan, even when its mode is
 *   `none`.
 */
export type PreparedHistory =
  | { mode: 'in_archive'; gitDir: string | null }
  | {
      mode: 'incremental_artifact';
      tarPath: string | null;
      pass: GitHistoryPass;
    };

export interface PrepareHistoryParams {
  scanId: string;
  projectId: string;
  /** The scanned branch: only its history is read. */
  branch: string;
  /** `github:<owner>/<repo>` or `gitlab:<repositoryId>`. */
  repositoryKey: string;
  /**
   * Authenticated clone URL, never logged. `null` when the provider could not
   * get a credential: the scan then goes without history.
   */
  cloneUrl: string | null;
}

export interface PublishHistoryParams {
  scanId: string;
  projectId: string;
  typeScan: string;
}

/** Prefix of every directory this service creates under the OS temp dir. */
const WORK_DIR_PREFIX = 'git-history-';

/** Name of the history tar inside its directory. */
const TAR_NAME = 'history.tar';

/**
 * `true` for a path inside a `git-history-*` directory directly under the OS
 * temp dir, where this service creates its directories (`mkdtemp`). Every
 * recursive removal checks it, so a wrong path can never take a parent such
 * as the temp dir itself.
 */
function isWorkPath(target: string): boolean {
  const rel = path.relative(os.tmpdir(), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0].startsWith(WORK_DIR_PREFIX);
}

/** Suffix of the object key file-management gives a scan's history tar. */
const HISTORY_OBJECT_SUFFIX = '.history.tar';

/**
 * Whether a signed upload URL points at a history tar. A file-management that
 * does not know the artifact kind ignores it and signs the scan's archive
 * key: a PUT there would replace the archive with the history.
 */
function isHistoryTarUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(HISTORY_OBJECT_SUFFIX);
  } catch {
    return false;
  }
}

/** Attempts at recording a pass: one retry for a transient gRPC error. */
const RECORD_ATTEMPTS = 2;

/** Pause before that retry. */
const RECORD_RETRY_DELAY_MS = 500;

/** The `.git` to put into the scan zip: only an `in_archive` history has one. */
export function archiveGitDir(
  prepared: PreparedHistory | null,
): string | undefined {
  return prepared?.mode === 'in_archive'
    ? (prepared.gitDir ?? undefined)
    : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toPass(
  fetched: FetchedBranchHistory,
  repositoryKey: string,
): GitHistoryPass {
  return {
    mode: fetched.mode,
    tipSha: fetched.tipSha ?? undefined,
    baseTipSha: fetched.baseTipSha ?? undefined,
    excludeShas: fetched.excludeShas,
    oldestCommitAt: fetched.oldestCommitAt ?? undefined,
    bytes: String(fetched.bytes),
    gap: fetched.gap
      ? {
          fromSha: fetched.gap.fromSha,
          toSha: fetched.gap.toSha,
          fromDate: fetched.gap.fromDate,
          toDate: fetched.gap.toDate,
        }
      : undefined,
    firstPass: fetched.firstPass,
    repositoryKey,
  };
}

/** A pass that read no history: recorded so the coverage notice says so. */
function nonePass(
  repositoryKey: string,
  baseTipSha: string | null,
  tipSha?: string,
): GitHistoryPass {
  return {
    mode: 'none',
    tipSha,
    baseTipSha: baseTipSha ?? undefined,
    excludeShas: [],
    bytes: '0',
    firstPass: baseTipSha === null,
    repositoryKey,
  };
}

/**
 * A history nothing is known about (the cursor could not be read, the mode is
 * unknown, an unexpected error): a pass of mode `none` is recorded.
 *
 * Without a recorded pass, finalize reads the scan as one without history and
 * resolves the secrets found only in history; later incremental passes never
 * read those commits again, so the secrets would stay resolved. A `none` pass
 * never moves the cursor, and costs nothing where the history goes in the
 * archive.
 */
export function historyUnavailable(repositoryKey: string): PreparedHistory {
  return {
    mode: 'incremental_artifact',
    tarPath: null,
    pass: nonePass(repositoryKey, null),
  };
}

/**
 * The git history of a repository scan, fetched within
 * `GIT_HISTORY_BUDGET_BYTES` (never a whole mirror). Security-scanning decides
 * where it goes (`GetGitHistoryCursor`):
 *
 * - `in_archive`: the bounded history of the scanned branch, as a `.git` in
 *   the scan zip;
 * - `incremental_artifact`: the commits since the branch's last scanned tip,
 *   as a tar uploaded before the archive, with the pass recorded on the scan.
 *
 * A scan never fails because of its history: every failure is a warning and a
 * scan without history (mode `none` when a pass is recorded).
 */
@Injectable()
export class RepoHistoryService implements OnModuleInit {
  private scanServiceClient!: ScanServiceClient;
  private fileServiceClient!: FileServiceClient;

  constructor(
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly scanningClient: ClientGrpc,
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileManagementClient: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.scanServiceClient =
      this.scanningClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
    this.fileServiceClient =
      this.fileManagementClient.getService<FileServiceClient>(
        FILE_SERVICE_NAME,
      );
  }

  /** Fetches the history of the scanned branch. Never throws. */
  async prepare(p: PrepareHistoryParams): Promise<PreparedHistory> {
    try {
      return await this.prepareOrThrow(p);
    } catch (err) {
      this.logger.warn(
        `[git-history] scan ${p.scanId}: the history could not be prepared, history pass recorded as none: ${errorMessage(err)}`,
      );
      return historyUnavailable(p.repositoryKey);
    }
  }

  private async prepareOrThrow(
    p: PrepareHistoryParams,
  ): Promise<PreparedHistory> {
    let mode: string;
    let previousTipSha: string | null;
    try {
      const cursor = await safeGrpcCall(
        this.scanServiceClient.getGitHistoryCursor({
          projectId: p.projectId,
          branch: p.branch,
          repositoryKey: p.repositoryKey,
        }),
      );
      mode = cursor.mode;
      previousTipSha = cursor.tipSha || null;
    } catch (err) {
      this.logger.warn(
        `[git-history] scan ${p.scanId}: the history cursor could not be read, history pass recorded as none: ${errorMessage(err)}`,
      );
      return historyUnavailable(p.repositoryKey);
    }

    // The whole fetch, every deepening step included, ends by this time.
    const deadlineAt = Date.now() + resolveGitHistoryDeadlineMs();
    if (mode === 'incremental_artifact') {
      return this.prepareArtifact(p, previousTipSha, deadlineAt);
    }
    if (mode === 'in_archive') return this.prepareInArchive(p, deadlineAt);
    this.logger.warn(
      `[git-history] scan ${p.scanId}: unknown history mode "${mode}", history pass recorded as none`,
    );
    return historyUnavailable(p.repositoryKey);
  }

  /**
   * Uploads the history tar (signed right before its upload: the URL lives
   * 10 s), then records the pass. Runs before the archive upload, which
   * starts the scan. Nothing to do for an `in_archive` history. Never throws.
   */
  async publish(
    prepared: PreparedHistory,
    p: PublishHistoryParams,
  ): Promise<void> {
    if (prepared.mode !== 'incremental_artifact') return;
    let pass = prepared.pass;
    if (prepared.tarPath) {
      try {
        const { url } = await safeGrpcCall(
          this.fileServiceClient.uploadFile({
            scanId: p.scanId,
            projectId: p.projectId,
            typeScan: p.typeScan,
            artifact: 'history',
          }),
        );
        if (!isHistoryTarUrl(url)) {
          // Never logged: the URL is a credential.
          throw new Error(
            'the signed URL does not point at a history tar (file-management predates the history artifact)',
          );
        }
        await uploadFileToSignedUrl(
          url,
          prepared.tarPath,
          signedUploadHeaders(url, 'application/x-tar'),
        );
      } catch (err) {
        this.logger.warn(
          `[git-history] scan ${p.scanId}: the history upload failed, the scan goes without history: ${errorMessage(err)}`,
        );
        pass = nonePass(
          pass.repositoryKey,
          pass.baseTipSha ?? null,
          pass.tipSha,
        );
      }
    }
    await this.recordPass(p.scanId, pass);
  }

  /** Records the pass, retrying once. Never throws. */
  private async recordPass(
    scanId: string,
    pass: GitHistoryPass,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await safeGrpcCall(
          this.scanServiceClient.recordGitHistoryPass({ scanId, pass }),
        );
        return;
      } catch (err) {
        if (attempt >= RECORD_ATTEMPTS) {
          this.logger.warn(
            `[git-history] scan ${scanId}: the history pass could not be recorded after ${attempt} attempts: ${errorMessage(err)}`,
          );
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RECORD_RETRY_DELAY_MS),
        );
      }
    }
  }

  /** Removes what the history left on disk. Never throws. */
  cleanup(prepared: PreparedHistory): void {
    // The tar's own directory goes with it; a recursive removal only ever
    // targets a directory this service created, never a parent such as the
    // OS temp directory.
    const leftover =
      prepared.mode === 'in_archive'
        ? prepared.gitDir
        : prepared.tarPath && path.dirname(prepared.tarPath);
    if (
      !leftover ||
      path.dirname(leftover) !== os.tmpdir() ||
      !isWorkPath(leftover)
    ) {
      return;
    }
    try {
      fs.rmSync(leftover, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `[git-history] could not remove ${leftover}: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * A fresh private directory (random name, mode 0700): nothing in it can be
   * pre-created by another local user.
   */
  private newWorkDir(): Promise<string> {
    return fsp.mkdtemp(path.join(os.tmpdir(), WORK_DIR_PREFIX));
  }

  private async removeQuietly(target: string): Promise<void> {
    if (!isWorkPath(target)) {
      this.logger.warn(`[git-history] refusing to remove ${target}`);
      return;
    }
    await fsp
      .rm(target, { recursive: true, force: true })
      .catch((err) =>
        this.logger.warn(
          `[git-history] could not remove ${target}: ${errorMessage(err)}`,
        ),
      );
  }

  /** The bounded history of the branch, without a cursor, as a `.git`. */
  private async prepareInArchive(
    p: PrepareHistoryParams,
    deadlineAt: number,
  ): Promise<PreparedHistory> {
    const without: PreparedHistory = { mode: 'in_archive', gitDir: null };
    if (!p.cloneUrl) {
      this.logger.warn(
        `[git-history] scan ${p.scanId}: no credential to fetch the history, scanning without history`,
      );
      return without;
    }
    let repoDir: string | null = null;
    try {
      repoDir = await this.newWorkDir();
      const fetched = await fetchBranchHistory({
        cloneUrl: p.cloneUrl,
        branch: p.branch,
        outputDir: repoDir,
        budgetBytes: resolveGitHistoryBudgetBytes(),
        deadlineAt,
        logger: this.logger,
      });
      if (fetched.mode === 'none') {
        // An empty repository in the zip would make the secret scanner read
        // neither history nor files.
        this.logger.warn(
          `[git-history] scan ${p.scanId}: the tip of the branch alone exceeds the history budget, scanning without history`,
        );
        await this.removeQuietly(repoDir);
        return without;
      }
      return { mode: 'in_archive', gitDir: repoDir };
    } catch (err) {
      if (repoDir) await this.removeQuietly(repoDir);
      this.logger.warn(
        `[git-history] scan ${p.scanId}: the history could not be fetched, scanning without history: ${errorMessage(err)}`,
      );
      return without;
    }
  }

  /**
   * The history since the cursor's tip, written to a tar; the repository is
   * deleted as soon as the tar is written.
   */
  private async prepareArtifact(
    p: PrepareHistoryParams,
    previousTipSha: string | null,
    deadlineAt: number,
  ): Promise<PreparedHistory> {
    const without = (reason: string): PreparedHistory => {
      this.logger.warn(
        `[git-history] scan ${p.scanId}: ${reason}, history pass recorded as none`,
      );
      return {
        mode: 'incremental_artifact',
        tarPath: null,
        pass: nonePass(p.repositoryKey, previousTipSha),
      };
    };
    if (!p.cloneUrl) return without('no credential to fetch the history');

    // workDir/repo.git, then workDir/history.tar once the repository is gone.
    let workDir: string | null = null;
    let keep = false;
    try {
      workDir = await this.newWorkDir();
      const repoDir = path.join(workDir, 'repo.git');
      const fetched = await fetchBranchHistory({
        cloneUrl: p.cloneUrl,
        branch: p.branch,
        outputDir: repoDir,
        budgetBytes: resolveGitHistoryBudgetBytes(),
        previousTipSha,
        deadlineAt,
        logger: this.logger,
      });
      const pass = toPass(fetched, p.repositoryKey);
      if (fetched.mode === 'none') {
        this.logger.warn(
          `[git-history] scan ${p.scanId}: the tip of the branch alone exceeds the history budget, history pass recorded as none`,
        );
        return { mode: 'incremental_artifact', tarPath: null, pass };
      }
      const tarPath = path.join(workDir, TAR_NAME);
      await writeHistoryTar(repoDir, tarPath);
      await this.removeQuietly(repoDir);
      keep = true;
      return { mode: 'incremental_artifact', tarPath, pass };
    } catch (err) {
      return without(`the history could not be fetched: ${errorMessage(err)}`);
    } finally {
      if (workDir && !keep) await this.removeQuietly(workDir);
    }
  }
}
