import { Controller, UseGuards } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { ScanService } from './scan.service';
import { ImportScanService } from './import/import-scan.service';
import { FileManagementService } from '../file/file-management.service';
import { HandledScanStartError } from './core/handled-scan-start-error';
import {
  ScannerCallGuard,
  scannerIdentityOf,
} from '../../core/scanner-auth/scanner-call.guard';
import {
  ScanServiceController,
  ScanServiceControllerMethods,
} from '@grpc/security-scanning/security_scanning';
import {
  GetScanRequest,
  ScanResponse,
  StartScanRequest,
  StartScanResponse,
  UpdateScanRequest,
  UpdateScanResponse,
  ProjectGetRequest,
  GetLastScanStatusResponse,
  CreateFailedScanRequest,
  CreateFailedScanResponse,
  UpdateScanDataRequest,
  CheckExistingScanResponse,
  CheckExistingScanRequest,
  CreateScanRequest,
  CreateScanResponse,
  GetScanIdsByBranchRequest,
  GetScanIdsByBranchResponse,
  GetProjectsScanStatusRequest,
  GetProjectsScanStatusResponse,
  GetProjectBranchesFromScansRequest,
  GetProjectBranchesFromScansResponse,
  GetProjectBranchesFromScansPaginatedRequest,
  GetProjectBranchesFromScansPaginatedResponse,
  CreateCompletedScanRequest,
  CreateCompletedScanResponse,
  CancelScanRequest,
  CompleteImportScanRequest,
  CompleteImportScanResponse,
  MarkScanResultsFinalRequest,
  MarkScanResultsFinalResponse,
  GetGitHistoryCursorRequest,
  GetGitHistoryCursorResponse,
  RecordGitHistoryPassRequest,
  RecordGitHistoryPassResponse,
  MarkHistoryIngestionFailedRequest,
  MarkHistoryIngestionFailedResponse,
} from '@grpc/security-scanning/scan';

import { GitHistoryCursorService } from './git-history/git-history-cursor.service';

@Controller()
@ScanServiceControllerMethods()
export class ScanController implements ScanServiceController {
  constructor(
    private readonly scanService: ScanService,
    private readonly importScanService: ImportScanService,
    private readonly fileManagementService: FileManagementService,
    private readonly logger: Logger,
    private readonly gitHistoryCursor: GitHistoryCursorService,
  ) {}

  /**
   * Get a scan by ID. A scanner pod reads only the scan of its own project:
   * the lookup is scoped by the project its token names.
   */
  @Span()
  @UseGuards(ScannerCallGuard)
  async getScan(
    request: GetScanRequest,
    metadata?: Metadata,
  ): Promise<ScanResponse> {
    if (!request || !request.scanId) {
      this.logger.warn(
        `Error getting scan - missing scanId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    const scanner = scannerIdentityOf(metadata);
    if (scanner) {
      return this.scanService.getScan({
        ...request,
        projectId: scanner.projectId,
      });
    }
    return this.scanService.getScan(request);
  }

  /**
   * Create a new scan in waiting_for_file state.
   */
  @Span()
  async createScan(request: CreateScanRequest): Promise<CreateScanResponse> {
    if (
      !request ||
      !request.scanId ||
      !request.projectId ||
      !request.initializerUserId
    ) {
      this.logger.warn(
        `Error creating scan - missing required fields: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing required fields',
      });
    }
    return this.scanService.createScan(request);
  }

  /**
   * Start an existing scan after file is uploaded.
   */
  @Span()
  async startScan(request: StartScanRequest): Promise<StartScanResponse> {
    if (!request || !request.scanId) {
      this.logger.warn(
        `Error starting scan - missing scanId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    try {
      return await this.scanService.startScan(request);
    } catch (error: unknown) {
      // The scan is already in its right state (an import failure or
      // refusal recorded by ImportScanService); recording another failure
      // would overwrite it.
      if (error instanceof HandledScanStartError) throw error;
      if (!(error instanceof RpcException)) {
        this.logger.error(`Error while starting scan : ${error}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.updateScanData({
        scanId: request.scanId,
        state: 'failed',
        errorMessage: `Error while starting scan: ${message}`,
      });
      throw error;
    }
  }

  /**
   * Update an existing scan. A scanner pod updates its own container: the
   * pod its token names, never the podName it sends (the call binding has
   * already refused one that differs).
   */
  @Span()
  @UseGuards(ScannerCallGuard)
  async updateScan(
    request: UpdateScanRequest,
    metadata?: Metadata,
  ): Promise<UpdateScanResponse> {
    if (!request || !request.scanId) {
      this.logger.warn(
        `Error updating scan - missing scanId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    const scanner = scannerIdentityOf(metadata);
    if (scanner) {
      return this.scanService.updateScan({ ...request, podName: scanner.pod });
    }
    return this.scanService.updateScan(request);
  }

  @Span()
  @UseGuards(ScannerCallGuard)
  async updateScanData(
    request: UpdateScanDataRequest,
  ): Promise<UpdateScanResponse> {
    if (!request || !request.scanId) {
      this.logger.warn(
        `Error updating scan data - missing scanId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    return this.scanService.updateScanData(request);
  }

  /**
   * Get the last scan status for a project.
   */
  @Span()
  async getLastScanStatus(
    request: ProjectGetRequest,
  ): Promise<GetLastScanStatusResponse> {
    if (!request || !request.projectId) {
      this.logger.warn(
        `Error getting last scan status - missing projectId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scanService.getLastScanStatus(request);
  }

  /**
   * Check if a scan already exists for a project.
   */
  @Span()
  async checkExistingScan(
    request: CheckExistingScanRequest,
  ): Promise<CheckExistingScanResponse> {
    if (!request || !request.projectId) {
      this.logger.warn(
        `Error checking existing scan - missing projectId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scanService.checkExistingScan(
      request.projectId,
      request.branch,
      { scanType: request.scanType, imageToScan: request.imageToScan },
    );
  }

  /**
   * Create a scan in failed state directly.
   */
  @Span()
  async createFailedScan(
    request: CreateFailedScanRequest,
  ): Promise<CreateFailedScanResponse> {
    if (
      !request ||
      !request.projectId ||
      !request.organizationId ||
      !request.errorMessage
    ) {
      this.logger.warn(
        `Error creating failed scan - missing required fields: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing required fields',
      });
    }
    return this.scanService.createFailedScan(request);
  }

  /**
   * Get all scan IDs for a specific project and branch.
   */
  @Span()
  async getScanIdsByBranch(
    request: GetScanIdsByBranchRequest,
  ): Promise<GetScanIdsByBranchResponse> {
    if (!request || !request.projectId || !request.branch) {
      this.logger.warn(
        `Error getting scan IDs by branch - missing required fields: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or branch',
      });
    }
    return this.scanService.getScanIdsByBranch(request);
  }

  /**
   * Get the scan status for multiple projects at once.
   * Optimized for performance to support frequent polling from the frontend.
   */
  @Span()
  async getProjectsScanStatus(
    request: GetProjectsScanStatusRequest,
  ): Promise<GetProjectsScanStatusResponse> {
    if (!request || !request.projectIds) {
      this.logger.warn(
        `Error getting projects scan status - missing projectIds: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectIds',
      });
    }
    return this.scanService.getProjectsScanStatus(request);
  }

  /**
   * Get distinct branches from all scans for a project.
   * This is useful for branch selection in the UI, especially for projects
   * not linked to external integrations (GitHub/GitLab).
   */
  @Span()
  async getProjectBranchesFromScans(
    request: GetProjectBranchesFromScansRequest,
  ): Promise<GetProjectBranchesFromScansResponse> {
    if (!request || !request.projectId) {
      this.logger.warn(
        `Error getting project branches - missing projectId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scanService.getProjectBranchesFromScans(request);
  }

  /**
   * Get distinct branches from all scans for a project with pagination and search support.
   */
  @Span()
  async getProjectBranchesFromScansPaginated(
    request: GetProjectBranchesFromScansPaginatedRequest,
  ): Promise<GetProjectBranchesFromScansPaginatedResponse> {
    if (!request || !request.projectId) {
      this.logger.warn(
        `Error getting paginated project branches - missing projectId: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scanService.getProjectBranchesFromScansPaginated(request);
  }

  /**
   * Get last scan dates for multiple projects in a batch.
   * Optimized for performance to support fetching last scan info when listing projects.
   */
  @Span()
  async getBatchLastScans(request: {
    projectIds: string[];
  }): Promise<{ scans: Array<{ projectId: string; lastScan: string }> }> {
    if (!request || !request.projectIds) {
      this.logger.warn(
        `Error getting batch last scans - missing projectIds: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectIds',
      });
    }
    return this.scanService.getBatchLastScans(request);
  }

  /**
   * Create a completed scan directly.
   * Used for OSV sync when new vulnerabilities are discovered and a policy evaluation is needed.
   */
  @Span()
  async createCompletedScan(
    request: CreateCompletedScanRequest,
  ): Promise<CreateCompletedScanResponse> {
    if (!request || !request.projectId || !request.organizationId) {
      this.logger.warn(
        `Error creating completed scan - missing required fields: ${JSON.stringify(request)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - missing required fields (projectId, organizationId)',
      });
    }
    return this.scanService.createCompletedScan(request);
  }

  @Span()
  async cancelScan(request: CancelScanRequest): Promise<UpdateScanResponse> {
    if (!request || !request.scanId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'scanId is required',
      });
    }
    if (!request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }
    return this.scanService.cancelScan(request.scanId, request.projectId);
  }

  /**
   * CompleteImportScan — analysis-reporting signals the end of an import
   * scan. The controller validates scanId, then delegates to
   * ImportScanService.
   */
  @Span()
  async completeImportScan(
    request: CompleteImportScanRequest,
  ): Promise<CompleteImportScanResponse> {
    if (!request || !request.scanId) {
      this.logger.warn('Error completing import scan - missing scanId');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    return this.importScanService.complete(request);
  }

  /**
   * MarkScanResultsFinal — analysis-reporting says the results of a scan are
   * final, which ends a scan held `running` for them. Service-to-service: no
   * scanner token. Idempotent: every outcome, an unknown scan included,
   * answers success so the caller never retries a settled case.
   */
  @Span()
  async markScanResultsFinal(
    request: MarkScanResultsFinalRequest,
  ): Promise<MarkScanResultsFinalResponse> {
    if (!request || !request.scanId) {
      this.logger.warn('Error marking scan results final - missing scanId');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }
    const outcome = await this.scanService.markScanResultsFinal(request.scanId);
    return { success: true, outcome };
  }

  async getGitHistoryCursor(
    request: GetGitHistoryCursorRequest,
  ): Promise<GetGitHistoryCursorResponse> {
    return this.gitHistoryCursor.getCursor(
      request.projectId,
      request.branch,
      request.repositoryKey,
    );
  }

  async recordGitHistoryPass(
    request: RecordGitHistoryPassRequest,
  ): Promise<RecordGitHistoryPassResponse> {
    if (!request.scanId || !request.pass) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'scanId and pass are required',
      });
    }
    await this.gitHistoryCursor.recordPass(request.scanId, request.pass);
    return { success: true };
  }

  /**
   * analysis-reporting could not store every result of a scan's secret
   * scanner: its history pass counts as failed once the results are final.
   * Service-to-service only, idempotent.
   */
  @Span()
  async markHistoryIngestionFailed(
    request: MarkHistoryIngestionFailedRequest,
  ): Promise<MarkHistoryIngestionFailedResponse> {
    if (!request?.scanId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'scanId is required',
      });
    }
    if (
      !(await this.gitHistoryCursor.markHistoryIngestionFailed(request.scanId))
    ) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Scan ${request.scanId} not found`,
      });
    }
    this.logger.warn(
      `[GitHistory] Scan ${request.scanId}: results of ${request.scannerName || 'its secret scanner'} not all stored, its history pass counts as failed`,
    );
    return { success: true };
  }
}
