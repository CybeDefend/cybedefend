import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { SseHeadersInterceptor } from '../sse-headers.interceptor';

describe('SseHeadersInterceptor', () => {
  it('sets Cloudflare-safe SSE headers on the underlying Fastify reply', async () => {
    const headers: Record<string, string> = {};
    // Fastify reply has both res and res.raw; interceptor should set on raw if available
    const reply = {
      raw: {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        headersSent: false,
      },
    };
    const ctx = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('payload') };
    const i = new SseHeadersInterceptor();
    await lastValueFrom(i.intercept(ctx, handler));
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toMatch(/no-transform/);
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['Pragma']).toBe('no-cache');
    expect(headers['Expires']).toBe('0');
  });

  it('does not throw when headers are already sent', async () => {
    const reply = {
      raw: {
        setHeader: jest.fn(() => {
          throw new Error('cant set after send');
        }),
        headersSent: true,
      },
    };
    const ctx = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('x') };
    const i = new SseHeadersInterceptor();
    await expect(lastValueFrom(i.intercept(ctx, handler))).resolves.toBe('x');
  });

  it('falls back to res when res.raw is missing', async () => {
    const headers: Record<string, string> = {};
    const reply = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
    };
    const ctx = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('x') };
    const i = new SseHeadersInterceptor();
    await lastValueFrom(i.intercept(ctx, handler));
    expect(headers['Content-Type']).toBe('text/event-stream');
  });
});
