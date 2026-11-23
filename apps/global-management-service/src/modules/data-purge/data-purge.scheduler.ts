import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DataPurgeRunner } from './data-purge.runner';

/** The period of the cloud's `global-management-data-purge` CronJob. */
export const DATA_PURGE_TICK_MS = 10 * 60 * 1000;

/**
 * The Community Edition's stand-in for the data purge CronJob: the
 * compose runs no cron for global-management, so the API process calls
 * `DataPurgeRunner.runDue()` itself every `DATA_PURGE_TICK_MS`. Loaded only
 * through COMMUNITY_ONLY_MODULES; the cloud keeps its CronJob.
 *
 * A tick never starts while the previous run is still going. Replicas need no
 * coordination: the runner claims each job under a lease, which is what the
 * CronJob relies on today. The timer is unref'd, so it never keeps the
 * process alive. A log line carries the summary counts, or the error's class
 * only: a driver or service error can quote customer data.
 */
@Injectable()
export class DataPurgeScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly runner: DataPurgeRunner,
    private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, DATA_PURGE_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'DATA_PURGE_TICK_SKIPPED previous run still in progress',
      );
      return;
    }
    this.running = true;
    try {
      const { jobs, stepsDone, stepsFailed } = await this.runner.runDue();
      this.logger.log(
        `DATA_PURGE_TICK_DONE jobs=${jobs} stepsDone=${stepsDone} stepsFailed=${stepsFailed}`,
      );
    } catch (error) {
      this.logger.error(
        `DATA_PURGE_TICK_FAILED error=${(error as Error)?.constructor?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }
}
