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
@Controller('v1/realtime/teams/:teamId')
@UseGuards(CombinedAuthRateLimitGuard)
export class TeamsRealtimeController {
  constructor(private readonly factory: RealtimeStreamFactory) {}

  @ApiOperation({ summary: 'SSE stream of events for a team' })
  @Sse('stream')
  @SubjectType('team')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  teamStream(
    @Req() req: any,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:team:${teamId}`],
      membershipScope: { scopeKey: `team:${teamId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }

  @ApiOperation({
    summary: 'SSE stream of aggregated report-generation events for a team',
  })
  @Sse('reports/stream')
  @SubjectType('team')
  // 'read_report' (not 'read') to match the aggregated report poll
  // permission: only users who can read the team's AppSec reports subscribe
  // to their events.
  @Permission('read_report')
  @UseGuards(PermissionsGuard)
  @UseInterceptors(SseHeadersInterceptor)
  reportsStream(
    @Req() req: any,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:team:${teamId}:reports`],
      membershipScope: { scopeKey: `team:${teamId}`, userId: req.user.sub },
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }
}
