import { ScanResponseDto } from './dto/response/scan-response.dto';
import { ScanResultsStatusDto } from './dto/scan-results-status.dto';
import { StartScanResponseDto } from './dto/response/start-scan-response.dto';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';
import { ErrorDto } from 'src/core/constants/error.dto';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { Feature } from 'src/core/guards/feature/feature.decorator';
import { ProjectService } from 'src/modules/project/project.service';
import { v6 as uuidv6 } from 'uuid';
import { ScanService } from './scan.service';
import { StartScanBodyDto } from './dto/body/start-scan-body.dto';
import {
  isGraphOnlyProduct,
  productCreateScanFields,
  scanReadPermission,
  startScanPermission,
} from 'src/core/products/products';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  ProjectGetRequest,
  ProjectInformationsResponse,
} from '@grpc/global-management/project';
import {
  CreateScanRequest,
  GetScanRequest,
  ScanResponse,
} from '@grpc/security-scanning/scan';
import { UploadFileResponse } from '@grpc/file-management/file';
import { StartScanRequest } from '@grpc/security-scanning/scan';
import { StartContainerScanBodyDto } from './dto/body/start-container-scan-body.dto';

/**
 * The failures of a scan creation that mean the scan was not stored: a
 * refusal (invalid request, permission, missing project, existing scan,
 * precondition, quota), by HTTP status once mapped by safeGrpcCall or by
 * gRPC code when raw. A deadline, an unavailable service, a cancelled call or
 * an internal error says nothing of whether the scan exists.
 */
const REFUSAL_HTTP_STATUSES = new Set([400, 403, 404, 409, 429]);
const REFUSAL_GRPC_CODES = new Set([
  GrpcStatus.INVALID_ARGUMENT,
  GrpcStatus.NOT_FOUND,
  GrpcStatus.ALREADY_EXISTS,
  GrpcStatus.PERMISSION_DENIED,
  GrpcStatus.RESOURCE_EXHAUSTED,
  GrpcStatus.FAILED_PRECONDITION,
]);

export function isScanCreationRefusal(err: unknown): boolean {
  if (err instanceof HttpException) {
    return REFUSAL_HTTP_STATUSES.has(err.getStatus());
  }
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' && REFUSAL_GRPC_CODES.has(code);
}

/**
 * Starting a scan reads the project's scanner flags (and a diff
 * scan its default minimum severity), and a container scan only checks the
 * project exists. The lean ProjectService/Get skips the vulnerability stats,
 * the integration status and the security context; it still answers
 * NOT_FOUND for an unknown project.
 */
const projectSettingsRequest = (projectId: string): ProjectGetRequest => ({
  projectId,
  skipVulnerabilityStats: true,
  skipIntegrationStatus: true,
  skipSecurityContext: true,
});

@ApiTags('Scan')
@Controller()
@UseGuards(CombinedAuthRateLimitGuard)
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly projectService: ProjectService,
    private readonly logger: Logger,
    private readonly permissions: PermissionsGuard,
  ) {}

  /**
   * Get a scan by ID
   *
   * @param projectId Description of the parameter here
   * @param idScan Description of the parameter here
   * @param req Description of the parameter here
   * @returns Scan response or error
   */
  @Span()
  @ApiOperation({
    summary: 'Get a scan by ID',
    description:
      'Retrieves detailed information about a specific scan including status, progress, and configuration.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiParam({
    name: 'scanId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the scan',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @ApiResponse({
    status: 200,
    description: 'Scan details retrieved successfully',
    type: ScanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  // No static @Permission / PermissionsGuard: the permission depends on the
  // scan's kind, so the handler checks it (one Permify call, as before).
  @Get('/project/:projectId/scan/:scanId')
  async getScan(
    @Req() req: { user?: { sub?: string } },
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('scanId', new ParseUUIDPipe()) scanId: string,
  ): Promise<ScanResponse> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Permission denied');
    }
    // No global-management getProject here: the dashboard polls this route
    // every 5 s per active scan, and that call (discarded, and fanning out to
    // analysis-reporting's counting queries) would dominate global-management's
    // load. The Permify check below decides access to the project; the
    // projectId forwarded below ties the scan to it.

    // Forward projectId so the downstream security-scanning service verifies
    // the scan belongs to this project: a scan of another project is refused.
    // includePipeline: this user-facing route asks for where the scan really
    // is; internal callers never do.
    const requestScan: GetScanRequest = {
      scanId,
      projectId,
      includePipeline: true,
    };

    let scan: ScanResponse;
    try {
      scan = await this.scanService.getScan(requestScan);
    } catch (error) {
      // Only a member of the project learns whether the scan exists.
      await this.assertPermission(projectId, 'read', userId);
      throw error;
    }

    // A scan kind a registered product owns takes
    // that product's read permission; any other scan, read_scan_result.
    await this.assertPermission(projectId, scanReadPermission(scan), userId);
    return scan;
  }

  /**
   * Whether a scan's results are final. Same access rule as getScan.
   */
  @Span()
  @ApiOperation({
    summary: "Get the status of a scan's results",
    description:
      'Tells whether the results of a scan are still being processed. A scan reaches the completed state only once its results are ready. Poll this route to know when the scan has ended and its results will not change.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiParam({
    name: 'scanId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the scan',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @ApiResponse({
    status: 200,
    description: "Status of the scan's results",
    type: ScanResultsStatusDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @ApiResponse({ status: 404, description: 'Not Found', type: ErrorDto })
  @Get('/project/:projectId/scan/:scanId/results-status')
  async getScanResultsStatus(
    @Req() req: { user?: { sub?: string } },
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('scanId', new ParseUUIDPipe()) scanId: string,
  ): Promise<ScanResultsStatusDto> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Permission denied');
    }

    let scan: ScanResponse;
    try {
      scan = await this.scanService.getScan({
        scanId,
        projectId,
        includePipeline: false,
      });
    } catch (error) {
      // Only a member of the project learns whether the scan exists.
      await this.assertPermission(projectId, 'read', userId);
      throw error;
    }

    await this.assertPermission(projectId, scanReadPermission(scan), userId);
    return {
      scanId: scan.id,
      state: scan.state,
      resultsStatus: scan.resultsStatus,
      resultsFinalizedAt: scan.resultsFinalizedAt,
    };
  }

  private async assertPermission(
    projectId: string,
    permission: string,
    userId: string,
  ): Promise<void> {
    const allowed = await this.permissions.checkPermission(
      projectId,
      'project',
      permission,
      userId,
    );
    if (!allowed) {
      throw new ForbiddenException('Permission denied');
    }
  }

  /**
   * Start a scan
   *
   * @param projectId Description of the parameter here
   * @param req Description of the parameter here
   * @returns Start scan response or error
   */
  @Span()
  @ApiOperation({
    summary: 'Start a scan',
    description:
      'Initiates a security scan for a project. Returns a signed URL to upload the source code. The scan will analyze the code for SAST, IaC, and SCA vulnerabilities based on project configuration.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project to scan',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: StartScanBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Scan initiated successfully - returns signed URL for upload',
    type: StartScanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  // No static @Permission / PermissionsGuard: the permission depends on the
  // body's product (the closed product's permission for a graph-only analysis,
  // start_scan otherwise), so the handler checks it, once.
  @Post('/project/:projectId/scan/start')
  @UsePipes(new ValidationPipe({ transform: true }))
  async startScan(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: StartScanBodyDto,
    @Req() req: { user?: { sub?: string } },
  ): Promise<UploadFileResponse> {
    const userId = req?.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Permission denied');
    }
    await this.assertPermission(
      projectId,
      startScanPermission(body?.product),
      userId,
    );
    // An archive started from a graph-only product (closed extension) builds
    // the code graph only, like the GitHub / GitLab import.
    const graphOnly = isGraphOnlyProduct(body?.product);
    this.logger.log(
      `User ${userId} is starting a ${graphOnly ? 'graph-only ' : ''}scan for project ${projectId}${body?.branch ? ` on branch ${body.branch}` : ''}`,
    );
    const projectInfo: ProjectInformationsResponse =
      await this.projectService.getProject(projectSettingsRequest(projectId));

    // A graph-only import never waits for an AppSec scan slot
    // (external-integrations skips the same check for graphOnly).
    if (!graphOnly) {
      await this.scanService.checkExistingScan({
        projectId: projectId,
        branch: body?.branch,
      });
    }

    const scanId = uuidv6();

    const typeScanParts: string[] = [];
    if (projectInfo.sastEnabled) {
      typeScanParts.push('sast');
    }
    if (projectInfo.iacEnabled) {
      typeScanParts.push('iac');
    }
    if (projectInfo.scaEnabled) {
      typeScanParts.push('sca');
    }
    const typeScan = typeScanParts.join(',');

    // Get the signed URL without the incorrect await on the Observable
    const uploadResponse = await this.scanService.processUploadFile({
      scanId: scanId,
      projectId: projectId,
      typeScan,
    });

    const requestCreateScan: CreateScanRequest = {
      scanId,
      projectId,
      privateScan: false,
      vulnerabilityTypes: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      initializerUserId: userId,
      branch: body?.branch || undefined,
      sourceType: body?.sourceType || 'manual',
      // Extra fields of a registered product, spread as is (the core names none).
      ...(productCreateScanFields(body?.product) as Partial<CreateScanRequest>),
    };

    this.logger.log(
      `[DEBUG] startScan - Creating scan with sourceType: "${requestCreateScan.sourceType}", body.sourceType: "${body?.sourceType}", projectId: ${projectId}`,
    );

    try {
      await this.scanService.createScan(requestCreateScan);
    } catch (err) {
      // The caller gets the failure either way. When it is a refusal, the
      // scan was never stored: remove its registered upload, or the upload
      // processor would keep checking storage for it until its deadline.
      // On any other failure the scan may exist; its upload is left to the
      // upload deadline.
      if (!isScanCreationRefusal(err)) throw err;
      try {
        await this.scanService.discardPendingUpload(scanId);
      } catch (cleanupErr) {
        this.logger.warn(
          `Could not remove the pending upload of refused scan ${scanId}: ${
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr
          }`,
        );
      }
      throw err;
    }

    return uploadResponse;
  }

  /**
   * Starts a public container scan for a given project.
   *
   * @param projectId The UUID of the project.
   * @param startContainerScanDto The request body containing the image to scan.
   * @param req The incoming request object.
   * @returns A response indicating the scan has been initiated.
   */
  @Span()
  @ApiOperation({
    summary: 'Start a public container scan',
    description:
      'Initiates a container image vulnerability scan for a public Docker image.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project to scan',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: StartContainerScanBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Container scan initiated successfully',
    type: StartScanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @SubjectType('project')
  @Permission('start_scan')
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Post('/project/:projectId/scan/container/start')
  @UsePipes(new ValidationPipe())
  async startContainerScan(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() startContainerScanDto: StartContainerScanBodyDto,
    @Req() req: any,
  ): Promise<StartScanResponseDto> {
    // Clean the image URL - remove protocol prefix if present
    let cleanedImageToScan = startContainerScanDto.imageToScan;
    if (cleanedImageToScan.startsWith('https://')) {
      cleanedImageToScan = cleanedImageToScan.replace('https://', '');
    } else if (cleanedImageToScan.startsWith('http://')) {
      cleanedImageToScan = cleanedImageToScan.replace('http://', '');
    }

    this.logger.log(
      `User ${req?.user?.sub} is starting a public container scan for project ${projectId} on image ${cleanedImageToScan}`,
    );

    await this.projectService.getProject(projectSettingsRequest(projectId));
    // Container pool: only a scan of the SAME image blocks; a running
    // SAST/SCA/IaC scan on the project does not.
    await this.scanService.checkExistingScan({
      projectId,
      scanType: 'container',
      imageToScan: cleanedImageToScan,
    });

    const scanId = uuidv6();

    await this.scanService.createScan({
      scanId,
      projectId,
      initializerUserId: req?.user?.sub || 'unknown',
      privateScan: false,
      vulnerabilityTypes: startContainerScanDto.vulnerabilityTypes || [
        'CRITICAL',
        'HIGH',
        'MEDIUM',
        'LOW',
      ],
      scanType: 'container',
      branch: startContainerScanDto.branch || '',
    });

    const startRequest: StartScanRequest = {
      scanId,
      projectId,
      imageToScan: cleanedImageToScan,
      branch: startContainerScanDto.branch || '',
      // No pre-computed file metrics for container scans (no ZIP involved).
      // security-scanning's branch 1 (container) does not call processZipFile,
      // so this is a no-op there; the field is required by the proto codegen.
      language: [],
    };

    const result = await this.scanService.startScan(startRequest);

    return new StartScanResponseDto(
      result.success,
      result.message,
      scanId,
      result.detectedLanguages,
    );
  }

  /**
   * Cancel a scan
   */
  @Span()
  @ApiOperation({
    summary: 'Cancel a scan',
    description: 'Cancels a scan that is in waiting_for_file or queued state.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'scanId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Scan cancelled successfully' })
  @ApiResponse({
    status: 400,
    description: 'Scan cannot be cancelled in its current state',
  })
  @ApiResponse({ status: 404, description: 'Scan not found' })
  @SubjectType('project')
  @Permission('start_scan')
  @UseGuards(PermissionsGuard)
  @HttpCode(200)
  @Post('/project/:projectId/scan/:scanId/cancel')
  async cancelScan(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('scanId', new ParseUUIDPipe()) scanId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this.scanService.cancelScan(scanId, projectId);
  }
}
