import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Span } from 'nestjs-otel';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { FeatureByRouteParam } from 'src/core/guards/feature/feature.decorator';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { ResultService } from './result.service';
import {
  GetProjectSastVulnerabilitiesRequest,
  GetProjectVulnerabilityByIdRequest,
  VulnerabilitySastIacResponse,
  DataFlowItem,
} from '@grpc/analysis-reporting/result';
import { McpVulnerabilityListQueryDto } from './dto/body/mcp-vulnerability-list-query.dto';
import { parseBooleanQuery } from 'src/common/utils/parse-boolean-query.util';
import { McpVulnerabilityListResponseDto } from './dto/response/mcp-vulnerability-list-response.dto';
import { McpVulnerabilityDetailDto } from './dto/response/mcp-vulnerability-detail-response.dto';
import {
  clampMcpPageSize,
  toSlimBaseFamilyItem,
  toSlimContainerItem,
  toSlimScaItem,
  toSlimBaseFamilyDetail,
  toSlimContainerDetail,
  toSlimScaDetail,
} from './mcp-result.mapper';

const SUPPORTED_SCANNERS = new Set([
  'sast',
  'iac',
  'cicd',
  'secret',
  'container',
  'sca',
]);

/**
 * Families whose findings are feature-gated. `container_scanning` gates
 * reading the findings as well as starting a container scan: once the
 * feature is off the rows survive, and this surface must not keep serving
 * them while the dashboard hides its tab. Families absent from this map (sast, iac, cicd, secret, sca) are in
 * every plan and stay open. Same map semantics as the REST surface's
 * per-route `@Feature('container_scanning')`.
 */
const PLAN_GATED_SCANNERS: Record<string, string> = {
  container: 'container_scanning',
};

/**
 * Minimal structural view of the four base-family list responses (SAST / IaC /
 * CICD / secret) — they all expose `{ base }` items plus the same pagination
 * scalars, so we consume them through this shape instead of a 4-way union.
 */
interface BaseFamilyListResult {
  vulnerabilities: { base?: VulnerabilitySastIacResponse }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * MCP-only result surface. Mirrors the dashboard list endpoints but
 * returns slim, page-capped payloads sized for an LLM context window. It does
 * NOT modify the existing `/project/:id/results/...` endpoints — those stay
 * full-fat for the dashboard. Same auth posture as those endpoints: Gateway is
 * the single authorisation point (`read_scan_result` on the project).
 */
@UseGuards(CombinedAuthRateLimitGuard)
@ApiTags('MCP')
@Controller()
export class McpResultController {
  constructor(private readonly resultService: ResultService) {}

  @Span()
  @ApiOperation({
    summary: 'List vulnerabilities (slim, MCP-only) for one scanner family',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'scanner',
    enum: ['sast', 'iac', 'cicd', 'secret', 'container', 'sca'],
  })
  @ApiResponse({ status: 200, type: McpVulnerabilityListResponseDto })
  @FeatureByRouteParam('scanner', PLAN_GATED_SCANNERS)
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/mcp/project/:projectId/results/:scanner')
  async listVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('scanner') scanner: string,
    @Query() query: McpVulnerabilityListQueryDto,
  ): Promise<McpVulnerabilityListResponseDto> {
    const family = (scanner ?? '').toLowerCase();
    if (!SUPPORTED_SCANNERS.has(family)) {
      throw new BadRequestException(
        `Unsupported scanner '${scanner}'. Expected one of: sast, iac, cicd, secret, container, sca.`,
      );
    }

    const pageSize = clampMcpPageSize(query.pageSizeNumber ?? query.limit);
    const page = query.pageNumber ?? query.page ?? 1;

    if (family === 'sca') {
      const res = await this.resultService.findAllSca({
        projectId,
        query: query.query,
        page,
        limit: pageSize,
        sort: query.sort,
        order: query.order,
        severity: query.severity,
        status: query.status,
        language: query.language,
        priority: query.priority,
        pageNumber: page,
        pageSizeNumber: pageSize,
        searchQuery: query.searchQuery,
        packageType: query.packageType,
        // SCA filters — not exposed on the MCP surface; unfiltered.
        packageManager: [],
        packageSource: [],
        branch: query.branch,
        hasAutofix: parseBooleanQuery(query.hasAutofix),
        exploitabilityVerdict: query.exploitabilityVerdict ?? [],
        scoringSource: query.scoringSource,
        // Malware separation: default excludes malware; malwareOnly=true returns only
        // the malicious-package findings so an agent can triage them.
        malwareOnly: parseBooleanQuery(query.malwareOnly),
        // The page only — no project Get, scan status, counters
        // nor history, none of which the slim item carries.
        slim: true,
      });
      return {
        scanner: 'sca',
        vulnerabilities: (res.vulnerabilities ?? []).map(toSlimScaItem),
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      };
    }

    if (family === 'container') {
      const res = await this.resultService.findAllContainer({
        projectId,
        page,
        limit: pageSize,
        sort: query.sort,
        order: query.order,
        severity: query.severity,
        status: query.status,
        classType: [],
        priority: query.priority,
        searchQuery: query.searchQuery,
        imageId: query.imageId,
        branch: query.branch,
        hasAutofix: parseBooleanQuery(query.hasAutofix),
        exploitabilityVerdict: query.exploitabilityVerdict ?? [],
        scoringSource: query.scoringSource,
        // The page only — no project Get, scan status nor
        // counters, none of which the slim item carries.
        slim: true,
      });
      return {
        scanner: 'container',
        vulnerabilities: (res.vulnerabilities ?? []).map(toSlimContainerItem),
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      };
    }

    // base family: sast | iac | cicd | secret — all share VulnerabilitySastIacResponse
    const baseReq: GetProjectSastVulnerabilitiesRequest = {
      projectId,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      // Base-family requests take a multi-value language filter.
      // The MCP tools advertise a single language string, so wrap it.
      language: query.language ? [query.language] : [],
      priority: query.priority,
      pageNumber: page,
      pageSizeNumber: pageSize,
      searchQuery: query.searchQuery,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(query.hasAutofix),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      // The page only — no project Get, scan status, counters,
      // languages facet nor history, none of which the slim item carries.
      slim: true,
    };
    const res = await this.dispatchBaseFamily(family, baseReq);
    return {
      scanner: family,
      // Drop any item whose `base` is absent before mapping: the proto type is
      // `base?`, and `toSlimBaseFamilyItem` is now null-safe, but a base-less
      // item carries no usable data, so it is filtered rather than emitted.
      vulnerabilities: (res.vulnerabilities ?? [])
        .filter((item) => item.base)
        .map((item) => toSlimBaseFamilyItem(item.base, family)),
      page: res.page,
      limit: res.limit,
      total: res.total,
      totalPages: res.totalPages,
    };
  }

  @Span()
  @ApiOperation({
    summary: 'Get a single vulnerability (slim, MCP-only) by id',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'scanner',
    enum: ['sast', 'iac', 'cicd', 'secret', 'container', 'sca'],
  })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: McpVulnerabilityDetailDto })
  @FeatureByRouteParam('scanner', PLAN_GATED_SCANNERS)
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/mcp/project/:projectId/results/:scanner/:vulnerabilityId')
  async getVulnerability(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('scanner') scanner: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<McpVulnerabilityDetailDto> {
    const family = (scanner ?? '').toLowerCase();
    if (!SUPPORTED_SCANNERS.has(family)) {
      throw new BadRequestException(
        `Unsupported scanner '${scanner}'. Expected one of: sast, iac, cicd, secret, container, sca.`,
      );
    }
    const req: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };

    if (family === 'container') {
      const res = await this.resultService.findOneContainer(req);
      if (!res.detection) {
        throw new NotFoundException('Vulnerability not found');
      }
      return toSlimContainerDetail(res.detection);
    }

    if (family === 'sca') {
      const res = await this.resultService.findOneSca(req);
      if (!res.sca) {
        throw new NotFoundException('Vulnerability not found');
      }
      return toSlimScaDetail(res.sca);
    }

    const vuln = await this.detailBaseFamily(family, req);
    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }
    return toSlimBaseFamilyDetail(vuln, family);
  }

  private async detailBaseFamily(
    family: string,
    req: GetProjectVulnerabilityByIdRequest,
  ): Promise<
    | { base?: VulnerabilitySastIacResponse; dataFlowItems?: DataFlowItem[] }
    | undefined
  > {
    switch (family) {
      case 'iac':
        return (await this.resultService.findOneIac(req)).iac;
      case 'cicd':
        return (await this.resultService.findOneCicd(req)).cicd;
      case 'secret':
        return (await this.resultService.findOneSecret(req)).secret;
      case 'sast':
      default:
        return (await this.resultService.findOneSast(req)).sast;
    }
  }

  private dispatchBaseFamily(
    family: string,
    req: GetProjectSastVulnerabilitiesRequest,
  ): Promise<BaseFamilyListResult> {
    switch (family) {
      case 'iac':
        return this.resultService.findAllIac(req);
      case 'cicd':
        return this.resultService.findAllCicd(req);
      case 'secret':
        return this.resultService.findAllSecret(req);
      case 'sast':
      default:
        return this.resultService.findAllSast(req);
    }
  }
}
