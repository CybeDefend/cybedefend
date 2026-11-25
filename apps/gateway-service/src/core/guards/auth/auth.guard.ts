import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { trace } from '@opentelemetry/api';
import { jwtVerify, type JWTPayload } from 'jose';
import {
  JWKS_SOURCE,
  type JwksSource,
  type RequestUser,
} from 'src/edition/ports/jwks-source.port';

/**
 * Why a request was refused, set as `auth.rejection_reason` on the
 * AuthGuard.canActivate span. A bare `UnauthorizedException()` reads
 * 'Unauthorized' for an absent header (crawlers) and for a token sent in the
 * wrong form alike, so monitoring filters on this instead.
 */
export type AuthRejectionReason =
  | 'missing_header'
  | 'unsupported_scheme'
  | 'expired'
  | 'invalid'
  | 'jwks_unavailable'
  | 'missing_cybeid';

/**
 * jose's codes for a key set it could not read: a timeout, an answer other
 * than 200 or not JSON (JOSEError), a malformed set. An error that is not
 * jose's at all is the fetch itself failing ("fetch failed"). The token was
 * then never judged, so it is not counted as `invalid`.
 */
const JWKS_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JOSE_GENERIC',
  'ERR_JWKS_INVALID',
]);

const keySetUnavailable = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_J')
    ? JWKS_UNAVAILABLE_CODES.has(code)
    : true;
};

const markRejection = (reason: AuthRejectionReason): void => {
  trace.getActiveSpan()?.setAttribute('auth.rejection_reason', reason);
};

const stringClaim = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Verifies the bearer through the edition's `JWKS_SOURCE`: the
 * cloud source is Logto's OIDC set, the Community Edition's is the local
 * signing key from global-management's `GetJwks`. A `cdp_`
 * bearer is a personal access token: when the source verifies it, it is the
 * user (`via: 'pat'`); otherwise it goes to JWT verification, where the
 * cloud refuses it.
 *
 * The guard is listed in the `providers` of ~49 modules, so Nest builds one
 * instance per module; the source is a singleton and its `init()` is
 * memoised, so the warm-up runs once per process.
 */
@Injectable()
export class AuthGuard implements CanActivate, OnModuleInit {
  constructor(
    @Inject(JWKS_SOURCE) private readonly jwks: JwksSource,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jwks.init();
  }

  @Span()
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as Request & {
      user?: RequestUser & {
        /** The JWT's expiry, in seconds since the epoch; absent for a PAT. */
        exp?: number;
      };
    };

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      // An empty header carries no credential either: it counts as absent.
      markRejection(
        request.headers.authorization ? 'unsupported_scheme' : 'missing_header',
      );
      throw new UnauthorizedException();
    }

    if (token.startsWith('cdp_')) {
      const patUser = await this.jwks.verifyPersonalAccessToken(token);
      if (patUser) {
        request.user = {
          sub: patUser.sub,
          email: patUser.email,
          name: patUser.name,
          picture: patUser.picture,
          via: 'pat',
        };
        return true;
      }
      // null: this edition has no personal access tokens of its own; the
      // token falls through to JWT verification below.
    }

    try {
      const payload = await this.verifyJwt(token);
      // The internal CybeDefend UUID (cybeid) MUST be present on every JWT.
      // There is intentionally NO fallback to the identity provider's sub: a
      // token without it would otherwise propagate `userId: undefined` to
      // downstream controllers and run with no identity. Reject the token
      // outright instead.
      const cybeidClaim = payload.cybeid;
      if (typeof cybeidClaim !== 'string' || cybeidClaim.length === 0) {
        this.logger.warn(
          `JWT rejected: missing or invalid cybeid claim (sub=${payload.sub ?? 'unknown'})`,
          { topic: 'logs-intern' },
        );
        markRejection('missing_cybeid');
        throw new UnauthorizedException('Invalid token: missing cybeid claim');
      }
      const userId = cybeidClaim;
      request.user = {
        sub: userId,
        email: stringClaim(payload.email),
        name: stringClaim(payload.name),
        picture: stringClaim(payload.picture),
        via: 'jwt',
        // An event stream opened with this token closes when it expires
        // (realtime-stream.factory.ts). jose has checked it is in the future.
        ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const code = (error as { code?: unknown }).code;
      const name = (error as { name?: unknown }).name;
      const errorName =
        typeof code === 'string' ? code : typeof name === 'string' ? name : '';
      if (
        errorName === 'ERR_JWT_EXPIRED' ||
        errorName === 'TokenExpiredError'
      ) {
        this.logger.warn('Token expired', {
          topic: 'logs-intern',
        });
        markRejection('expired');
        throw new UnauthorizedException('Token expired');
      }
      this.logger.warn(`JWT verification failed: ${errorName}`, {
        topic: 'logs-intern',
      });
      markRejection(keySetUnavailable(error) ? 'jwks_unavailable' : 'invalid');
      throw new UnauthorizedException('Invalid token');
    }
    return true;
  }

  /**
   * Verify a JWT against the edition's key set and issuer/audience
   * expectations.
   */
  @Span()
  private async verifyJwt(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(
      token,
      this.jwks.keyResolver(),
      this.jwks.expectations(),
    );
    return payload;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
