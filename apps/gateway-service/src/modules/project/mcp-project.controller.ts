import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Span } from 'nestjs-otel';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { ProjectService } from './project.service';
import { ProjectGetAllBodyDto } from './dto/body/project-get-all-body.dto';
import { ProjectGetAllRequest } from '@grpc/global-management/project';
import { McpProjectListResponseDto } from './dto/response/mcp-project-list-response.dto';
import { toSlimProjectList } from './mcp-project.mapper';

/**
 * MCP-only project discovery surface. Returns a slim project list so
 * an agent can resolve a name into a `projectId` without pulling the dashboard
 * payload (per-scanner analyses, org rollup, link flags, timestamps). Same auth
 * as the dashboard route (`organization:read`); page size stays capped by the
 * shared `ProjectGetAllBodyDto` (@Max(10)). Does NOT touch the existing
 * `/organization/:id/projects` endpoint.
 */
@UseGuards(CombinedAuthRateLimitGuard)
@ApiTags('MCP')
@Controller()
export class McpProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Span()
  @ApiOperation({
    summary: 'List organization projects (slim, MCP-only) for discovery',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: McpProjectListResponseDto })
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/mcp/organization/:organizationId/projects')
  async getProjects(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: ProjectGetAllBodyDto,
    @Req() req: { user: { sub: string } },
  ): Promise<McpProjectListResponseDto> {
    const data: ProjectGetAllRequest = {
      teamId: organizationId,
      pageNumber: Number.parseInt(String(query.page), 10),
      pageSizeNumber: Number.parseInt(String(query.pageSize), 10),
      searchQuery: query.search ?? '',
      userId: req.user.sub,
    };
    const res = await this.projectService.getProjectsOrganization(data);
    return toSlimProjectList(res);
  }
}
