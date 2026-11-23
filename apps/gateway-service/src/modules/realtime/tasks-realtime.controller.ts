import {
  Controller,
  MessageEvent,
  Param,
  Req,
  Sse,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { SseHeadersInterceptor } from 'src/core/interceptors/sse-headers.interceptor';
import { RealtimeStreamFactory } from './realtime-stream.factory';
import { AsyncTaskOwnerGuard } from './async-task-owner.guard';

// SSE stream for per-task async operation tracking. Excluded from Swagger because
// streaming endpoints cannot be meaningfully rendered by OpenAPI.
@ApiExcludeController()
@ApiTags('Realtime')
@Controller('v1/realtime/tasks/:taskId')
@UseGuards(CombinedAuthRateLimitGuard)
export class TasksRealtimeController {
  constructor(private readonly factory: RealtimeStreamFactory) {}

  @Sse('stream')
  @UseGuards(AsyncTaskOwnerGuard)
  @UseInterceptors(SseHeadersInterceptor)
  stream(
    @Req() req: any,
    @Param('taskId') taskId: string,
  ): Observable<MessageEvent> {
    return this.factory.createScopedStream({
      channels: [`cybe:event:job:${taskId}`],
      request: req,
      lastEventId: req.headers['last-event-id'] ?? null,
    });
  }
}
