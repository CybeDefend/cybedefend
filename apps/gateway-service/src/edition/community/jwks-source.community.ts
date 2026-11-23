import {
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { Logger } from 'nestjs-pino';
import { firstValueFrom, timeout } from 'rxjs';
import {
  LOCAL_AUTH_SERVICE_NAME,
  type LocalAuthServiceClient,
} from '@grpc/global-management/local_auth';
import type {
  AuthenticatedUser,
  JwksSource,
  JwtExpectations,
} from '../ports/jwks-source.port';

/** The community access token's `iss` claim. */
export const COMMUNITY_ISSUER = 'cybedefend-community';
/** The community access token's `aud` claim. */
export const COMMUNITY_AUDIENCE = 'cybedefend-api';
/** How long a fetched JWK set is trusted before it is fetched again. */
export const COMMUNITY_JWKS_TTL_MS = 600_000;
/** At most one forced refresh (unknown `kid`) per this interval. */
export const COMMUNITY_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS = 30_000;
/** Deadline of one GetJwks / VerifyPersonalAccessToken call. */
export const LOCAL_AUTH_CALL_DEADLINE_MS = 2_000;

type KeySet = ReturnType<typeof createLocalJWKSet>;

/**
 * gRPC statuses that mean « this personal access token is not valid »: the
 * gateway answers 401. Everything else (UNAVAILABLE, a deadline, …) is a
 * 503 `auth_unavailable`.
 */
const PAT_REJECTED_STATUSES: ReadonlySet<number> = new Set([
  GrpcStatus.UNAUTHENTICATED,
  GrpcStatus.NOT_FOUND,
  GrpcStatus.INVALID_ARGUMENT,
]);

const grpcCodeOf = (error: unknown): number | undefined => {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
};

/**
 * Community `JWKS_SOURCE`. The ES256 keys that verify access tokens
 * are published by global-management's `LocalAuthService.GetJwks`
 * and cached 10 minutes; a token whose `kid` is missing forces one refresh,
 * at most one per 30 s, shared by every request waiting on it. A `cdp_`
 * bearer is a personal access token: it costs exactly one
 * `VerifyPersonalAccessToken` call per request, never cached, and
 * the token itself is never logged.
 */
@Injectable()
export class LocalJwksSource implements JwksSource, OnModuleInit {
  private localAuth: LocalAuthServiceClient | null = null;
  private keySet: KeySet | null = null;
  private fetchedAt = 0;
  private refreshPromise: Promise<void> | null = null;
  private lastForcedRefreshAt = 0;
  private initPromise: Promise<void> | null = null;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /**
   * Warm-up, memoised: several AuthGuard instances call it. Never throws:
   * a gateway that boots while global-management is down serves the first
   * request with a cold cache, which fetches the keys on demand.
   */
  init(): Promise<void> {
    this.initPromise ??= this.warmUp();
    return this.initPromise;
  }

  private async warmUp(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      const code = grpcCodeOf(error);
      this.logger.error(
        `LocalJwksSource: GetJwks failed at boot (gRPC code ${
          code ?? 'unknown'
        }); the key set is fetched again on the first request`,
        { topic: 'logs-intern' },
      );
    }
  }

  expectations(): JwtExpectations {
    return {
      issuer: COMMUNITY_ISSUER,
      audience: COMMUNITY_AUDIENCE,
      // The local signing keys are ES256: pin it.
      algorithms: ['ES256'],
    };
  }

  keyResolver(): JWTVerifyGetKey {
    return async (header, token) => {
      if (this.isStale()) {
        await this.refresh();
      }
      try {
        return await this.local()(header, token);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        // jose codes an unknown kid ERR_JWKS_NO_MATCHING_KEY and every jose
        // error carries a code. A codeless rejection therefore means the
        // transpiled jose of the Jest transform (whose error classes cannot
        // be constructed) answered for this kid: same case, no key matched.
        if (typeof code === 'string' && code !== 'ERR_JWKS_NO_MATCHING_KEY') {
          throw error;
        }
        // Unknown kid: maybe the key was rotated in. One forced refresh,
        // throttled and shared, then look up again in the fresh set.
        await this.forcedRefresh();
        return this.local()(header, token);
      }
    };
  }

  async verifyPersonalAccessToken(
    token: string,
  ): Promise<AuthenticatedUser | null> {
    if (!token.startsWith('cdp_')) {
      // Not a personal access token: the bearer goes to JWT verification.
      return null;
    }
    try {
      const response = await firstValueFrom(
        this.localAuthClient()
          .verifyPersonalAccessToken({ token })
          .pipe(timeout(LOCAL_AUTH_CALL_DEADLINE_MS)),
      );
      // `tokenId` is the metadata's id, of no use to the guard. The token
      // itself is never logged.
      return {
        sub: response.userId,
        email: response.email,
        name: response.name,
      };
    } catch (error) {
      const code = grpcCodeOf(error);
      if (code !== undefined && PAT_REJECTED_STATUSES.has(code)) {
        throw new UnauthorizedException('Invalid token');
      }
      throw new ServiceUnavailableException('auth_unavailable');
    }
  }

  private localAuthClient(): LocalAuthServiceClient {
    if (!this.localAuth) {
      this.localAuth = this.client.getService<LocalAuthServiceClient>(
        LOCAL_AUTH_SERVICE_NAME,
      );
    }
    return this.localAuth;
  }

  private local(): KeySet {
    if (!this.keySet) {
      throw new Error('LocalJwksSource: the key set has not been fetched yet');
    }
    return this.keySet;
  }

  private isStale(): boolean {
    return Date.now() - this.fetchedAt >= COMMUNITY_JWKS_TTL_MS;
  }

  /** One shared promise per in-flight fetch, whoever asked for it. */
  private refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.fetchAndInstall().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /**
   * The refresh an unknown `kid` forces: shared with any refresh already in
   * flight, and at most one per COMMUNITY_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS.
   * When throttled it resolves without fetching, so the caller's second
   * lookup fails against the old set.
   */
  private forcedRefresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const now = Date.now();
    if (
      now - this.lastForcedRefreshAt <
      COMMUNITY_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS
    ) {
      return Promise.resolve();
    }
    this.lastForcedRefreshAt = now;
    return this.refresh();
  }

  private async fetchAndInstall(): Promise<void> {
    const response = await firstValueFrom(
      this.localAuthClient()
        .getJwks({})
        .pipe(timeout(LOCAL_AUTH_CALL_DEADLINE_MS)),
    );
    this.keySet = createLocalJWKSet({ keys: response.keys ?? [] });
    this.fetchedAt = Date.now();
  }
}
