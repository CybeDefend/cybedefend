import {
  Controller,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Req,
  Sse,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { SseHeadersInterceptor } from 'src/core/interceptors/sse-headers.interceptor';
import { RealtimeStreamFactory } from './realtime-stream.factory';

// SSE streams — OpenAPI cannot meaningfully render streaming endpoints, so they
// are kept out of the public Swagger document. Routes stay live and guarded by
// CombinedAuthRateLimitGuard + per-stream Permify.
@ApiExcludeController()
@ApiTags('Realtime')
@Controller('v1/realtime/projects/:projectId')
@UseGuards(CombinedAuthRateLimitGuard)
export class ProjectsRealtimeController {
  constructor(private readonly factory: RealtimeStreamFactory) {}

  @ApiOperation({
    summary:
      'SSE stream of scan + vulnerability events for a project (issues page)',
  })
  @Sse('issues/stream')
  @SubjectType('project')
  @Permission('read_scan_result')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  issuesStream(
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:project:${projectId}:issues`],
      membershipScope: {
        scopeKey: `project:${projectId}`,
        userId: req.user.sub,
      },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({ summary: 'SSE stream of stats events for a project' })
  @Sse('stats/stream')
  @SubjectType('project')
  @Permission('read_scan_result')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  statsStream(
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:project:${projectId}:stats`],
      membershipScope: {
        scopeKey: `project:${projectId}`,
        userId: req.user.sub,
      },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({ summary: 'SSE stream of policy events for a project' })
  @Sse('policies/stream')
  @SubjectType('project')
  @Permission('read_scan_result')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  policiesStream(
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:project:${projectId}:policies`],
      membershipScope: {
        scopeKey: `project:${projectId}`,
        userId: req.user.sub,
      },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({
    summary: 'SSE stream of report-generation events for a project',
  })
  @Sse('reports/stream')
  @SubjectType('project')
  @Permission('read_scan_result')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  reportsStream(
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:project:${projectId}:reports`],
      membershipScope: {
        scopeKey: `project:${projectId}`,
        userId: req.user.sub,
      },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({
    summary:
      'SSE stream of update events for a single vulnerability (issue detail page)',
  })
  @Sse('issues/:vulnerabilityId/stream')
  @SubjectType('project')
  @Permission('read_scan_result')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  issueDetailStream(
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('vulnerabilityId', new ParseUUIDPipe()) vulnerabilityId: string,
  ): Observable<MessageEvent> {
    // The channel is built from the Permify-authorized :projectId, never from
    // the vulnerability id alone: an event for vulnerability V is
    // only ever published under V's real project, so a vulnerability id taken
    // from another project never matches a channel that receives events.
    return this.factory.createScopedStream({
      channels: [`cybe:event:project:${projectId}:vuln:${vulnerabilityId}`],
      membershipScope: {
        scopeKey: `project:${projectId}`,
        userId: req.user.sub,
      },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }
}
