import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { BEARER_VERIFIER } from '../../../edition/ports/bearer-verifier.port';
import type {
  BearerRejection,
  BearerVerifier,
} from '../../../edition/ports/bearer-verifier.port';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global Bearer guard.
 *
 * - Routes or controllers annotated with `@Public()` bypass this guard.
 * - The bearer is checked by the edition's `BEARER_VERIFIER`: the Logto user
 *   JWT in the cloud, a personal access token's shape in community mode.
 * - On 401, emits the verifier's `WWW-Authenticate` challenge (the cloud's
 *   points MCP clients at the authorization server).
 * - On success, attaches `request.user = { userId, accessToken }`.
 *
 * Authorisation lives entirely downstream at Gateway, which point-checks
 * Permify on each REST endpoint.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: Logger,
    @Inject(BEARER_VERIFIER) private readonly verifier: BearerVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request?.headers?.authorization;

    const match = /^bearer\s+(.+)$/i.exec(authHeader ?? '');
    if (!match) {
      this.throw401(context, 'missing_bearer');
    }

    const token = match[1].trim();
    if (!token) {
      this.throw401(context, 'missing_bearer');
    }

    let verified: Awaited<ReturnType<BearerVerifier['verify']>>;
    try {
      verified = await this.verifier.verify(token);
    } catch (err) {
      const failure = err as { code?: unknown; name?: unknown } | undefined;
      const code = failure?.code || failure?.name || 'unknown';
      this.logger.warn(`JWT verification failed: ${String(code)}`);
      this.throw401(context, 'invalid_token');
    }
    if (!verified) {
      this.throw401(context, 'invalid_token');
    }
    request.user = verified;

    return true;
  }

  /**
   * Emits the verifier's challenge before raising a 401.
   *
   * `never` return lets the compiler treat any call as a terminator —
   * callers can rely on control flow not continuing past this point.
   */
  private throw401(context: ExecutionContext, reason: BearerRejection): never {
    const reply = context.switchToHttp().getResponse();
    // Funnel telemetry. `missing_bearer` is the normal first contact of every
    // OAuth handshake — logged at info so the connect funnel has its entry
    // point; `invalid_token` (expired, bad audience…) is the signal that a
    // client's refresh loop is broken, the exact dimension the August-2026
    // incident investigations were blind on. A verifier failure code is
    // logged by the caller. The token itself is never logged.
    const request = context.switchToHttp().getRequest();
    const line = `MCP 401 challenge reason=${reason} path=${JSON.stringify(
      (request?.url as string) ?? '(none)',
    )} ua=${JSON.stringify(
      (request?.headers?.['user-agent'] as string) ?? '(no-ua)',
    )}`;
    if (reason === 'missing_bearer') {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
    reply.header('WWW-Authenticate', this.verifier.challenge(reason));
    throw new UnauthorizedException({ error: 'unauthorized', reason });
  }
}
