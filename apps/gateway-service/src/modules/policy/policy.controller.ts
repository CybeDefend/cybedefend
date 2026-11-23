import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';
import { ErrorDto } from 'src/core/constants/error.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { Feature } from 'src/core/guards/feature/feature.decorator';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PolicyService } from './policy.service';
import {
  CreatePolicyBodyDto,
  UpdatePolicyBodyDto,
  PolicyScopeDto,
} from './dto/body';
import {
  PolicyResponseDto,
  PolicyListResponseDto,
  DeletePolicyResponseDto,
  EffectivePolicyResponseDto,
  ValidatePolicyResponseDto,
  ViolationListResponseDto,
  ViolationStatsDto,
  ScanEvaluationStatusResponseDto,
  ComplianceResultResponseDto,
  ComplianceHistoryResponseDto,
  ExportPolicyYamlResponseDto,
  OrganizationComplianceOverviewResponseDto,
} from './dto/response';
import {
  scopeToProto,
  evaluationStatusFromProto,
  mapPolicyResponse,
  mapTogglePolicyResponse,
  mapSecurityPolicy,
  mapViolation,
  mapViolationStats,
  mapOrganizationComplianceOverview,
  parseOptionalBooleanQuery,
  safeToISOString,
} from './utils';

@ApiTags('Policy')
@ApiBearerAuth()
@Controller()
// Authentication on the class. The plan check is on each route, after its
// PermissionsGuard: on the class it ran before Permify, and told an outsider
// whether the organization has the plan.
@UseGuards(CombinedAuthRateLimitGuard)
@Feature('policies')
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly logger: Logger,
  ) {}

  // ============================================================================
  // Policy CRUD Endpoints
  // ============================================================================

  /**
   * Create a new security policy
   */
  @Post('organization/:organizationId/policies')
  @Span()
  @SubjectType('organization')
  @Permission('manage_policy')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @ApiOperation({ summary: 'Create a new security policy' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CreatePolicyBodyDto })
  @ApiResponse({
    status: 201,
    description: 'Policy created',
    type: PolicyResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorDto,
    content: { 'application/json': { example: UNAUTHORIZED_EXAMPLE } },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    type: ErrorDto,
    content: { 'application/json': { example: FORBIDDEN_EXAMPLE } },
  })
  async createPolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: CreatePolicyBodyDto,
    @Req() req: { user: { sub: string } },
  ): Promise<PolicyResponseDto> {
    this.logger.log(`Creating policy for org ${organizationId}`);

    const response = await this.policyService.createPolicy({
      organizationId,
      yamlContent: body.yamlContent,
      createdBy: req.user.sub,
    });

    return mapPolicyResponse(response);
  }

  /**
   * Get a policy by ID
   */
  @Get('organization/:organizationId/policies/:policyId')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_policy')
  @ApiOperation({ summary: 'Get a security policy by ID' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'policyId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Policy details',
    type: PolicyResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Policy not found', type: ErrorDto })
  async getPolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
  ): Promise<PolicyResponseDto> {
    this.logger.log(`Getting policy ${policyId}`);

    const response = await this.policyService.getPolicy({
      policyId,
      organizationId,
    });
    return mapPolicyResponse(response);
  }

  /**
   * List policies with filtering
   */
  @Get('organization/:organizationId/policies')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_policy')
  @ApiOperation({ summary: 'List security policies' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'scope', enum: PolicyScopeDto, required: false })
  @ApiQuery({ name: 'isEnabled', type: 'boolean', required: false })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'pageSize', type: 'number', required: false })
  @ApiQuery({ name: 'search', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'List of policies',
    type: PolicyListResponseDto,
  })
  async listPolicies(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('scope') scope?: PolicyScopeDto,
    // The raw value, read by parseOptionalBooleanQuery: typed `boolean`, the
    // global ValidationPipe would turn any value but 'true' into false.
    @Query('isEnabled') isEnabled?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('search') search?: string,
  ): Promise<PolicyListResponseDto> {
    this.logger.log(`Listing policies for org ${organizationId}`);

    const response = await this.policyService.listPolicies({
      organizationId,
      scope: scope ? scopeToProto(scope) : undefined,
      isEnabled: parseOptionalBooleanQuery('isEnabled', isEnabled),
      page: page || 1,
      pageSize: pageSize || 20,
      search,
    });

    return {
      policies: response.policies.map((p) => mapSecurityPolicy(p)),
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
    };
  }

  /**
   * Update a policy
   */
  @Put('organization/:organizationId/policies/:policyId')
  @Span()
  @SubjectType('organization')
  @Permission('manage_policy')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @ApiOperation({ summary: 'Update a security policy' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'policyId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdatePolicyBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Policy updated',
    type: PolicyResponseDto,
  })
  async updatePolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() body: UpdatePolicyBodyDto,
    @Req() req: { user: { sub: string } },
  ): Promise<PolicyResponseDto> {
    this.logger.log(`Updating policy ${policyId}`);

    const response = await this.policyService.updatePolicy({
      policyId,
      organizationId,
      yamlContent: body.yamlContent,
      updatedBy: req.user.sub,
    });

    return mapPolicyResponse(response);
  }

  /**
   * Delete a policy
   */
  @Delete('organization/:organizationId/policies/:policyId')
  @Span()
  @SubjectType('organization')
  @Permission('delete_policy')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @ApiOperation({ summary: 'Delete a security policy' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'policyId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Policy deleted',
    type: DeletePolicyResponseDto,
  })
  async deletePolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Req() req: { user: { sub: string } },
  ): Promise<DeletePolicyResponseDto> {
    this.logger.log(`Deleting policy ${policyId}`);

    const response = await this.policyService.deletePolicy({
      policyId,
      organizationId,
      deletedBy: req.user.sub,
    });

    return {
      success: response.success,
      message: response.message,
    };
  }

  /**
   * Toggle policy enabled/disabled state
   */
  @Put('organization/:organizationId/policies/:policyId/toggle')
  @Span()
  @SubjectType('organization')
  @Permission('manage_policy')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @ApiOperation({
    summary: 'Enable or disable a security policy',
    description:
      'Toggle the enabled state of a security policy. For organization-level policies, only one can be active at a time.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'policyId', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isEnabled: {
          type: 'boolean',
          description: 'New enabled state for the policy',
        },
      },
      required: ['isEnabled'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Policy state toggled',
    type: PolicyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request - e.g., trying to enable an organization policy when another is already active',
    type: ErrorDto,
  })
  @ApiResponse({ status: 404, description: 'Policy not found', type: ErrorDto })
  async togglePolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() body: { isEnabled: boolean },
    @Req() req: { user: { sub: string } },
  ): Promise<PolicyResponseDto> {
    this.logger.log(
      `Toggling policy ${policyId} to ${body.isEnabled ? 'enabled' : 'disabled'}`,
    );

    const response = await this.policyService.togglePolicy({
      policyId,
      organizationId,
      isEnabled: body.isEnabled,
      updatedBy: req.user.sub,
    });

    return mapTogglePolicyResponse(response);
  }

  /**
   * Get effective policies for a project
   */
  @Get('projects/:projectId/effective-policies')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_effective_policy')
  @ApiOperation({
    summary: 'Get effective policies for a project',
    description:
      'Returns the list of policies that apply to this project (from organization, team, and project scopes).',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Effective policies for the project',
    type: EffectivePolicyResponseDto,
  })
  async getEffectivePolicies(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EffectivePolicyResponseDto> {
    this.logger.log(`Getting effective policies for project ${projectId}`);

    const response = await this.policyService.getEffectivePolicy({
      projectId,
    });

    return {
      effectiveConfig: JSON.parse(response.effectiveConfigJson || '{}'),
      appliedPolicies: response.appliedPolicies.map((p) =>
        mapSecurityPolicy(p),
      ),
    };
  }

  /**
   * Validate a policy YAML configuration
   */
  @Post('organization/:organizationId/policies/validate')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_policy')
  @ApiOperation({
    summary: 'Validate a policy YAML configuration without saving',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        yamlContent: {
          type: 'string',
          description: 'YAML policy configuration to validate',
        },
      },
      required: ['yamlContent'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result',
    type: ValidatePolicyResponseDto,
  })
  async validatePolicy(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: { yamlContent: string },
  ): Promise<ValidatePolicyResponseDto> {
    this.logger.log(`Validating policy YAML configuration`);

    const response = await this.policyService.validatePolicy({
      yamlContent: body.yamlContent,
    });

    return {
      valid: response.valid,
      errors: response.errors,
      warnings: response.warnings,
    };
  }

  // ============================================================================
  // Policy YAML Export
  // ============================================================================

  /**
   * Export a policy as YAML
   */
  @Get('organization/:organizationId/policies/:policyId/yaml')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_policy')
  @ApiOperation({ summary: 'Export a policy as YAML file' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'policyId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Policy YAML content',
    type: ExportPolicyYamlResponseDto,
  })
  async exportPolicyYaml(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
  ): Promise<ExportPolicyYamlResponseDto> {
    this.logger.log(`Exporting policy ${policyId} as YAML`);

    const response = await this.policyService.exportPolicyYaml({
      policyId,
      organizationId,
    });

    return {
      yamlContent: response.yamlContent,
    };
  }

  // ============================================================================
  // Async Evaluation Endpoints
  // ============================================================================

  /**
   * Get evaluation status for a scan
   */
  @Get('projects/:projectId/scans/:scanId/evaluation-status')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_policy_violation')
  @ApiOperation({
    summary: 'Get the evaluation status for a scan',
    description:
      'Check if a policy evaluation has been triggered for this scan, and if so, what its current status is. Used by the CLI to poll for completion before checking compliance results.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'scanId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation status for the scan',
    type: ScanEvaluationStatusResponseDto,
  })
  async getScanEvaluationStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scanId', ParseUUIDPipe) scanId: string,
  ): Promise<ScanEvaluationStatusResponseDto> {
    this.logger.log(`Getting evaluation status for scan ${scanId}`);

    const response = await this.policyService.getEvaluationStatusByScanId({
      scanId,
      projectId,
    });

    return {
      hasEvaluation: response.hasEvaluation,
      evaluationId: response.evaluationId || undefined,
      status: evaluationStatusFromProto(response.status),
      progress: response.progressPercentage,
      message: response.message,
      startedAt: response.startedAt
        ? safeToISOString(response.startedAt)
        : undefined,
      completedAt: response.completedAt
        ? safeToISOString(response.completedAt)
        : undefined,
    };
  }

  /**
   * Get compliance result for an evaluation
   */
  @Get('projects/:projectId/scans/:scanId/compliance')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_policy_violation')
  @ApiOperation({
    summary: 'Get compliance result for a scan',
    description:
      'Returns the compliance result from the most recent policy evaluation for this scan.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'scanId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'evaluationId',
    type: 'string',
    required: false,
    description: 'Specific evaluation ID (optional)',
  })
  @ApiResponse({
    status: 200,
    description: 'Compliance result',
    type: ComplianceResultResponseDto,
  })
  async getComplianceResult(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scanId', ParseUUIDPipe) scanId: string,
  ): Promise<ComplianceResultResponseDto> {
    this.logger.log(`Getting compliance result for scan ${scanId}`);

    const response = await this.policyService.getComplianceResult({
      scanId,
      projectId,
    });

    return {
      scanId,
      projectId,
      status: evaluationStatusFromProto(response.status),
      result: response.result
        ? {
            compliant: response.result.compliant,
            blockingViolationsCount: response.result.blockingViolationsCount,
            warningViolationsCount: response.result.warningViolationsCount,
            totalViolationsCount: response.result.violationCount,
            evaluatedAt:
              safeToISOString(response.result.evaluatedAt) ||
              new Date().toISOString(),
            breakingRulesCount: response.result.breakingRulesCount || 0,
          }
        : undefined,
    };
  }

  /**
   * Get compliance history for a project
   */
  @Get('projects/:projectId/compliance-history')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_compliance_history')
  @ApiOperation({
    summary: 'Get compliance history for a project',
    description:
      'Returns a paginated list of past policy evaluations for the project.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'pageSize', type: 'number', required: false })
  @ApiQuery({
    name: 'startDate',
    type: 'string',
    required: false,
    description: 'ISO date string',
  })
  @ApiQuery({
    name: 'endDate',
    type: 'string',
    required: false,
    description: 'ISO date string',
  })
  @ApiResponse({
    status: 200,
    description: 'Compliance history',
    type: ComplianceHistoryResponseDto,
  })
  async getComplianceHistory(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ComplianceHistoryResponseDto> {
    this.logger.log(`Getting compliance history for project ${projectId}`);

    const response = await this.policyService.getComplianceHistory({
      projectId,
      page: page || 1,
      pageSize: pageSize || 20,
      fromDate: startDate ? new Date(startDate).getTime() : undefined,
      toDate: endDate ? new Date(endDate).getTime() : undefined,
    });

    return {
      entries: (response.results || []).map((e) => {
        // Handle evaluatedAt - could be a Long object from protobuf or a number
        let evaluatedAtIso: string;
        try {
          const rawTimestamp = e.evaluatedAt;
          const timestamp =
            typeof rawTimestamp === 'object' && rawTimestamp !== null
              ? Number(rawTimestamp) // Handle Long objects
              : rawTimestamp;

          evaluatedAtIso =
            timestamp && timestamp > 0
              ? new Date(Number(timestamp)).toISOString()
              : new Date().toISOString();
        } catch {
          evaluatedAtIso = new Date().toISOString();
        }

        return {
          scanId: e.scanId,
          compliant: e.compliant,
          blockingViolationsCount: e.blockingViolationsCount,
          warningViolationsCount: e.warningViolationsCount,
          evaluatedAt: evaluatedAtIso,
          breakingRulesCount: e.breakingRulesCount || 0,
        };
      }),
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
    };
  }

  // ============================================================================
  // Violation Endpoints
  // ============================================================================

  /**
   * Get violations for a scan
   */
  @Get('projects/:projectId/scans/:scanId/violations')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_policy_violation')
  @ApiOperation({ summary: 'Get policy violations for a scan' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'scanId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: 200,
    description: 'List of violations',
    type: ViolationListResponseDto,
  })
  async getScanViolations(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scanId', ParseUUIDPipe) scanId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<ViolationListResponseDto> {
    this.logger.log(`Getting violations for scan ${scanId}`);

    const response = await this.policyService.getScanViolations({
      scanId,
      projectId,
      page: page || 1,
      pageSize: limit || 50,
    });

    return {
      violations: response.violations.map((v) => mapViolation(v)),
      total: response.total,
      page: response.page,
      limit: response.pageSize,
    };
  }

  /**
   * Get violations for a project
   */
  @Get('projects/:projectId/violations')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_policy_violation')
  @ApiOperation({ summary: 'Get policy violations for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: 200,
    description: 'List of violations',
    type: ViolationListResponseDto,
  })
  async getProjectViolations(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<ViolationListResponseDto> {
    this.logger.log(`Getting violations for project ${projectId}`);

    const response = await this.policyService.getProjectViolations({
      projectId,
      page: page || 1,
      pageSize: limit || 50,
    });

    return {
      violations: response.violations.map((v) => mapViolation(v)),
      total: response.total,
      page: response.page,
      limit: response.pageSize,
    };
  }

  /**
   * Get violation statistics
   */
  @Get('projects/:projectId/violation-stats')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_policy_violation')
  @ApiOperation({ summary: 'Get violation statistics for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'startDate', type: 'string', required: false })
  @ApiQuery({ name: 'endDate', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'Violation statistics',
    type: ViolationStatsDto,
  })
  async getViolationStats(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{ stats: ViolationStatsDto }> {
    this.logger.log(`Getting violation stats for project ${projectId}`);

    const response = await this.policyService.getViolationStats({
      projectId,
      fromDate: startDate ? new Date(startDate).getTime() : undefined,
      toDate: endDate ? new Date(endDate).getTime() : undefined,
    });

    return {
      stats: mapViolationStats(response),
    };
  }

  // ============================================================================
  // Organization Compliance Overview (CISO Dashboard)
  // ============================================================================

  /**
   * Get organization-wide compliance overview for CISO dashboard
   */
  @Get('organization/:organizationId/compliance-overview')
  @Span()
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('manage_policy')
  @ApiOperation({
    summary: 'Get organization-wide compliance overview for CISO dashboard',
    description:
      'Returns a comprehensive overview of all projects within the organization with their compliance status, violation statistics, breakdown by rule type, and trend data for the last 30 days.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'page',
    type: 'number',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    type: 'number',
    required: false,
    description: 'Page size (default: 20)',
  })
  @ApiQuery({
    name: 'startDate',
    type: 'string',
    required: false,
    description: 'Filter start date (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    type: 'string',
    required: false,
    description: 'Filter end date (ISO 8601)',
  })
  @ApiQuery({
    name: 'complianceStatus',
    type: 'string',
    required: false,
    enum: ['Compliant', 'Non-Compliant', 'Pending'],
    description: 'Filter by compliance status',
  })
  @ApiQuery({
    name: 'search',
    type: 'string',
    required: false,
    description: 'Search by project name',
  })
  @ApiQuery({
    name: 'sortBy',
    type: 'string',
    required: false,
    enum: [
      'blockedCount',
      'warnedCount',
      'totalViolations',
      'lastEvaluatedAt',
      'projectName',
    ],
    description: 'Sort field',
  })
  @ApiQuery({
    name: 'sortOrder',
    type: 'string',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Sort order (default: desc)',
  })
  @ApiQuery({
    name: 'timeframe',
    type: 'string',
    required: false,
    enum: ['day', 'week', 'month'],
    description:
      'Timeframe for trend aggregation: day (default), week, or month',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization compliance overview',
    type: OrganizationComplianceOverviewResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorDto,
    content: { 'application/json': { example: UNAUTHORIZED_EXAMPLE } },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    type: ErrorDto,
    content: { 'application/json': { example: FORBIDDEN_EXAMPLE } },
  })
  async getOrganizationComplianceOverview(
    @Req() req: { user: { sub: string } },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('complianceStatus') complianceStatus?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('timeframe') timeframe?: string,
  ): Promise<OrganizationComplianceOverviewResponseDto> {
    this.logger.log(
      `Getting organization compliance overview for org ${organizationId}`,
    );

    const response = await this.policyService.getOrganizationComplianceOverview(
      {
        organizationId,
        userId: req.user.sub,
        page: page || 1,
        pageSize: pageSize || 20,
        fromDate: startDate ? new Date(startDate).getTime() : undefined,
        toDate: endDate ? new Date(endDate).getTime() : undefined,
        complianceStatusFilter: complianceStatus,
        search,
        sortBy,
        sortOrder,
        timeframe,
      },
    );

    return mapOrganizationComplianceOverview(response);
  }
}
