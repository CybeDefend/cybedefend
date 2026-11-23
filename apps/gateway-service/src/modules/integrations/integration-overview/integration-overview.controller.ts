import {
  Controller,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import { CombinedAuthRateLimitGuard } from '../../../core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from '../../../core/guards/permissions/permissions.guard';
import {
  Permission,
  SubjectType,
} from '../../../core/guards/permissions/decorator/permission.decorator';
import { IntegrationOverviewService } from './integration-overview.service';
import { IntegrationOverviewResponseDto } from './dto/integration-overview.dto';

/**
 * Integration Overview Controller
 * Provides a unified endpoint to retrieve all integration status information for an organization
 */
@ApiTags('Integrations')
@Controller('organization/:organizationId/integrations')
@UseGuards(CombinedAuthRateLimitGuard)
export class IntegrationOverviewController {
  private readonly logger = new Logger(IntegrationOverviewController.name);

  constructor(
    private readonly integrationOverviewService: IntegrationOverviewService,
  ) {}

  /**
   * Get integration overview for an organization
   * Returns combined status of GitHub, GitLab, and container registry integrations
   */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @SubjectType('organization')
  @Permission('manage_integration')
  @UseGuards(PermissionsGuard)
  @Span('get-integration-overview')
  @ApiOperation({
    summary: 'Get integration overview for organization',
    description:
      'Returns combined status of all integrations including GitHub installation, GitLab connection, and container registry credentials count for the organization. This endpoint consolidates multiple API calls into a single request for better performance.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'CybeDefend organization ID',
    type: 'string',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Integration overview retrieved successfully',
    type: IntegrationOverviewResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Forbidden - Insufficient permissions',
  })
  async getIntegrationOverview(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<IntegrationOverviewResponseDto> {
    this.logger.log(
      `Getting integration overview for organization ${organizationId}`,
    );

    return await this.integrationOverviewService.getIntegrationOverview(
      organizationId,
    );
  }
}
