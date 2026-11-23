import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import {
  ProjectServiceClient,
  PROJECT_SERVICE_NAME,
} from '@grpc/global-management/global_management';
import { MarkProjectAppsecResponse } from '@grpc/global-management/project';

import { Scan } from '../../../entities/scan.entity';
import { ScanStateStore } from './scanStateStore';
import { ScanStateManager } from './scanStateManager';

/**
 * Marks a project AppSec on its first AppSec scan, extracted from `ScanService` so the edition
 * implementations can inject it.
 */
@Injectable()
export class ProjectAppsecMarker {
  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly gm: ClientGrpc,
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly logger: Logger,
  ) {}

  /**
   * A project becomes an AppSec
   * project when AppSec first analyses it, and only AppSec projects count
   * against the AppSec project limit. global-management decides, under the
   * organisation's row lock; marking is idempotent, so every AppSec scan asks
   * and the first one marks.
   *
   * At the limit the scan is marked `failed` (`PROJECT_LIMIT_REACHED`) by the
   * same compare-and-set as every start, and refused `FAILED_PRECONDITION`.
   * global-management unreachable: fail-open, so an outage there does not
   * stop AppSec scans; the limit is then only checked again at the next scan.
   */
  async markProjectAppsecOrRefuse(scan: Scan): Promise<void> {
    const projectServiceClient =
      this.gm.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
    let answer: MarkProjectAppsecResponse;
    try {
      answer = await firstValueFrom(
        projectServiceClient.markProjectAppsec({
          projectId: scan.projectId,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `[startScan] MarkProjectAppsec failed for project=${scan.projectId}, scan=${scan.id} — fail-open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (!answer?.limitReached) {
      return;
    }

    this.logger.warn(
      `[startScan] AppSec project limit reached: scan ${scan.id} refused - metadata: { projectId: ${scan.projectId}, organizationId: ${scan.organizationId}, appsecProjects: ${answer.appsecProjectCount}, limit: ${answer.projectLimit} }`,
    );
    const previousState = scan.state;
    const failed = await this.store.moveScanState(
      scan,
      [previousState],
      'failed',
      {
        endTime: new Date(),
        errorMessage: 'PROJECT_LIMIT_REACHED',
      },
    );
    if (failed) {
      this.scanStateManager.publishStatusChanged(scan, previousState);
    }
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'PROJECT_LIMIT_REACHED',
    });
  }
}
