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
@Controller('v1/realtime/orgs/:organizationId')
@UseGuards(CombinedAuthRateLimitGuard)
export class OrgsRealtimeController {
  constructor(private readonly factory: RealtimeStreamFactory) {}

  @ApiOperation({
    summary: 'SSE stream of project-list events for an organization',
  })
  @Sse('projects/stream')
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  projectsStream(
    @Req() req: any,
    @Param('organizationId', new ParseUUIDPipe()) orgId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:org:${orgId}:projects`],
      membershipScope: { scopeKey: `org:${orgId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({
    summary: 'SSE stream of overview events for an organization',
  })
  @Sse('overview/stream')
  @SubjectType('organization')
  @Permission('read_appsec')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  overviewStream(
    @Req() req: any,
    @Param('organizationId', new ParseUUIDPipe()) orgId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:org:${orgId}:overview`],
      membershipScope: { scopeKey: `org:${orgId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({ summary: 'SSE stream of member events for an organization' })
  @Sse('members/stream')
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  membersStream(
    @Req() req: any,
    @Param('organizationId', new ParseUUIDPipe()) orgId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:org:${orgId}:members`],
      membershipScope: { scopeKey: `org:${orgId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({
    summary:
      'SSE stream of aggregated report-generation events for an organization',
  })
  @Sse('reports/stream')
  @SubjectType('organization')
  // 'read_report' (not 'read' like the sibling streams) to match the
  // aggregated report poll permission: only users who can read the
  // organisation's AppSec reports (org admins/creators, AppSec active)
  // subscribe to their completion events.
  @Permission('read_report')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  reportsStream(
    @Req() req: any,
    @Param('organizationId', new ParseUUIDPipe()) orgId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:org:${orgId}:reports`],
      membershipScope: { scopeKey: `org:${orgId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }
}
