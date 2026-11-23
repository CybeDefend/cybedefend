import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  CLUSTER_SCAN_SERVICE_NAME,
  ClusterScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { withGrpcDeadline } from '@grpc/wrapper-grpc';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { lastValueFrom } from 'rxjs';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { grpcStatusName } from '../scan-run/scan-run-errors';

/** GetScanCapabilities reads an in-memory state of security-scanning. */
export const INSTANCE_CAPABILITIES_DEADLINE_MS = 2_000;

export const INSTANCE_CAPABILITIES_UNAVAILABLE =
  'INSTANCE_CAPABILITIES_UNAVAILABLE';

export interface InstanceCapabilities {
  clusterScans: boolean;
}

/**
 * `GET /instance/capabilities`, Community only (InstanceModule is in
 * COMMUNITY_ONLY_MODULES; the cloud never mounts it, so a cloud request is
 * a 404). The Community dashboard reads whether this instance runs scans on
 * a connected cluster, or only imports results.
 *
 * Any signed-in user may ask: the answer names no organisation, team or
 * project, so CombinedAuthRateLimitGuard alone guards it, no Permify.
 *
 * `200 { clusterScans }` comes only from an answer of security-scanning:
 * its value, or false for UNIMPLEMENTED (an older security-scanning, which
 * has no cluster engine). Any other failure, or no answer within 2 s, is a
 * 503 INSTANCE_CAPABILITIES_UNAVAILABLE and one WARN with the status name:
 * the dashboard caches only a successful answer, so a 200 false on a blip
 * would make a scanning instance look import-only for the page load.
 */
@ApiTags('Instance')
@ApiBearerAuth()
@UseGuards(CombinedAuthRateLimitGuard)
@Controller('instance')
export class InstanceController implements OnModuleInit {
  private clusterScan!: ClusterScanServiceClient;

  constructor(
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.clusterScan = wrapGrpcClientWithTracing(
      this.securityScanningClient.getService<ClusterScanServiceClient>(
        CLUSTER_SCAN_SERVICE_NAME,
      ),
    );
  }

  @ApiOperation({ summary: 'Whether this instance runs cluster scans' })
  @Get('capabilities')
  async capabilities(): Promise<InstanceCapabilities> {
    try {
      const answer = await lastValueFrom(
        withGrpcDeadline(
          this.clusterScan.getScanCapabilities({}),
          INSTANCE_CAPABILITIES_DEADLINE_MS,
        ),
      );
      return { clusterScans: answer?.clusterScans === true };
    } catch (error) {
      if (
        (error as { code?: unknown } | null)?.code === GrpcStatus.UNIMPLEMENTED
      ) {
        return { clusterScans: false };
      }
      this.logger.warn(
        `${INSTANCE_CAPABILITIES_UNAVAILABLE} status=${grpcStatusName(error)}`,
      );
      throw new HttpException(
        {
          code: INSTANCE_CAPABILITIES_UNAVAILABLE,
          message: 'The instance capabilities are unavailable.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
