import { GetProjectOverviewResponseDto } from './dto/response/get-project-overview-response.dto';
import { GetOrganizationOverviewResponseDto } from './dto/response/get-organization-overview-response.dto';
import { GetOrganizationOverviewQueryDto } from './dto/query/get-organization-overview-query.dto';
import { OrganizationOverviewFilterQueryDto } from './dto/query/organization-overview-filter-query.dto';
import {
  OrganizationSeverityDistributionResponseDto,
  OrganizationStateDistributionResponseDto,
  OrganizationVulnerabilitiesOverTimeResponseDto,
} from './dto/response/organization-distribution-response.dto';
import { GetProjectOverviewQueryDto } from './dto/query/get-project-overview-query.dto';
import { GetProjectPackagesResponseDto } from './dto/response/get-project-packages-response.dto';
import { GetProjectVulnerabilitiesResponseDto } from './dto/response/get-project-vulnerabilities-response.dto';
import { GetProjectVulnerabilityByIdResponseDto } from './dto/response/get-project-vulnerability-by-id-response.dto';
import { GetProjectBranchesResponseDto } from './dto/response/get-project-branches-response.dto';
import { GetBranchesListQueryDto } from './dto/query/get-branches-list-query.dto';
import { GetBranchesListResponseDto } from './dto/response/get-branches-list-response.dto';
import { GetBatchProjectsBranchesBodyDto } from './dto/body/get-batch-projects-branches-body.dto';
import { GetBatchProjectsBranchesResponseDto } from './dto/response/get-batch-projects-branches-response.dto';
import {
  GetGroupedVulnerabilitiesResponseDto,
  GetGroupedScaVulnerabilitiesResponseDto,
  GetGroupedContainerVulnerabilitiesResponseDto,
  GetVulnerabilityWithSimilarResponseDto,
} from './dto/response/get-grouped-vulnerabilities-response.dto';
import { PriorityDecompositionResponseDto } from './dto/response/priority-decomposition-response.dto';
import { TopVulnerabilitiesResponseDto } from './dto/response/top-vulnerabilities-response.dto';
import {
  GetGroupedVulnerabilitiesBodyDto,
  GetGroupedScaVulnerabilitiesBodyDto,
} from './dto/body/get-grouped-vulnerabilities-body.dto';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
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
import { Feature } from 'src/core/guards/feature/feature.decorator';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { ResultService } from './result.service';
import { GetProjectScaVulnerabilitiesBodyDto } from './dto/body/get-project-sca-vulnerabilities-body.dto';
import { GetProjectVulnerabilitiesBodyDto } from './dto/body/get-project-vulnerabilities-body.dto';
import { UpdateResultBodyDto } from './dto/body/update-vuln-body.dto';
import { BatchUpdateVulnerabilitiesBodyDto } from './dto/body/batch-update-vuln-body.dto';
import { EnqueueBatchUpdateResponseDto } from './dto/response/enqueue-batch-update-response.dto';
import { GenerateBatchReportBodyDto } from './dto/body/generate-batch-report-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { HttpService } from '@nestjs/axios';
import { parseBooleanQuery } from 'src/common/utils/parse-boolean-query.util';

import {
  DeleteContainerImageRequest,
  GenerateOwaspReportResponse,
  GenerateCweReportResponse,
  GetGeneratedReportResponse,
  GetProjectContainerImagesRequest,
  GetProjectContainerImagesResponse,
  GetProjectContainerVulnerabilitiesRequest,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdRequest,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectIacVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectCicdVulnerabilitiesRequest,
  GetProjectCicdVulnerabilitiesResponse,
  GetProjectSecretVulnerabilitiesRequest,
  GetProjectSecretVulnerabilitiesResponse,
  GetProjectOverviewRequest,
  GetProjectOverviewResponse,
  GetOrganizationOverviewResponse,
  GetProjectPackagesResponse,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdRequest,
  GetProjectVulnerabilityByIdResponse,
  ProjectDeleteResponse,
  UpdateProjectVulnerabilityResponse,
  UpdateResultRequest,
  GenerateAggregatedReportResponse,
  GetProjectBranchesResponse,
  // Grouped vulnerabilities
  GetGroupedSastVulnerabilitiesRequest,
  GetGroupedSastVulnerabilitiesResponse,
  GetGroupedIacVulnerabilitiesRequest,
  GetGroupedIacVulnerabilitiesResponse,
  GetGroupedCicdVulnerabilitiesRequest,
  GetGroupedCicdVulnerabilitiesResponse,
  GetGroupedSecretVulnerabilitiesRequest,
  GetGroupedSecretVulnerabilitiesResponse,
  GetGroupedScaVulnerabilitiesRequest,
  GetGroupedScaVulnerabilitiesResponse,
  GetGroupedContainerVulnerabilitiesRequest,
  GetGroupedContainerVulnerabilitiesResponse,
  GetVulnerabilityWithSimilarRequest,
  GetVulnerabilityWithSimilarResponse,
  // Grouped container images
  GetGroupedContainerImagesRequest,
  GetGroupedContainerImagesResponse,
  // Priority decomposition
  GetPriorityDecompositionResponse,
  // Top vulnerabilities
  GetTopVulnerabilitiesResponse,
  // SCA filter options
  GetScaFilterOptionsResponse,
  // Split overview endpoints
  GetOrganizationSeverityDistributionResponse,
  GetOrganizationStateDistributionResponse,
  GetOrganizationVulnerabilitiesOverTimeResponse,
} from '@grpc/analysis-reporting/result';
import {
  RevealSecretResponse,
  RotateSecretResponse,
} from '@grpc/analysis-reporting/analysis_reporting';
import { Logger } from 'nestjs-pino';
import { GetProjectContainerVulnerabilitiesBodyDto } from './dto/body/get-project-container-vulnerabilities-body.dto';
import { GetProjectContainerImagesResponseDto } from './dto/response/get-project-container-images-response.dto';
import { GetProjectContainerImagesQueryDto } from './dto/query/get-project-container-images-query.dto';
import { GetGroupedContainerImagesResponseDto } from './dto/response/get-grouped-container-images-response.dto';
import { GetGroupedContainerImagesQueryDto } from './dto/query/get-grouped-container-images-query.dto';
import { GenerateReportQueryDto } from './dto/body/generate-report-query.dto';
import { SearchDockerImagesQueryDto } from './dto/body/search-docker-images-query.dto';
import { catchError, lastValueFrom, map, of } from 'rxjs';
import { AxiosError } from 'axios';
// Define interfaces for better type safety
interface DockerHubTag {
  name: string;
  last_updated: string;
  full_size: number;
}

interface DockerHubRepo {
  repo_name: string;
  star_count: number;
  description: string;
}

interface DockerHubSearchResponse {
  results: DockerHubRepo[];
}

interface DockerHubTagsResponse {
  results: DockerHubTag[];
}
@ApiTags('Results & Vulnerabilities')
@UseGuards(CombinedAuthRateLimitGuard)
@Controller()
export class ResultController {
  constructor(
    private readonly resultService: ResultService,
    private readonly logger: Logger,
    private readonly httpService: HttpService,
    private readonly permissionsGuard: PermissionsGuard,
  ) {}

  @Span()
  @ApiOperation({
    summary: 'Get all container images of a project',
    description:
      'Retrieves all scanned container images associated with a project',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Container images retrieved successfully',
    type: GetProjectContainerImagesResponseDto,
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
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container/images')
  findAllContainerImages(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectContainerImagesQueryDto,
  ): Promise<GetProjectContainerImagesResponse> {
    const request: GetProjectContainerImagesRequest = {
      projectId,
      page: query.page,
      limit: query.limit,
      branch: query.branch,
    };
    return this.resultService.findAllContainerImages(request);
  }

  /**
   * Get container images grouped by repository name.
   * Each grouped image contains all its different tags with their vulnerability counts.
   */
  @Span()
  @ApiOperation({
    summary: 'Get container images grouped by repository',
    description:
      'Retrieves container images grouped by repository name, showing all tags within each image. ' +
      'Useful for viewing images with multiple tags (e.g., v1.0.0, latest) as a single entity.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiQuery({ type: GetGroupedContainerImagesQueryDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped container images retrieved successfully',
    type: GetGroupedContainerImagesResponseDto,
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
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container/images/grouped')
  getGroupedContainerImages(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedContainerImagesQueryDto,
  ): Promise<GetGroupedContainerImagesResponse> {
    const request: GetGroupedContainerImagesRequest = {
      projectId,
      page: query.page,
      limit: query.limit,
      branch: query.branch,
      sort: query.sort,
      order: query.order?.toUpperCase(),
      searchQuery: query.searchQuery,
    };
    return this.resultService.getGroupedContainerImages(request);
  }

  /**
   * Searches for Docker images on Docker Hub, with proper handling for official images.
   * This function searches for repositories and fetches their most recent tags.
   * @param queryDto The search query object containing the search term, e.g., "python" or "bitnami/nginx".
   * @returns A promise that resolves with a list of found images, including their tags.
   */
  @Get('/dockerhub/search/images')
  async searchDockerImages(@Query() queryDto: SearchDockerImagesQueryDto) {
    if (!queryDto.query || queryDto.query.trim() === '') {
      // An empty query returns an empty array, which is simpler for the client.
      return [];
    }

    const repoNameToSearch = queryDto.query.trim().split(':')[0]; // Only the repository name is used for the initial search
    const searchApiUrl = 'https://hub.docker.com/v2/search/repositories';

    this.logger.log(
      `Searching for Docker Hub repository: [${repoNameToSearch}]`,
    );

    try {
      // Step 1: search for the repository. Take a wider list to find the right one.
      const searchResponse$ = this.httpService
        .get<DockerHubSearchResponse>(searchApiUrl, {
          params: { query: repoNameToSearch, page_size: 5 }, // Search among the first 5 results
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Dashboard-Service/1.0)' },
        })
        .pipe(
          map((response) => response.data.results),
          catchError((error: AxiosError) => {
            this.logger.error(
              `[SEARCH] Failed for repo [${repoNameToSearch}]. Status: ${error.response?.status}, Msg: ${error.message}`,
            );
            if (error.response?.status === 429) {
              throw new HttpException(
                'Docker Hub API rate limit exceeded.',
                HttpStatus.TOO_MANY_REQUESTS,
              );
            }
            return of([]);
          }),
        );

      const searchResults = await lastValueFrom(searchResponse$);

      if (!searchResults || searchResults.length === 0) {
        this.logger.warn(
          `[SEARCH] No repository found for query: [${repoNameToSearch}]`,
        );
        return [];
      }

      // Take the most relevant result (usually the first)
      const repo = searchResults[0];

      // Official images need the "library/" prefix in the API: an official
      // image is a repository name without '/'.
      const isOfficial = !repo.repo_name.includes('/');
      const repoFullName = isOfficial
        ? `library/${repo.repo_name}`
        : repo.repo_name;
      // ----------------------------

      // Step 2: fetch the tags of the repository's full name.
      const tagsApiUrl = `https://hub.docker.com/v2/repositories/${repoFullName}/tags/`;
      this.logger.log(`Fetching tags for repository: [${repoFullName}]`);

      const tagsResponse$ = this.httpService
        .get<DockerHubTagsResponse>(tagsApiUrl, {
          params: { page_size: 20 }, // Fetch the 20 most recent tags
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Dashboard-Service/1.0)' },
        })
        .pipe(
          map((response) => response.data.results),
          catchError((error: AxiosError) => {
            this.logger.error(
              `[TAGS] Failed to fetch tags for [${repoFullName}]. Status: ${error.response?.status}, Msg: ${error.message}`,
              error.stack,
            );
            return of([]); // No tags found: return an empty array.
          }),
        );

      const tags = await lastValueFrom(tagsResponse$);

      if (tags.length === 0) {
        this.logger.warn(
          `[TAGS] No tags found for repository [${repoFullName}]`,
        );
        return [];
      }

      // Step 3: combine the repository details with each tag found.
      return tags.map((tag) => ({
        name: `${repo.repo_name}:${tag.name}`, // The short name is used for display
        description: repo.description,
        star_count: repo.star_count,
        is_official: isOfficial,
        last_updated: tag.last_updated,
        full_size: tag.images[0]?.size || null,
      }));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Unexpected error for query [${queryDto.query}]`,
        error.stack,
      );
      return []; // Always return an empty array on an unexpected error.
    }
  }

  @Span()
  @ApiOperation({
    summary: 'Get all container packages of a project',
    description:
      'Retrieves all packages detected in container images for a project',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiQuery({ type: GetProjectContainerVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Container packages retrieved successfully',
    type: GetProjectPackagesResponseDto,
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
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container/packages')
  findAllContainerPackages(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectContainerVulnerabilitiesBodyDto,
    @Query('imageId', new ParseUUIDPipe({ optional: true })) imageId?: string,
  ): Promise<GetProjectPackagesResponse> {
    const request: GetProjectScaVulnerabilitiesRequest = {
      projectId,
      page: query.page,
      limit: query.limit,
      searchQuery: query.searchQuery,
      packageType: query.classType,
      query: undefined,
      sort: undefined,
      order: undefined,
      severity: undefined,
      status: undefined,
      language: undefined,
      priority: undefined,
      pageNumber: query.page,
      pageSizeNumber: query.limit,
      imageId: imageId,
      exploitabilityVerdict: [],
      packageManager: [],
      packageSource: [],
    };
    return this.resultService.findAllContainerPackages(request);
  }

  @Span()
  @ApiOperation({
    summary: 'Get all container vulnerabilities of a project',
    description:
      'Retrieves paginated container vulnerabilities with filtering options',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiQuery({ type: GetProjectContainerVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Container vulnerabilities retrieved successfully',
    type: GetProjectVulnerabilitiesResponseDto,
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
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container')
  findAllContainer(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectContainerVulnerabilitiesBodyDto,
    @Query('imageId', new ParseUUIDPipe({ optional: true })) imageId?: string,
    @Query('hasAutofix') hasAutofixRaw?: string,
  ): Promise<GetProjectContainerVulnerabilitiesResponse> {
    const req: GetProjectContainerVulnerabilitiesRequest = {
      projectId,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      classType: query.classType,
      priority: query.priority,
      searchQuery: query.searchQuery,
      imageId: imageId,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
    };
    return this.resultService.findAllContainer(req);
  }

  @Span()
  @ApiOperation({
    summary: 'Get a container vulnerability by ID',
    description:
      'Retrieves detailed information about a specific container vulnerability',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiParam({
    name: 'vulnerabilityId',
    type: 'string',
    format: 'uuid',
    description: 'Vulnerability identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Container vulnerability details retrieved successfully',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @ApiResponse({ status: 404, description: 'Vulnerability not found' })
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container/:vulnerabilityId')
  findOneContainer(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectContainerVulnerabilityByIdResponse> {
    const req: GetProjectContainerVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneContainer(req);
  }

  /**
   * Get all vulnerabilities of a project for SAST
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get vulnerabilities
   * @returns All vulnerabilities of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all vulnerabilities of a project for SAST' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All vulnerabilities of a project',
    type: [GetProjectVulnerabilitiesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sast')
  findAllSast(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetProjectSastVulnerabilitiesResponse> {
    const request: GetProjectSastVulnerabilitiesRequest = {
      projectId,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.findAllSast(request);
  }

  /**
   * Get all IaC vulnerabilities of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get vulnerabilities
   * @returns All IaC vulnerabilities of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all IaC vulnerabilities of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All IaC vulnerabilities of a project',
    type: [GetProjectVulnerabilitiesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/iac')
  findAllIac(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetProjectIacVulnerabilitiesResponse> {
    const request: GetProjectIacVulnerabilitiesRequest = {
      projectId,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.findAllIac(request);
  }

  /**
   * Get all CICD vulnerabilities of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get vulnerabilities
   * @returns All CICD vulnerabilities of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all CICD vulnerabilities of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All CICD vulnerabilities of a project',
    type: [GetProjectVulnerabilitiesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/cicd')
  findAllCicd(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetProjectCicdVulnerabilitiesResponse> {
    const request: GetProjectCicdVulnerabilitiesRequest = {
      projectId,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.findAllCicd(request);
  }

  /**
   * Get all Secret vulnerabilities of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get vulnerabilities
   * @returns All Secret vulnerabilities of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all Secret vulnerabilities of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectVulnerabilitiesBodyDto })
  @ApiQuery({
    name: 'commitSha',
    required: false,
    description: 'Partial commit SHA prefix to filter secrets by commit',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    enum: ['head', 'history'],
    description:
      'Filter by secret location: "head" for current HEAD, "history" for historical commits',
  })
  @ApiResponse({
    status: 200,
    description: 'All Secret vulnerabilities of a project',
    type: [GetProjectVulnerabilitiesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/secret')
  findAllSecret(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('commitSha') commitSha?: string,
    @Query('source') source?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetProjectSecretVulnerabilitiesResponse> {
    const request: GetProjectSecretVulnerabilitiesRequest = {
      projectId,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      commitSha: commitSha || '',
      source: source || '',
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.findAllSecret(request);
  }

  /**
   * Get all SCA vulnerabilities of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get vulnerabilities
   * @returns All SCA vulnerabilities of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all SCA vulnerabilities of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectScaVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All SCA vulnerabilities of a project',
    type: [GetProjectVulnerabilitiesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca')
  findAllSca(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectScaVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('malwareOnly') malwareOnlyRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetProjectScaVulnerabilitiesResponse> {
    const request: GetProjectScaVulnerabilitiesRequest = {
      projectId,
      query: query.query,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      packageType: query.packageType,
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      packageManager: query.packageManager ?? [],
      packageSource: query.packageSource ?? [],
      // Unset/false => exclude malware; true => only malware.
      malwareOnly: parseBooleanQuery(malwareOnlyRaw),
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.findAllSca(request);
  }

  /**
   * Get all SCA packages of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param query Query to get packages
   * @returns All SCA packages of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get all SCA packages of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectScaVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All SCA packages of a project',
    type: [GetProjectPackagesResponseDto],
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/packages')
  findAllScaPackages(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectScaVulnerabilitiesBodyDto,
  ): Promise<GetProjectPackagesResponse> {
    const request: GetProjectScaVulnerabilitiesRequest = {
      projectId,
      query: query.query,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      severity: query.severity,
      status: query.status,
      language: query.language,
      priority: query.priority,
      pageNumber: query.pageNumber,
      pageSizeNumber: query.pageSizeNumber,
      searchQuery: query.searchQuery,
      packageType: query.packageType,
      branch: query.branch,
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      packageManager: query.packageManager ?? [],
      packageSource: query.packageSource ?? [],
    };
    return this.resultService.findAllScaPackages(request);
  }

  @Span()
  @ApiOperation({ summary: 'Get license summary for SCA packages' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'License summary' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/licenses/summary')
  getProjectLicenseSummary(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('branch') branch?: string,
    @Query('packageType') packageType?: string[],
  ): Promise<any> {
    // The license policy applied is the project's organization one, resolved
    // by analysis-reporting: this route only checks access to the project.
    return this.resultService.getProjectLicenseSummary(
      projectId,
      branch,
      packageType,
    );
  }

  @Span()
  @ApiOperation({ summary: 'Get packages using a specific license' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'spdxId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Packages by license' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/licenses/:spdxId/packages')
  getPackagesByLicense(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('spdxId') spdxId: string,
    @Query('branch') branch?: string,
    @Query('packageType') packageType?: string[],
  ): Promise<any> {
    // The license policy applied is the project's organization one, resolved
    // by analysis-reporting: this route only checks access to the project.
    return this.resultService.getPackagesByLicense(
      projectId,
      spdxId,
      branch,
      packageType,
    );
  }

  @Span()
  @ApiOperation({
    summary: 'Get distinct SCA filter options (ecosystems & manifest files)',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'branch', required: false, type: 'string' })
  @ApiResponse({ status: 200, description: 'SCA filter options' })
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/filters')
  getScaFilterOptions(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('branch') branch?: string,
  ): Promise<GetScaFilterOptionsResponse> {
    return this.resultService.getScaFilterOptions(projectId, branch);
  }

  /**
   * Get a vulnerability of a project for SCA
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Vulnerability of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get a vulnerability of a project for SCA' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability of a project',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/:vulnerabilityId')
  findOneSca(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const request: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneSca(request);
  }

  /**
   * Get a vulnerability of a project for SAST
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Vulnerability of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get a vulnerability of a project for SAST' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'language', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability of a project',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sast/:vulnerabilityId')
  findOneSast(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const request: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneSast(request);
  }

  /**
   * Get a vulnerability of a project for IaC
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Vulnerability of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get a vulnerability of a project for IaC' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'language', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability of a project',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/iac/:vulnerabilityId')
  findOneIac(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const request: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneIac(request);
  }

  /**
   * Get a vulnerability of a project for CICD
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Vulnerability of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get a vulnerability of a project for CICD' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'language', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability of a project',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/cicd/:vulnerabilityId')
  findOneCicd(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const request: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneCicd(request);
  }

  /**
   * Get a vulnerability of a project for Secret
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Vulnerability of a project
   */
  @Span()
  @ApiOperation({ summary: 'Get a vulnerability of a project for Secret' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'language', type: 'string', required: false })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability of a project',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/secret/:vulnerabilityId')
  findOneSecret(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const request: GetProjectVulnerabilityByIdRequest = {
      projectId,
      vulnerabilityId,
    };
    return this.resultService.findOneSecret(request);
  }

  /**
   * Update a vulnerability of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param id Vulnerability ID
   * @param updateResultDto Update data
   * @returns Updated vulnerability
   */
  @Span()
  @ApiOperation({ summary: 'Update a vulnerability of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateResultBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Updated vulnerability',
    type: GetProjectVulnerabilityByIdResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @Patch('/project/:projectId/results/:vulnerabilityId')
  update(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
    @Body() updateResultDto: UpdateResultBodyDto,
  ): Promise<UpdateProjectVulnerabilityResponse> {
    this.logger.log(
      `User ${req?.user.sub} is updating vulnerability ${vulnerabilityId} for project ${projectId}`,
    );
    // Propagate exploitability override + agent audit fields.
    // ``exploitabilitySource`` is never accepted from the public client: when
    // the analyst sets a verdict here we force ``manual`` so EPSS/OSV crons
    // honor their 7-day skip window.
    const verdict = updateResultDto.exploitabilityVerdict ?? '';
    const request: UpdateResultRequest = {
      projectId,
      vulnerabilityId,
      status: updateResultDto.status,
      priority: updateResultDto.priority,
      comment: updateResultDto.comment,
      userId: req.user?.sub,
      exploitabilityScore: 0,
      exploitabilityVerdict: verdict,
      exploitabilityReason: updateResultDto.exploitabilityReason ?? '',
      // Reset (verdict === 'not_evaluated'): no 'manual' source; analysis-reporting
      // reads the sentinel and sets the columns back to NULL.
      exploitabilitySource:
        verdict && verdict !== 'not_evaluated' ? 'manual' : '',
      // Exploitability factors are never accepted from the public
      // client: they are an agent-observed judgement of the code. A manual
      // verdict therefore always keeps the frozen VERDICT_TO_SCORE value.
      exploitabilityFactors: '',
      cvss4EnvAdjustments: '',
      scoringSource: '',
      exploitabilityScoreReason: '',
      agentToolCallId: updateResultDto.agentToolCallId ?? '',
      agentConversationId: updateResultDto.agentConversationId ?? '',
      agentStreamId: updateResultDto.agentStreamId ?? '',
      // The DTO already refused an `ignored` with no
      // reason; forward it so analysis-reporting can persist the justification
      // and its own `assertDismissalReason` guard is satisfied.
      dismissalReason: updateResultDto.dismissalReason ?? '',
    };
    return this.resultService.update(request);
  }

  /**
   * Batch update multiple vulnerabilities at once.
   * Allows updating status, priority, and/or comment for up to 100 vulnerabilities in a single request.
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param batchUpdateDto Batch update data
   * @returns Batch update results
   */
  @Span()
  @ApiOperation({
    summary: 'Batch update multiple vulnerabilities',
    description:
      'Update status, priority, and/or comment for multiple vulnerabilities at once. Maximum 100 vulnerabilities per request.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: BatchUpdateVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 202,
    description:
      'Batch update enqueued — returns a task ID for progress tracking',
    type: EnqueueBatchUpdateResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @HttpCode(HttpStatus.ACCEPTED)
  @Patch('/project/:projectId/results/batch')
  async batchUpdate(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() batchUpdateDto: BatchUpdateVulnerabilitiesBodyDto,
  ): Promise<EnqueueBatchUpdateResponseDto> {
    this.logger.log(
      `User ${req?.user.sub} is batch updating ${batchUpdateDto.items.length} vulnerabilities for project ${projectId}`,
    );
    return this.resultService.batchUpdate(
      projectId,
      batchUpdateDto.items,
      req.user?.sub,
      {
        agentToolCallId: batchUpdateDto.agentToolCallId,
        agentConversationId: batchUpdateDto.agentConversationId,
        agentStreamId: batchUpdateDto.agentStreamId,
      },
    );
  }

  /**
   * Get overview of a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @returns Project overview
   */
  @Span()
  @ApiOperation({ summary: 'Get overview of a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Project overview',
    type: GetProjectOverviewResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/overview')
  getProjectOverview(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query?: GetProjectOverviewQueryDto,
  ): Promise<GetProjectOverviewResponse> {
    const request: GetProjectOverviewRequest = {
      projectId,
      branches: query?.branches ?? [],
    };
    return this.resultService.getProjectOverview(request);
  }

  /**
   * Get organization-wide overview aggregating statistics from all projects.
   * Returns aggregated vulnerability data including severity distribution,
   * state distribution, analysis types, trends, and per-project/team summaries.
   * Supports comprehensive filtering, pagination, and comparison features.
   *
   * @param req Request HTTP
   * @param organizationId Organization ID
   * @param query Query parameters for filtering and pagination
   * @returns Aggregated organization overview
   */
  @Span()
  @ApiOperation({
    summary: 'Get aggregated overview statistics for an organization',
    description:
      'Returns comprehensive vulnerability statistics aggregated across all projects in the organization. Supports filtering by projects, teams, severity, status, analysis types, date ranges, languages, branches, and more. Includes pagination for summaries and period-over-period comparison.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Organization overview with aggregated statistics',
    type: GetOrganizationOverviewResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read_appsec')
  @Get('/organization/:organizationId/results/overview')
  getOrganizationOverview(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: GetOrganizationOverviewQueryDto,
  ): Promise<GetOrganizationOverviewResponse> {
    const userId = req?.user?.sub;
    return this.resultService.getOrganizationOverview(
      organizationId,
      userId,
      query,
    );
  }

  @Span()
  @ApiOperation({ summary: 'Organization severity distribution (lazy)' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    type: OrganizationSeverityDistributionResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read_appsec')
  @Get('/organization/:organizationId/results/overview/severity-distribution')
  getOrganizationSeverityDistribution(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: OrganizationOverviewFilterQueryDto,
  ): Promise<GetOrganizationSeverityDistributionResponse> {
    return this.resultService.getOrganizationSeverityDistribution(
      organizationId,
      req?.user?.sub,
      query,
    );
  }

  @Span()
  @ApiOperation({ summary: 'Organization state distribution (lazy)' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    type: OrganizationStateDistributionResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read_appsec')
  @Get('/organization/:organizationId/results/overview/state-distribution')
  getOrganizationStateDistribution(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: OrganizationOverviewFilterQueryDto,
  ): Promise<GetOrganizationStateDistributionResponse> {
    return this.resultService.getOrganizationStateDistribution(
      organizationId,
      req?.user?.sub,
      query,
    );
  }

  @Span()
  @ApiOperation({ summary: 'Organization vulnerabilities over time (lazy)' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    type: OrganizationVulnerabilitiesOverTimeResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read_appsec')
  @Get(
    '/organization/:organizationId/results/overview/vulnerabilities-over-time',
  )
  getOrganizationVulnerabilitiesOverTime(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: OrganizationOverviewFilterQueryDto,
  ): Promise<GetOrganizationVulnerabilitiesOverTimeResponse> {
    return this.resultService.getOrganizationVulnerabilitiesOverTime(
      organizationId,
      req?.user?.sub,
      query,
    );
  }

  @Span()
  @ApiOperation({ summary: 'Delete a scanned container image from a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'imageId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Confirms that the image and its data have been deleted.',
  })
  @ApiResponse({
    status: 404,
    description: 'Image not found for this project.',
  })
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Delete('/project/:projectId/results/container/images/:imageId')
  deleteContainerImage(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
  ): Promise<ProjectDeleteResponse> {
    this.logger.log(
      `Received request to delete image ${imageId} from project ${projectId}.`,
    );
    const request: DeleteContainerImageRequest = {
      projectId,
      imageId,
    };
    return this.resultService.deleteContainerImage(request);
  }

  /**
   * Generate a report for a project (SBOM or OWASP Top 10)
   *
   * @param projectId Project ID
   * @param reportType Type of report ("sbom" or "owasp")
   * @param format Output format ("json", "html", or "pdf")
   * @returns The generated report as a downloadable file
   */
  @Span()
  @ApiOperation({
    summary: 'Generate a security report for a project',
    description:
      'Generate either an SBOM (Software Bill of Materials) report or OWASP Top 10 report in JSON, HTML, or PDF format',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'reportType',
    enum: ['sbom', 'owasp'],
    description: 'Type of report to generate',
  })
  @ApiParam({
    name: 'format',
    enum: ['json', 'html', 'pdf'],
    description: 'Output format',
  })
  @ApiResponse({
    status: 200,
    description: 'Report generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid parameters',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Feature('reports')
  @Get('/project/:projectId/owasp-report/:format')
  async generateOwaspReport(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('format') format: string,
    @Query() query: GenerateReportQueryDto,
  ): Promise<GenerateOwaspReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is generating OWASP Top 10 report in ${format} format for project ${projectId}${
        query.branch ? ` (branch: ${query.branch})` : ''
      }`,
    );

    const validFormats = ['json', 'html', 'pdf'];
    if (!validFormats.includes(format)) {
      throw new HttpException(
        `Invalid format. Must be one of: ${validFormats.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Parse detailed parameter (default: true)
    const detailed = query.detailed === undefined || query.detailed === 'true';

    const result = await this.resultService.generateOwaspReport(
      projectId,
      format,
      detailed,
      query.branch,
      req?.user?.sub,
    );

    return result;
  }

  /**
   * Generate CWE Top 25 report for a project
   *
   * @param req Request HTTP
   * @param projectId Project ID
   * @param format Report format (json, html, or pdf)
   * @param detailedParam Optional query parameter for detailed report (default: true)
   * @returns CWE Top 25 report in requested format
   */
  @Span()
  @ApiOperation({ summary: 'Generate CWE Top 25 2024 report for a project' })
  @ApiResponse({
    status: 200,
    description: 'CWE Top 25 report generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid format',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Feature('reports')
  @Get('/project/:projectId/cwe-report/:format')
  async generateCweReport(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('format') format: string,
    @Query() query: GenerateReportQueryDto,
  ): Promise<GenerateCweReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is generating CWE Top 25 report in ${format} format for project ${projectId}${
        query.branch ? ` (branch: ${query.branch})` : ''
      }`,
    );

    const validFormats = ['json', 'html', 'pdf'];
    if (!validFormats.includes(format)) {
      throw new HttpException(
        `Invalid format. Must be one of: ${validFormats.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Parse detailed parameter (default: true)
    const detailed = query.detailed === undefined || query.detailed === 'true';

    const result = await this.resultService.generateCweReport(
      projectId,
      format,
      detailed,
      query.branch,
      req?.user?.sub,
    );

    return result;
  }

  /**
   * Fetch the status of an async-generated report and, when ready, a freshly
   * signed download URL. Polled by the dashboard after it receives a
   * REPORT_READY realtime event (which is IDs-only).
   */
  @Span()
  @ApiOperation({
    summary: 'Get the status + signed download URL of a generated report',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'reportId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Report status retrieved' })
  @ApiResponse({
    status: 404,
    description: 'Report not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/reports/:reportId')
  async getGeneratedReport(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId') reportId: string,
  ): Promise<GetGeneratedReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is fetching generated report ${reportId} for project ${projectId}`,
    );
    return this.resultService.getGeneratedReport(projectId, reportId);
  }

  /**
   * Poll the status of an async-generated aggregated organization report.
   * Returns the same payload as getGeneratedReport once status is "ready".
   */
  @Span()
  @ApiOperation({ summary: 'Poll an async aggregated organization report' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_report')
  @Feature('reports')
  @Get('/organization/:organizationId/reports/:reportId')
  async getGeneratedOrganizationReport(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('reportId') reportId: string,
  ) {
    this.logger.log(
      `User ${req?.user?.sub} is polling aggregated organization report ${reportId} for organization ${organizationId}`,
    );
    return this.resultService.getGeneratedAggregatedReport(
      'organization',
      organizationId,
      reportId,
      organizationId,
    );
  }

  /**
   * Poll the status of an async-generated aggregated team report.
   */
  @Span()
  @ApiOperation({ summary: 'Poll an async aggregated team report' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('team')
  @Permission('read_report')
  @Feature('reports')
  @Get('/team/:teamId/reports/:reportId')
  async getGeneratedTeamReport(
    @Req() req,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Param('reportId') reportId: string,
  ) {
    this.logger.log(
      `User ${req?.user?.sub} is polling aggregated team report ${reportId} for team ${teamId}`,
    );
    return this.resultService.getGeneratedAggregatedReport(
      'team',
      teamId,
      reportId,
      '',
    );
  }

  /**
   * Delete a stored per-project report (frees a quota slot + removes
   * the GCS object). This is report management, so it uses the purpose-built
   * manager-only `archive_report` permission (team_manager / creator /
   * administrator) — the project-scoped equivalent of the `manage` gate on the
   * org/team sibling delete endpoints — NOT the developer-accessible
   * `change_vulnerability_state`. Plus the `reports` feature gate.
   */
  @Span()
  @ApiOperation({ summary: 'Delete a stored project report' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('archive_report')
  @Feature('reports')
  @Delete('/project/:projectId/reports/:reportId')
  async deleteGeneratedReport(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId') reportId: string,
  ) {
    this.logger.log(
      `User ${req?.user?.sub} is deleting stored report ${reportId} for project ${projectId}`,
    );
    return this.resultService.deleteGeneratedReport(projectId, reportId);
  }

  /**
   * Delete any stored aggregated report OWNED BY the organization
   * (org, team OR batch scope). The org-scoped Permify guard already authorizes
   * the whole org, so we match on organizationId ALONE (empty scopeType/scopeId)
   * rather than forcing scopeType='organization' — otherwise org-owned team/batch
   * reports that legitimately appear in the org drawer would be undeletable and
   * leak their quota slot until expiry.
   */
  @Span()
  @ApiOperation({ summary: 'Delete a stored organization report' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('archive_report')
  @Feature('reports')
  @Delete('/organization/:organizationId/reports/:reportId')
  async deleteOrganizationReport(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('reportId') reportId: string,
  ) {
    this.logger.log(
      `User ${req?.user?.sub} is deleting stored organization report ${reportId} for organization ${organizationId}`,
    );
    return this.resultService.deleteAggregatedReport(
      '',
      '',
      organizationId,
      reportId,
    );
  }

  /**
   * Delete a stored aggregated team report.
   */
  @Span()
  @ApiOperation({ summary: 'Delete a stored team report' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('team')
  @Permission('archive_report')
  @Feature('reports')
  @Delete('/team/:teamId/reports/:reportId')
  async deleteTeamReport(
    @Req() req,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Param('reportId') reportId: string,
  ) {
    this.logger.log(
      `User ${req?.user?.sub} is deleting stored team report ${reportId} for team ${teamId}`,
    );
    return this.resultService.deleteAggregatedReport(
      'team',
      teamId,
      '',
      reportId,
    );
  }

  /**
   * Paginated history of a project's stored reports (newest first,
   * expired excluded). Read-only: same `read_scan_result` gate as the poll
   * endpoint. Download is obtained on demand via GET /reports/:reportId.
   */
  @Span()
  @ApiOperation({ summary: "List a project's stored reports (paginated)" })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Feature('reports')
  @Get('/project/:projectId/reports')
  async listGeneratedReports(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resultService.listGeneratedReports(
      projectId,
      Math.max(1, parseInt(page ?? '1', 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20)),
    );
  }

  /**
   * Paginated history of an organization's aggregated reports (every
   * scope owned by the org). Org-scoped Permify + reports feature gate.
   */
  @Span()
  @ApiOperation({
    summary: "List an organization's stored reports (paginated)",
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_report')
  @Feature('reports')
  @Get('/organization/:organizationId/reports')
  async listOrganizationReports(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resultService.listAggregatedReports(
      'organization',
      organizationId,
      organizationId,
      Math.max(1, parseInt(page ?? '1', 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20)),
    );
  }

  /**
   * Paginated history of a team's aggregated reports.
   */
  @Span()
  @ApiOperation({ summary: "List a team's stored reports (paginated)" })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('team')
  @Permission('read_report')
  @Feature('reports')
  @Get('/team/:teamId/reports')
  async listTeamReports(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resultService.listAggregatedReports(
      'team',
      teamId,
      '',
      Math.max(1, parseInt(page ?? '1', 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20)),
    );
  }

  /**
   * Org-wide shared stored-report usage `{ used, limit }`. The quota
   * is a single pool across project + org/team/batch reports, so both the
   * project and organization drawers show the SAME count. The project route
   * resolves the owning org server-side.
   */
  @Span()
  @ApiOperation({ summary: 'Org-wide stored-report usage for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Feature('reports')
  @Get('/project/:projectId/reports/usage')
  async getProjectReportUsage(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.resultService.getReportUsage({ projectId });
  }

  @Span()
  @ApiOperation({ summary: 'Org-wide stored-report usage for an organization' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('read_report')
  @Feature('reports')
  @Get('/organization/:organizationId/reports/usage')
  async getOrganizationReportUsage(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.resultService.getReportUsage({ organizationId });
  }

  /**
   * Generate aggregated security report for an Organization
   * Consolidates reports from all projects within the organization
   *
   * @param req Request HTTP
   * @param organizationId Organization ID
   * @param reportType Type of report (owasp or cwe)
   * @param format Output format (json, html, or pdf)
   * @param query Query parameters including detailed flag
   * @returns Aggregated organization report
   */
  @Span()
  @ApiOperation({
    summary: 'Generate aggregated security report for an Organization',
    description:
      'Generates a consolidated OWASP Top 10 or CWE Top 25 report for all projects in an organization',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'reportType',
    enum: ['owasp', 'cwe', 'license', 'ai-act'],
    description: 'Type of report to generate',
  })
  @ApiParam({
    name: 'format',
    enum: ['json', 'html', 'pdf'],
    description: 'Output format',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization report generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid parameters',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('create_report')
  @Feature('reports')
  @Get('/organization/:organizationId/report/:reportType/:format')
  async generateOrganizationReport(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('reportType') reportType: string,
    @Param('format') format: string,
    @Query() query: GenerateReportQueryDto,
  ): Promise<GenerateAggregatedReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is generating ${reportType} report in ${format} format for organization ${organizationId}`,
    );

    this.validateReportParams(reportType, format);

    const detailed = query.detailed === undefined || query.detailed === 'true';
    const branchFilter = query.branchFilter || 'all';
    const projectBranchSelections = query.projectBranchSelections || [];

    return this.resultService.generateOrganizationReport(
      organizationId,
      req.user.sub,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
    );
  }

  /**
   * Generate aggregated security report for a Team
   * Consolidates reports from all projects within the team
   *
   * @param req Request HTTP
   * @param teamId Team ID
   * @param reportType Type of report (owasp or cwe)
   * @param format Output format (json, html, or pdf)
   * @param query Query parameters including detailed flag
   * @returns Aggregated team report
   */
  @Span()
  @ApiOperation({
    summary: 'Generate aggregated security report for a Team',
    description:
      'Generates a consolidated OWASP Top 10 or CWE Top 25 report for all projects in a team',
  })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'reportType',
    enum: ['owasp', 'cwe', 'license', 'ai-act'],
    description: 'Type of report to generate',
  })
  @ApiParam({
    name: 'format',
    enum: ['json', 'html', 'pdf'],
    description: 'Output format',
  })
  @ApiResponse({
    status: 200,
    description: 'Team report generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid parameters',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Feature('reports')
  @SubjectType('team')
  @Permission('create_report')
  @Get('/team/:teamId/report/:reportType/:format')
  async generateTeamReport(
    @Req() req,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Param('reportType') reportType: string,
    @Param('format') format: string,
    @Query() query: GenerateReportQueryDto,
  ): Promise<GenerateAggregatedReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is generating ${reportType} report in ${format} format for team ${teamId}`,
    );

    this.validateReportParams(reportType, format);

    const detailed = query.detailed === undefined || query.detailed === 'true';
    const branchFilter = query.branchFilter || 'all';
    const projectBranchSelections = query.projectBranchSelections || [];

    return this.resultService.generateTeamReport(
      teamId,
      req.user.sub,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
      query.organizationId,
    );
  }

  /**
   * Generate report for a manual selection of projects
   * Allows generating consolidated reports for specific project combinations
   *
   * @param req Request HTTP
   * @param reportType Type of report (owasp or cwe)
   * @param format Output format (json, html, or pdf)
   * @param body Request body with project IDs and options
   * @returns Batch report for selected projects
   */
  @Span()
  @ApiOperation({
    summary: 'Generate report for a manual selection of projects',
    description:
      'Generates a consolidated OWASP Top 10, CWE Top 25, or License report for a custom list of projects',
  })
  @ApiParam({
    name: 'reportType',
    enum: ['owasp', 'cwe', 'license', 'ai-act'],
    description: 'Type of report to generate',
  })
  @ApiParam({
    name: 'format',
    enum: ['json', 'html', 'pdf'],
    description: 'Output format',
  })
  @ApiResponse({
    status: 200,
    description: 'Batch report generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid parameters or empty project list',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden - User does not have access to one or more projects',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('organization')
  @Permission('create_report')
  @Feature('reports')
  @Post(
    '/organization/:organizationId/project/report/batch/:reportType/:format',
  )
  async generateBatchReport(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('reportType') reportType: string,
    @Param('format') format: string,
    @Body() body: GenerateBatchReportBodyDto,
  ): Promise<GenerateAggregatedReportResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is generating ${reportType} report in ${format} format for ${body.projectIds.length} projects`,
    );

    this.validateReportParams(reportType, format);

    // Defense in depth: the org-level @Permission('create_report') check above
    // only proves the user can report on `:organizationId`, NOT that they can read
    // every project in `body.projectIds`. Without per-project verification,
    // an org admin can request reports on projects belonging to OTHER tenants
    // (cross-tenant exfiltration). Verify `read_report` on each project here.
    const userId = req?.user?.sub;
    const checks = await Promise.all(
      body.projectIds.map((projectId) =>
        this.permissionsGuard.checkPermission(
          projectId,
          'project',
          'read_report',
          userId,
          'user',
        ),
      ),
    );
    if (checks.some((allowed) => !allowed)) {
      // Generic message — must NOT leak which projectIds exist or which the
      // user lacks access to (would enable enumeration).
      throw new ForbiddenException(
        'You do not have access to one or more requested projects',
      );
    }

    const detailed = body.detailed === undefined || body.detailed === true;
    const branchFilter = body.branchFilter || 'all';
    const projectBranchSelections = body.projectBranchSelections || [];

    return this.resultService.generateBatchReport(
      body.projectIds,
      req.user.sub,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
      organizationId,
    );
  }

  /**
   * Get distinct branches from vulnerability detections for a project.
   * Retrieves branch names from SAST, SCA, and IAC vulnerability detections.
   * Useful for projects not linked to external integrations (GitHub/GitLab).
   *
   * @param projectId The project identifier
   * @returns List of distinct branch names found across all vulnerability types
   */
  @Span()
  @ApiOperation({
    summary: 'Get branches from vulnerability detections',
    description:
      'Retrieves distinct branch names found in SAST, SCA, and IAC vulnerability detections. ' +
      'Use this endpoint for projects that are not linked to GitHub or GitLab integrations.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Branches retrieved successfully',
    type: GetProjectBranchesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/branches')
  getProjectBranches(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<GetProjectBranchesResponse> {
    return this.resultService.getProjectBranches(projectId);
  }

  @ApiOperation({
    summary: 'Get a unified, paginated list of branches for a project',
    description:
      'Single endpoint that returns paginated branches regardless of the ' +
      'provider. The gateway routes server-side by the project link status: ' +
      'GitHub-linked → GitHub branches, GitLab-linked → GitLab branches, ' +
      'otherwise branches derived from past scans. Supports case-insensitive ' +
      'search, pagination, and optionally including archived branches.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'Project identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Branches retrieved successfully',
    type: GetBranchesListResponseDto,
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
  @ApiResponse({
    status: 404,
    description: 'Project not found',
    type: ErrorDto,
  })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/branches/list')
  getProjectBranchesList(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetBranchesListQueryDto,
  ): Promise<GetBranchesListResponseDto> {
    return this.resultService.getProjectBranchesList(projectId, query);
  }

  @ApiOperation({
    summary:
      'Get distinct active + archived branches for many projects in one request (server-side fan-out)',
    description:
      'Used by the organization overview filter and the Reports page branch selector to populate per-project branches without firing one HTTP request per project. Pass projectIds in the JSON request body. Every projectId must be a project the caller may read in the organization, or the whole request is refused with 403.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description: 'Organization identifier',
  })
  @ApiBody({ type: GetBatchProjectsBranchesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Per-project branches retrieved successfully',
    type: GetBatchProjectsBranchesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read')
  @Post('/organization/:organizationId/projects/branches')
  getBatchProjectsBranches(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: GetBatchProjectsBranchesBodyDto,
  ): Promise<GetBatchProjectsBranchesResponseDto> {
    // PermissionsGuard authorises the path organisation only: the service
    // refuses any body project the caller cannot read there.
    return this.resultService.getBatchProjectsBranches(
      organizationId,
      req?.user?.sub,
      body.projectIds,
    );
  }

  // ===================================================================
  // GROUPED VULNERABILITIES - New endpoints for consolidated view
  // ===================================================================

  /**
   * Get SAST vulnerabilities grouped by rule ID
   */
  @Span()
  @ApiOperation({
    summary: 'Get SAST vulnerabilities grouped by rule ID',
    description:
      'Returns SAST vulnerabilities consolidated by rule with occurrence counts and severity breakdown. Useful for showing unique vulnerability types with their occurrences.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetGroupedVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped SAST vulnerabilities',
    type: GetGroupedVulnerabilitiesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sast/grouped')
  getGroupedSastVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetGroupedSastVulnerabilitiesResponse> {
    const request: GetGroupedSastVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.perPage ?? 10,
      sort: query.sort ?? 'occurrenceCount',
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severityFilter ?? [],
      status: query.statusFilter ?? [],
      priority: query.priorityFilter ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      scoringSource: query.scoringSource,
      language: query.languageFilter ?? [],
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.getGroupedSastVulnerabilities(request);
  }

  /**
   * Get IAC vulnerabilities grouped by rule ID
   */
  @Span()
  @ApiOperation({
    summary: 'Get IAC vulnerabilities grouped by rule ID',
    description:
      'Returns IAC vulnerabilities consolidated by rule with occurrence counts and severity breakdown.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetGroupedVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped IAC vulnerabilities',
    type: GetGroupedVulnerabilitiesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/iac/grouped')
  getGroupedIacVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetGroupedIacVulnerabilitiesResponse> {
    const request: GetGroupedIacVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.perPage ?? 10,
      sort: query.sort ?? 'occurrenceCount',
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severityFilter ?? [],
      status: query.statusFilter ?? [],
      priority: query.priorityFilter ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      scoringSource: query.scoringSource,
      language: query.languageFilter ?? [],
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.getGroupedIacVulnerabilities(request);
  }

  /**
   * Get CICD vulnerabilities grouped by rule ID
   */
  @Span()
  @ApiOperation({
    summary: 'Get CICD vulnerabilities grouped by rule ID',
    description:
      'Returns CICD vulnerabilities consolidated by rule with occurrence counts and severity breakdown.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetGroupedVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped CICD vulnerabilities',
    type: GetGroupedVulnerabilitiesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/cicd/grouped')
  getGroupedCicdVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetGroupedCicdVulnerabilitiesResponse> {
    const request: GetGroupedCicdVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.perPage ?? 10,
      sort: query.sort ?? 'occurrenceCount',
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severityFilter ?? [],
      status: query.statusFilter ?? [],
      priority: query.priorityFilter ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      scoringSource: query.scoringSource,
      language: query.languageFilter ?? [],
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.getGroupedCicdVulnerabilities(request);
  }

  /**
   * Get Secret vulnerabilities grouped by rule ID
   */
  @Span()
  @ApiOperation({
    summary: 'Get Secret vulnerabilities grouped by rule ID',
    description:
      'Returns Secret vulnerabilities consolidated by rule with occurrence counts and severity breakdown.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetGroupedVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped Secret vulnerabilities',
    type: GetGroupedVulnerabilitiesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/secret/grouped')
  getGroupedSecretVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedVulnerabilitiesBodyDto,
    @Query('hasAutofix') hasAutofixRaw?: string,
    @Query('excludeAutofixCounts') excludeAutofixCountsRaw?: string,
  ): Promise<GetGroupedSecretVulnerabilitiesResponse> {
    const request: GetGroupedSecretVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.perPage ?? 10,
      sort: query.sort ?? 'occurrenceCount',
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severityFilter ?? [],
      status: query.statusFilter ?? [],
      priority: query.priorityFilter ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
      source: query.sourceFilter ?? [],
      scoringSource: query.scoringSource,
      language: query.languageFilter ?? [],
      sourcePath: query.sourcePath,
      excludeAutofixCounts: parseBooleanQuery(excludeAutofixCountsRaw),
    };
    return this.resultService.getGroupedSecretVulnerabilities(request);
  }

  /**
   * Get SCA vulnerabilities grouped by CVE + package name
   */
  @Span()
  @ApiOperation({
    summary: 'Get SCA vulnerabilities grouped by CVE + package name',
    description:
      'Returns SCA vulnerabilities consolidated by CVE and package with occurrence counts, severity breakdown, and CVSS scores.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetGroupedScaVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped SCA vulnerabilities',
    type: GetGroupedScaVulnerabilitiesResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/sca/grouped')
  getGroupedScaVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetGroupedScaVulnerabilitiesBodyDto,
  ): Promise<GetGroupedScaVulnerabilitiesResponse> {
    // Map currentCVSS to highestCvss for sorting
    let sort = query.sort ?? 'occurrenceCount';
    if (sort === 'currentCVSS') {
      sort = 'highestCvss';
    }
    const request: GetGroupedScaVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.perPage ?? 10,
      sort,
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severityFilter ?? [],
      status: query.statusFilter ?? [],
      priority: query.priorityFilter ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      packageType: query.packageManagerFilter ?? [],
      scoringSource: query.scoringSource,
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      hasAutofix: query.hasAutofix,
      packageManager: query.packageManager ?? [],
      packageSource: query.packageSource ?? [],
      malwareOnly: query.malwareOnly,
    };
    return this.resultService.getGroupedScaVulnerabilities(request);
  }

  /**
   * Get container vulnerabilities grouped by package (name + version)
   */
  @Span()
  @ApiOperation({
    summary: 'Get container vulnerabilities grouped by package',
    description:
      'Returns container vulnerabilities consolidated by package (name + version), each group listing the CVEs affecting it with occurrence counts, severity breakdown and CVSS scores.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ type: GetProjectContainerVulnerabilitiesBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Grouped container vulnerabilities',
    type: GetGroupedContainerVulnerabilitiesResponseDto,
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
  @Feature('container_scanning')
  @UseGuards(PermissionsGuard, FeatureGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/container/grouped')
  getGroupedContainerVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: GetProjectContainerVulnerabilitiesBodyDto,
    @Query('imageId', new ParseUUIDPipe({ optional: true })) imageId?: string,
    @Query('hasAutofix') hasAutofixRaw?: string,
  ): Promise<GetGroupedContainerVulnerabilitiesResponse> {
    // Map currentCVSS to highestCvss for sorting (parity with the SCA route).
    let sort = query.sort ?? 'currentSeverity';
    if (sort === 'currentCVSS' || sort === 'cvssScore') {
      sort = 'highestCvss';
    }
    const request: GetGroupedContainerVulnerabilitiesRequest = {
      projectId,
      pageNumber: query.page ?? 1,
      pageSize: query.limit ?? 10,
      sort,
      order: (query.order ?? 'DESC').toUpperCase(),
      severity: query.severity ?? [],
      status: query.status ?? [],
      priority: query.priority ?? [],
      searchQuery: query.searchQuery ?? '',
      branch: query.branch,
      imageId: imageId ?? '',
      classType: query.classType ?? [],
      exploitabilityVerdict: query.exploitabilityVerdict ?? [],
      scoringSource: query.scoringSource,
      hasAutofix: parseBooleanQuery(hasAutofixRaw),
    };
    return this.resultService.getGroupedContainerVulnerabilities(request);
  }

  /**
   * Get a vulnerability by ID with similar occurrences
   */
  @Span()
  @ApiOperation({
    summary: 'Get vulnerability by ID with similar occurrences',
    description:
      'Returns a vulnerability and all similar occurrences (same rule for SAST/IAC/CICD/Secret, same CVE for SCA).',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'pathFilter',
    required: false,
    type: 'string',
    description: 'Optional filter to narrow similar occurrences by path',
  })
  @ApiResponse({
    status: 200,
    description: 'Vulnerability with similar occurrences',
    type: GetVulnerabilityWithSimilarResponseDto,
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/:vulnerabilityId/similar')
  getVulnerabilityWithSimilar(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
    @Query('pathFilter') pathFilter?: string,
  ): Promise<GetVulnerabilityWithSimilarResponse> {
    const request: GetVulnerabilityWithSimilarRequest = {
      projectId,
      vulnerabilityId,
      pathFilter,
    };
    return this.resultService.getVulnerabilityWithSimilar(request);
  }

  /**
   * Helper to strictly validate enum params for report endpoints
   *
   * @param reportType Report type to validate
   * @param format Format to validate
   * @throws HttpException if parameters are invalid
   */
  private validateReportParams(reportType: string, format: string): void {
    const validReports = ['owasp', 'cwe', 'license', 'ai-act'];
    const validFormats = ['json', 'html', 'pdf'];

    if (!validReports.includes(reportType)) {
      throw new HttpException(
        `Invalid report type. Must be: ${validReports.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!validFormats.includes(format)) {
      throw new HttpException(
        `Invalid format. Must be: ${validFormats.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ===================================================================
  // LICENSE CLASSIFICATIONS - Organization-level license settings
  // ===================================================================

  @Span()
  @ApiOperation({
    summary: 'Get all license classifications for an organization',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'License classifications' })
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('read')
  @Get('/organization/:organizationId/licenses/classifications')
  getLicenseClassifications(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<any> {
    return this.resultService.getLicenseClassifications(organizationId);
  }

  @Span()
  @ApiOperation({
    summary: 'Update license classification overrides for an organization',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Overrides updated' })
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  // The license policy AppSec's SCA findings and license reports apply:
  // AppSec's, as the policies are.
  @Permission('manage_policy')
  @Put('/organization/:organizationId/licenses/classifications')
  updateLicenseClassifications(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: { overrides: Array<{ spdxId: string; category: string }> },
  ): Promise<any> {
    return this.resultService.updateLicenseClassifications(
      organizationId,
      body.overrides || [],
    );
  }

  @Span()
  @ApiOperation({
    summary: 'Reset all license classification overrides for an organization',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Overrides reset' })
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('manage_policy')
  @Delete('/organization/:organizationId/licenses/classifications')
  resetLicenseClassifications(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<any> {
    return this.resultService.resetLicenseClassifications(organizationId);
  }

  @Span()
  @ApiOperation({
    summary: 'Delete a single custom license override for an organization',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'spdxId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Override deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete known SPDX license' })
  @ApiResponse({ status: 404, description: 'Override not found' })
  @UseGuards(PermissionsGuard)
  @SubjectType('organization')
  @Permission('manage_policy')
  @Delete('/organization/:organizationId/licenses/classifications/:spdxId')
  deleteLicenseOverride(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('spdxId') spdxId: string,
  ): Promise<any> {
    return this.resultService.deleteLicenseOverride(organizationId, spdxId);
  }

  @Span()
  @ApiOperation({
    summary: 'Manually assign a license SPDX ID to a specific package',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'packageId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'License assigned' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @Put('/project/:projectId/sca/packages/:packageId/license')
  assignPackageLicense(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Body() body: { spdxId: string },
  ): Promise<any> {
    return this.resultService.assignPackageLicense(
      projectId,
      packageId,
      body.spdxId,
    );
  }

  @Span()
  @ApiOperation({
    summary: 'Toggle ignore status for a package in license analysis',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'packageId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ignore status updated' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @Put('/project/:projectId/sca/packages/:packageId/license-ignore')
  setPackageLicenseIgnored(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Body() body: { ignored: boolean },
  ): Promise<any> {
    return this.resultService.setPackageLicenseIgnored(
      projectId,
      packageId,
      body.ignored,
    );
  }

  @Span()
  @ApiOperation({
    summary: 'Get priority decomposition for a vulnerability',
    description:
      'Returns how the algorithmic priority was computed, showing the contribution of each signal (CVSS4, EPSS, exploitability, context).',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'type',
    type: 'string',
    enum: ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'],
  })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: PriorityDecompositionResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorDto,
  })
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
  @ApiResponse({
    status: 404,
    description: 'Not Found',
  })
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get(
    '/project/:projectId/results/:type/:vulnerabilityId/priority-decomposition',
  )
  getPriorityDecomposition(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('type') type: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<GetPriorityDecompositionResponse> {
    return this.resultService.getPriorityDecomposition({
      projectId,
      vulnerabilityType: type,
      vulnerabilityId,
    });
  }

  @Span()
  @ApiOperation({
    summary: 'Get top vulnerabilities across all types',
    description:
      'Returns the top N vulnerabilities across all detection types (SAST, SCA, IAC, Container, CICD, Secret), ranked by composite priority score.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    type: 'number',
    required: false,
    description: 'Number of top vulnerabilities to return (default: 5)',
  })
  @ApiResponse({ status: 200, type: TopVulnerabilitiesResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorDto,
  })
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('read_scan_result')
  @Get('/project/:projectId/results/top-vulnerabilities')
  getTopVulnerabilities(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('limit') limit?: string,
  ): Promise<GetTopVulnerabilitiesResponse> {
    return this.resultService.getTopVulnerabilities({
      projectId,
      limit: limit ? parseInt(limit, 10) : 5,
    });
  }

  /**
   * Reveal the plaintext value of a detected secret.
   * Returns the decrypted secret and the timestamp of this reveal action.
   * Response is marked Cache-Control: no-store to prevent caching of sensitive data.
   *
   * @param req Request HTTP (user context)
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns Decrypted secret value and reveal timestamp
   */
  @Span()
  @ApiOperation({
    summary: 'Reveal the plaintext value of a detected secret',
    description:
      'Decrypts and returns the secret value associated with a secret vulnerability. ' +
      'The response is never cached (Cache-Control: no-store). ' +
      'Requires change_vulnerability_state permission on the project.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Decrypted secret value',
    schema: {
      example: {
        success: true,
        data: { secret: 'ghp_abc123...', revealedAt: '2026-04-09T12:00:00Z' },
        message: 'Secret revealed',
      },
    },
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('/project/:projectId/results/secret/:vulnerabilityId/reveal')
  async revealSecret(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<{
    success: boolean;
    data: RevealSecretResponse;
    message: string;
  }> {
    this.logger.log(
      `User ${req?.user?.sub} is revealing secret for vulnerability ${vulnerabilityId} in project ${projectId}`,
    );
    const result = await this.resultService.revealSecret({
      projectId,
      vulnerabilityId,
      userId: req.user?.sub,
    });
    return {
      success: true,
      data: { secret: result.secret, revealedAt: result.revealedAt },
      message: 'Secret revealed',
    };
  }

  /**
   * Mark a detected secret as rotated, resolving the vulnerability.
   *
   * @param req Request HTTP (user context)
   * @param projectId Project ID
   * @param vulnerabilityId Vulnerability ID
   * @returns New vulnerability state after rotation
   */
  @Span()
  @ApiOperation({
    summary: 'Mark a detected secret as rotated',
    description:
      'Marks the secret vulnerability as rotated, which resolves it. ' +
      'Requires change_vulnerability_state permission on the project.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'vulnerabilityId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Secret marked as rotated',
    schema: {
      example: {
        success: true,
        data: { state: 'resolved' },
        message: 'Secret marked as rotated',
      },
    },
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
  @UseGuards(PermissionsGuard)
  @SubjectType('project')
  @Permission('change_vulnerability_state')
  @HttpCode(200)
  @Post('/project/:projectId/results/secret/:vulnerabilityId/rotate')
  async rotateSecret(
    @Req() req,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Promise<{
    success: boolean;
    data: RotateSecretResponse;
    message: string;
  }> {
    this.logger.log(
      `User ${req?.user?.sub} is rotating secret for vulnerability ${vulnerabilityId} in project ${projectId}`,
    );
    const result = await this.resultService.rotateSecret({
      projectId,
      vulnerabilityId,
      userId: req.user?.sub,
    });
    return {
      success: true,
      data: { state: result.state },
      message: 'Secret marked as rotated',
    };
  }
}
