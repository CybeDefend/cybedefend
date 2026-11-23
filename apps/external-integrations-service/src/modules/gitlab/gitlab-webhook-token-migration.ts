import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabService } from './gitlab.service';

export interface GitlabWebhookTokenMigrationCounts {
  /** GitLab projects visited in this run. */
  projects: number;
  rotated: number;
  /** Projects without a hook of ours: marked with a hash no one holds. */
  noHook: number;
  /** Projects no connection could update; left for a later run. */
  failed: number;
  /** Rows still without a token hash after the run. */
  remaining: number;
}

/**
 * One-shot task `gitlab-webhook-token-migration`: gives every GitLab project
 * hook still registered with the OAuth application secret its own random
 * token (GitlabService.rotateWebhookToken).
 *
 * - Idempotent and resumable: it only selects rows without a token hash, so
 *   a run stopped half-way starts again where it stood.
 * - A keyset on `gitlabId` moves past a project that failed, so one revoked
 *   connection never loops the run; the next run retries it.
 * - Rate-limited: one project at a time (two GitLab calls) with `pauseMs`
 *   between projects.
 * - Logs counts only, never a token, a hash or a project name.
 *
 * When `remaining` is 0, GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED can be turned
 * off and the OAuth application secret rotated without breaking any hook.
 */
@Injectable()
export class GitlabWebhookTokenMigration {
  batchSize = 100;
  pauseMs = 250;
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  constructor(
    @InjectRepository(GitlabRepository)
    private readonly repositories: Repository<GitlabRepository>,
    private readonly gitlab: GitlabService,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<GitlabWebhookTokenMigrationCounts> {
    const counts = { projects: 0, rotated: 0, noHook: 0, failed: 0 };
    let cursor = 0;

    for (;;) {
      const rows = await this.repositories.find({
        where: { webhookTokenHash: IsNull(), gitlabId: MoreThan(cursor) },
        select: { id: true, gitlabId: true },
        order: { gitlabId: 'ASC' },
        take: this.batchSize,
      });
      if (rows.length === 0) break;

      const projectIds = [...new Set(rows.map((row) => row.gitlabId))];
      for (const gitlabProjectId of projectIds) {
        const outcome = await this.gitlab.rotateWebhookToken(gitlabProjectId);
        counts.projects += 1;
        if (outcome === 'rotated') counts.rotated += 1;
        else if (outcome === 'no_hook') counts.noHook += 1;
        else counts.failed += 1;
        await this.sleep(this.pauseMs);
      }
      cursor = projectIds[projectIds.length - 1];
      this.logger.log(
        `GITLAB_WEBHOOK_TOKEN_MIGRATION progress projects=${counts.projects} rotated=${counts.rotated} no_hook=${counts.noHook} failed=${counts.failed}`,
        GitlabWebhookTokenMigration.name,
      );
    }

    const remaining = await this.repositories.count({
      where: { webhookTokenHash: IsNull() },
    });
    this.logger.log(
      `GITLAB_WEBHOOK_TOKEN_MIGRATION done projects=${counts.projects} rotated=${counts.rotated} no_hook=${counts.noHook} failed=${counts.failed} remaining=${remaining}`,
      GitlabWebhookTokenMigration.name,
    );
    return { ...counts, remaining };
  }
}
