import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { isDeadlock } from '@cybedefend/db-dialect';
import type {
  GetGitHistoryCursorResponse,
  GitHistoryCoverage,
  GitHistoryPass,
} from '@grpc/security-scanning/scan';
import { GitHistoryCursor } from 'src/entities/git-history-cursor.entity';
import { Scan } from 'src/entities/scan.entity';
import {
  GIT_HISTORY_MODE_PORT,
  GitHistoryModePort,
} from 'src/edition/ports/git-history-mode.port';
import { CursorState, nextCursorState } from './cursor-transition';

const toCoverage = (row: GitHistoryCursor): GitHistoryCoverage => ({
  complete: row.complete,
  coveredSince: row.coveredSince?.toISOString(),
  gaps: row.gaps ?? [],
  lastPassOutcome: row.lastPassOutcome ?? undefined,
});

@Injectable()
export class GitHistoryCursorService {
  constructor(
    @InjectRepository(GitHistoryCursor)
    private readonly cursors: Repository<GitHistoryCursor>,
    @InjectRepository(Scan)
    private readonly scans: Repository<Scan>,
    @Inject(GIT_HISTORY_MODE_PORT)
    private readonly modePort: GitHistoryModePort,
  ) {}

  async getCursor(
    projectId: string,
    branch: string,
    repositoryKey: string,
  ): Promise<GetGitHistoryCursorResponse> {
    const mode = this.modePort.mode();
    if (mode === 'in_archive') return { mode };
    const row = await this.cursors.findOne({ where: { projectId, branch } });
    // A cursor of another repository (renamed or re-linked) does not apply.
    if (!row || row.repositoryKey !== repositoryKey) return { mode };
    return {
      mode,
      tipSha: row.tipSha ?? undefined,
      coverage: toCoverage(row),
    };
  }

  /**
   * Whether this edition keeps history cursors. In `in_archive` the history
   * travels in the archive and is read whole on every scan: no cursor is read
   * or written, and no coverage is shown, so an old row can never surface.
   */
  private keepsCursors(): boolean {
    return this.modePort.mode() !== 'in_archive';
  }

  async coverageFor(
    projectId: string,
    branch: string,
  ): Promise<GitHistoryCoverage | null> {
    if (!this.keepsCursors()) return null;
    // A null or empty branch would be dropped from the where clause by
    // TypeORM and match another branch's row of the project.
    if (!branch) return null;
    const row = await this.cursors.findOne({ where: { projectId, branch } });
    return row ? toCoverage(row) : null;
  }

  /**
   * Keeps what the scan did about the history in its metadata. A write of
   * that one key by id, never a full-entity save: a save would write back the
   * state read here and could undo a concurrent state change.
   */
  async recordPass(scanId: string, pass: GitHistoryPass): Promise<void> {
    if (!this.keepsCursors()) return;
    await this.writeMetadataKey(scanId, 'historyPass', pass);
  }

  /**
   * Records that analysis-reporting could not store every result of the
   * scan's secret scanner: its history pass then counts as failed when the
   * results are final, whatever the scanner reported. Idempotent.
   *
   * @returns false for an unknown scan.
   */
  async markHistoryIngestionFailed(scanId: string): Promise<boolean> {
    return this.writeMetadataKey(scanId, 'historyIngestionFailed', true);
  }

  /**
   * Writes one key of a scan's metadata by id, never a full-entity save: a
   * save would write back the state read here and could undo a concurrent
   * state change.
   *
   * @returns false for an unknown scan.
   */
  private async writeMetadataKey(
    scanId: string,
    key: string,
    value: unknown,
  ): Promise<boolean> {
    const scan = await this.scans.findOne({
      where: { id: scanId },
      select: { id: true, metadata: true },
    });
    if (!scan) return false;
    const metadata: Record<string, unknown> = {
      ...(scan.metadata ?? {}),
      [key]: value,
    };
    // The entity types its json column loosely; what is written is unknown.
    await this.scans.update(
      { id: scanId },
      { metadata: metadata as Scan['metadata'] },
    );
    return true;
  }

  /**
   * Moves the cursor once a scan's results are final. The pass counts as
   * `ok` only when the Gitleaks container completed AND reported its history
   * pass `ok` AND analysis-reporting stored all of its results
   * (`historyIngestionFailed` unset); anything else is a failure. A scan with
   * no pass or no secret scan leaves the cursor alone. A `none` pass has no
   * history pass that could fail: it is recorded `ok` whatever the Gitleaks
   * container did.
   *
   * With `scanFailed`, for a scan that ended `failed` (it is never held for
   * its results, so it never reaches the results-final path): a history pass
   * it recorded counts as failed, whatever its containers reported. A `none`
   * pass, a scan in any other state (a cancelled one included) or one without
   * a secret container leaves the cursor alone.
   */
  async applyFinalizedScan(
    scanId: string,
    opts: { scanFailed?: boolean } = {},
  ): Promise<void> {
    if (!this.keepsCursors()) return;
    const scan = await this.scans.findOne({
      where: { id: scanId },
      relations: ['containers', 'containers.scanner'],
    });
    const pass = scan?.metadata?.historyPass as GitHistoryPass | undefined;
    if (!scan || !scan.branch || !pass) return;
    if (opts.scanFailed && (scan.state !== 'failed' || pass.mode === 'none')) {
      return;
    }
    if (pass.mode === 'none') {
      await this.advance(scan.projectId, scan.branch, pass, 'ok');
      return;
    }
    const gitleaks = (scan.containers ?? []).find(
      (c) => c.scanner?.scannerType === 'secret',
    );
    if (!gitleaks) return;
    const outcome =
      !opts.scanFailed &&
      scan.metadata?.historyIngestionFailed !== true &&
      gitleaks.status === 'completed' &&
      gitleaks.historyOutcome === 'ok'
        ? 'ok'
        : 'failed';
    await this.advance(scan.projectId, scan.branch, pass, outcome);
  }

  /**
   * Applies a pass to the (project, branch) cursor and returns whether the
   * cursor changed.
   *
   * The guarantee: a pass moves the cursor only if its base tip equals the
   * stored tip at the moment of the write. The row is read with a lock; when
   * it is missing, the first pass inserts it with conflicts ignored (a locking
   * read of a missing row locks nothing on PostgreSQL, so the unique index
   * (projectId, branch) is what arbitrates). The locked read is then repeated:
   * if another pass inserted the row first, this one is judged against that
   * row like any other pass, so it never overwrites the winner's tip. A
   * deadlock (MySQL gap locks on two concurrent first inserts) retries the
   * whole transaction once.
   */
  async advance(
    projectId: string,
    branch: string,
    pass: GitHistoryPass,
    outcome: 'ok' | 'failed',
  ): Promise<boolean> {
    if (!branch) return false;
    try {
      return await this.advanceOnce(projectId, branch, pass, outcome);
    } catch (error) {
      if (!isDeadlock(error)) throw error;
      return this.advanceOnce(projectId, branch, pass, outcome);
    }
  }

  private advanceOnce(
    projectId: string,
    branch: string,
    pass: GitHistoryPass,
    outcome: 'ok' | 'failed',
  ): Promise<boolean> {
    return this.cursors.manager.transaction(async (manager) => {
      const repo = manager.getRepository(GitHistoryCursor);
      const read = () =>
        repo.findOne({
          where: { projectId, branch },
          lock: { mode: 'pessimistic_write' },
        });
      const judge = (row: GitHistoryCursor | null) =>
        nextCursorState(
          row && row.repositoryKey === pass.repositoryKey
            ? {
                tipSha: row.tipSha,
                coveredSince: row.coveredSince?.toISOString() ?? null,
                complete: row.complete,
                gaps: row.gaps ?? [],
                consecutiveFailures: row.consecutiveFailures,
                lastPassOutcome: row.lastPassOutcome as 'ok' | 'failed' | null,
              }
            : null,
          pass,
          outcome,
        );
      const values = (next: CursorState) => ({
        repositoryKey: pass.repositoryKey,
        tipSha: next.tipSha,
        coveredSince: next.coveredSince ? new Date(next.coveredSince) : null,
        complete: next.complete,
        gaps: next.gaps,
        consecutiveFailures: next.consecutiveFailures,
        lastPassOutcome: next.lastPassOutcome,
      });

      let row = await read();
      if (!row) {
        const first = judge(null);
        if (!first) return false;
        const id = randomUUID();
        await repo
          .createQueryBuilder()
          .insert()
          .values({ id, projectId, branch, ...values(first) })
          .orIgnore()
          .execute();
        row = await read();
        // Our insert won: the row is ours and already holds `first`.
        if (row?.id === id) return true;
      }
      if (!row) return false;
      const next = judge(row);
      if (!next) return false;
      await repo.update({ id: row.id }, values(next));
      return true;
    });
  }
}
