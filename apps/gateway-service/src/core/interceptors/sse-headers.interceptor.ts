import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  Pragma: 'no-cache',
  Expires: '0',
};

@Injectable()
export class SseHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();
    const target = res?.raw ?? res;
    if (target && !target.headersSent) {
      try {
        for (const [k, v] of Object.entries(SSE_HEADERS))
          target.setHeader(k, v);
      } catch {
        // ignore: headers may already be locked or transport may not support setHeader
      }
    }
    return next.handle();
  }
}
