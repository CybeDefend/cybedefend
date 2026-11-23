import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AuthGuard } from './auth.guard';
import type {
  BearerRejection,
  BearerVerifier,
  VerifiedBearer,
} from '../../../edition/ports/bearer-verifier.port';

/**
 * The core AuthGuard: parsing, @Public(), the 401 line and the exception are
 * its own; the WWW-Authenticate value and request.user come from the
 * edition's BEARER_VERIFIER, faked here.
 */

const TOKEN = 'cdp_' + 'S3cr3tT0k3n-_'.repeat(3) + 'abcd';

const makeCtx = (
  headers: Record<string, string> = {},
): { ctx: ExecutionContext; request: any; reply: { header: jest.Mock } } => {
  const request: any = { headers, url: '/mcp' };
  const reply = { header: jest.fn() };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, request, reply };
};

class FakeVerifier implements BearerVerifier {
  verify = jest.fn<Promise<VerifiedBearer | null>, [string]>();
  challenge = jest.fn((reason: BearerRejection) =>
    reason === 'missing_bearer' ? 'Bearer' : 'Bearer error="invalid_token"',
  );
}

const build = (opts?: { isPublic?: boolean }) => {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue(opts?.isPublic ?? false);
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const verifier = new FakeVerifier();
  const guard = new AuthGuard(reflector, logger, verifier);
  return { guard, logger, verifier };
};

const loggedText = (logger: Logger): string =>
  (['log', 'warn', 'error'] as const)
    .flatMap((level) => (logger[level] as jest.Mock).mock.calls)
    .map((args) => args.map((a: unknown) => String(a)).join(' '))
    .join('\n');

describe('AuthGuard (core, delegating to BEARER_VERIFIER)', () => {
  it('sets request.user from the verifier', async () => {
    const { guard, verifier } = build();
    verifier.verify.mockResolvedValueOnce({
      userId: 'pat:0123',
      accessToken: TOKEN,
    });
    const { ctx, request } = makeCtx({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith(TOKEN);
    expect(request.user).toEqual({ userId: 'pat:0123', accessToken: TOKEN });
  });

  it('parses the scheme case-insensitively and trims the token', async () => {
    const { guard, verifier } = build();
    verifier.verify.mockResolvedValueOnce({ userId: 'u', accessToken: TOKEN });
    const { ctx } = makeCtx({ authorization: `bEaReR   ${TOKEN}  ` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith(TOKEN);
  });

  it("answers 401 with the verifier's challenge when the bearer is missing", async () => {
    const { guard, verifier, logger } = build();
    const { ctx, reply } = makeCtx({});
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: 'unauthorized', reason: 'missing_bearer' },
    });
    expect(verifier.challenge).toHaveBeenCalledWith('missing_bearer');
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/^MCP 401 challenge reason=missing_bearer path=/),
    );
  });

  it('answers 401 missing_bearer for a non-bearer scheme', async () => {
    const { guard, verifier } = build();
    const { ctx, reply } = makeCtx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('answers 401 invalid_token when the verifier returns null', async () => {
    const { guard, verifier, logger } = build();
    verifier.verify.mockResolvedValueOnce(null);
    const { ctx, request, reply } = makeCtx({
      authorization: 'Bearer eyJ.a.b',
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: 'unauthorized', reason: 'invalid_token' },
    });
    expect(reply.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="invalid_token"',
    );
    expect(request.user).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^MCP 401 challenge reason=invalid_token path=/),
    );
  });

  it('answers 401 invalid_token and logs the code when the verifier throws', async () => {
    const { guard, verifier, logger } = build();
    verifier.verify.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'ERR_JWT_EXPIRED' }),
    );
    const { ctx, reply } = makeCtx({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { reason: 'invalid_token' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'JWT verification failed: ERR_JWT_EXPIRED',
    );
    expect(reply.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="invalid_token"',
    );
  });

  it('never logs the token', async () => {
    const { guard, verifier, logger } = build();
    verifier.verify.mockResolvedValueOnce(null);
    await expect(
      guard.canActivate(makeCtx({ authorization: `Bearer ${TOKEN}` }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    verifier.verify.mockRejectedValueOnce(new Error(`bad ${TOKEN}`));
    await expect(
      guard.canActivate(makeCtx({ authorization: `Bearer ${TOKEN}` }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    verifier.verify.mockResolvedValueOnce({ userId: 'u', accessToken: TOKEN });
    await guard.canActivate(makeCtx({ authorization: `Bearer ${TOKEN}` }).ctx);

    const text = loggedText(logger);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(TOKEN.slice(4));
  });

  it('lets @Public routes through without calling the verifier', async () => {
    const { guard, verifier } = build({ isPublic: true });
    const { ctx } = makeCtx({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(verifier.challenge).not.toHaveBeenCalled();
  });
});
