import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import SecretsService from '../../core/secrets/secrets.service';
import { linearRefusal } from './linear-refusals';

const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

const REQUEST_TIMEOUT_MS = 15_000;
const GRAPHQL_RETRY_DELAY_MS = 500;
const MAX_LOGGED_DETAIL_LENGTH = 200;

export interface LinearTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}

export type LinearApiErrorKind =
  | 'unauthorized'
  | 'invalid_grant'
  | 'rate_limited'
  | 'not_found'
  | 'invalid'
  | 'unavailable';

/**
 * What went wrong talking to Linear, as a closed kind the callers can branch on.
 * Its message is for logs: it never holds a token, but it is not for end users.
 */
export class LinearApiError extends Error {
  constructor(
    readonly kind: LinearApiErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LinearApiError';
  }
}

// A rejected token or grant (`unauthorized`, `invalid_grant`) is not in these
// tables: it is the LINEAR_NEEDS_RECONNECT refusal, see `toRpcException`.
type PlainKind = Exclude<LinearApiErrorKind, 'unauthorized' | 'invalid_grant'>;

const GRPC_CODE_BY_KIND: Record<PlainKind, status> = {
  rate_limited: status.RESOURCE_EXHAUSTED,
  not_found: status.NOT_FOUND,
  invalid: status.INVALID_ARGUMENT,
  unavailable: status.UNAVAILABLE,
};

// Fixed texts: what Linear answered never reaches a gRPC caller.
const RPC_MESSAGE_BY_KIND: Record<PlainKind, string> = {
  rate_limited: 'Linear rate limit reached',
  not_found: 'Linear entity not found',
  invalid: 'Linear rejected the request',
  unavailable: 'Linear is unavailable',
};

type Operation = 'token' | 'revoke' | 'graphql';

interface LinearAnswer {
  ok: boolean;
  httpStatus: number;
  body: unknown;
}

interface GraphqlError {
  message?: unknown;
  extensions?: { code?: unknown; type?: unknown };
}

@Injectable()
export class LinearApiClient {
  constructor(
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  // ========== OAuth ==========

  /**
   * Trades the authorization code for tokens. Never retried: a code is single-use.
   */
  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<LinearTokenSet> {
    const { clientId, clientSecret } = await this.getClientCredentials();
    return this.requestTokens(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      },
      [code, clientSecret],
    );
  }

  /**
   * Trades a refresh token for a new token set. Never retried: Linear replaces
   * the refresh token on success, so a consumed one can only be replayed once.
   */
  async refresh(refreshToken: string): Promise<LinearTokenSet> {
    const { clientId, clientSecret } = await this.getClientCredentials();
    return this.requestTokens(
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      [refreshToken, clientSecret],
    );
  }

  /**
   * Revokes an access or a refresh token. Throws a LinearApiError on any
   * refusal (a 400 means it could not be revoked, e.g. already revoked): a
   * caller that disconnects decides whether that matters.
   */
  async revoke(token: string): Promise<void> {
    const answer = await this.send(
      'revoke',
      LINEAR_REVOKE_URL,
      this.formRequest({ token }),
      [token],
    );
    if (!answer.ok) {
      throw this.fail(
        this.kindForStatus(answer.httpStatus),
        'revoke',
        answer.httpStatus,
        this.oauthErrorDetail(answer.body),
        [token],
      );
    }
  }

  // ========== GraphQL ==========

  /**
   * One GraphQL call. By default it is retried once on a 5xx; a network failure
   * is never retried (the request may have reached Linear).
   *
   * A 5xx does not say the request was not applied: retrying a mutation that is
   * not idempotent (`issueCreate`) can apply it twice. Such callers must pass
   * `{ retryOnServerError: false }`, so a 5xx fails at once.
   *
   * Any GraphQL error fails the call, partial data included.
   */
  async graphql<T>(
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
    options?: { retryOnServerError?: boolean },
  ): Promise<T> {
    const request: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    };
    const secrets = [accessToken];

    let answer = await this.send(
      'graphql',
      LINEAR_GRAPHQL_URL,
      request,
      secrets,
    );
    if (answer.httpStatus >= 500 && options?.retryOnServerError !== false) {
      this.logger.warn(
        { operation: 'graphql', httpStatus: answer.httpStatus },
        'Linear API returned a server error, retrying once',
      );
      await new Promise((resolve) =>
        setTimeout(resolve, GRAPHQL_RETRY_DELAY_MS),
      );
      answer = await this.send('graphql', LINEAR_GRAPHQL_URL, request, secrets);
    }

    const errors = this.graphqlErrors(answer.body);
    if (errors.length > 0 || !answer.ok) {
      throw this.fail(
        this.graphqlErrorKind(answer.httpStatus, errors),
        'graphql',
        answer.httpStatus,
        this.graphqlErrorDetail(errors),
        secrets,
      );
    }

    const data = (answer.body as { data?: T } | undefined)?.data;
    if (data === undefined || data === null) {
      throw this.fail(
        'unavailable',
        'graphql',
        answer.httpStatus,
        'answer carries no data',
        secrets,
      );
    }
    return data;
  }

  // ========== Errors ==========

  /**
   * Turns whatever a Linear call threw into the RpcException a gRPC caller gets.
   * An RpcException (a refusal) goes through unchanged; anything unknown is an
   * INTERNAL error with no text from the cause.
   *
   * A token or grant Linear rejects is the LINEAR_NEEDS_RECONNECT refusal
   * (FAILED_PRECONDITION), never UNAUTHENTICATED: the gateway answers that with
   * a 401, which the dashboard may take for an expired CybeDefend session.
   */
  toRpcException(err: unknown): RpcException {
    if (err instanceof RpcException) return err;
    if (err instanceof LinearApiError) {
      if (err.kind === 'unauthorized' || err.kind === 'invalid_grant') {
        return linearRefusal(
          'LINEAR_NEEDS_RECONNECT',
          status.FAILED_PRECONDITION,
        );
      }
      return new RpcException({
        code: GRPC_CODE_BY_KIND[err.kind],
        message: RPC_MESSAGE_BY_KIND[err.kind],
      });
    }
    this.logger.error(
      { errorName: err instanceof Error ? err.name : typeof err },
      'Unexpected error in the Linear integration',
    );
    return new RpcException({
      code: status.INTERNAL,
      message: 'Linear request failed',
    });
  }

  // ========== Internals ==========

  private async getSecretOrEnv(key: string): Promise<string | undefined> {
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      const envValue = this.configService.get<string>(key);
      if (envValue) return envValue;
    }
    await this.secretsService.ensureCacheLoaded();
    return this.secretsService.getSecret(key);
  }

  private async getClientCredentials(): Promise<{
    clientId: string;
    clientSecret: string;
  }> {
    const clientId = await this.getSecretOrEnv('LINEAR_CLIENT_ID');
    const clientSecret = await this.getSecretOrEnv('LINEAR_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('Linear client credentials are not configured');
    }
    return { clientId, clientSecret };
  }

  private formRequest(fields: Record<string, string>): RequestInit {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(fields).toString(),
    };
  }

  private async requestTokens(
    fields: Record<string, string>,
    secrets: string[],
  ): Promise<LinearTokenSet> {
    const answer = await this.send(
      'token',
      LINEAR_TOKEN_URL,
      this.formRequest(fields),
      secrets,
    );
    if (!answer.ok) {
      const oauthError = (answer.body as { error?: unknown } | undefined)
        ?.error;
      throw this.fail(
        oauthError === 'invalid_grant'
          ? 'invalid_grant'
          : this.kindForStatus(answer.httpStatus),
        'token',
        answer.httpStatus,
        this.oauthErrorDetail(answer.body),
        secrets,
      );
    }

    const body = answer.body as
      | {
          access_token?: unknown;
          refresh_token?: unknown;
          expires_in?: unknown;
        }
      | undefined;
    if (
      typeof body?.access_token !== 'string' ||
      !body.access_token ||
      typeof body.expires_in !== 'number' ||
      !Number.isFinite(body.expires_in)
    ) {
      throw this.fail(
        'unavailable',
        'token',
        answer.httpStatus,
        'malformed token response',
        secrets,
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : null,
      expiresInSeconds: body.expires_in,
    };
  }

  /**
   * One HTTP call. A failure to get an answer at all is an `unavailable`
   * LinearApiError; any answer, whatever its status, is returned for the caller
   * to classify. The body is undefined when it is not JSON.
   */
  private async send(
    operation: Operation,
    url: string,
    init: RequestInit,
    secrets: string[],
  ): Promise<LinearAnswer> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw this.fail(
        'unavailable',
        operation,
        undefined,
        `no answer: ${err instanceof Error ? err.message : 'request failed'}`,
        secrets,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, httpStatus: response.status, body };
  }

  private kindForStatus(httpStatus: number): LinearApiErrorKind {
    if (httpStatus === 401) return 'unauthorized';
    if (httpStatus === 429) return 'rate_limited';
    if (httpStatus >= 500) return 'unavailable';
    return 'invalid';
  }

  private graphqlErrors(body: unknown): GraphqlError[] {
    const errors = (body as { errors?: unknown } | undefined)?.errors;
    return Array.isArray(errors) ? (errors as GraphqlError[]) : [];
  }

  private graphqlErrorKind(
    httpStatus: number,
    errors: GraphqlError[],
  ): LinearApiErrorKind {
    const codes = errors.map((e) => e?.extensions?.code);
    if (httpStatus === 429 || codes.includes('RATELIMITED')) {
      return 'rate_limited';
    }
    if (httpStatus === 401 || codes.includes('AUTHENTICATION_ERROR')) {
      return 'unauthorized';
    }
    if (httpStatus >= 500) return 'unavailable';
    if (
      errors.some(
        (e) =>
          typeof e?.message === 'string' && /entity not found/i.test(e.message),
      )
    ) {
      return 'not_found';
    }
    return 'invalid';
  }

  private graphqlErrorDetail(errors: GraphqlError[]): string {
    const first = errors[0];
    if (!first) return 'HTTP error without a GraphQL error';
    const code =
      typeof first.extensions?.code === 'string' ? first.extensions.code : '';
    const message = typeof first.message === 'string' ? first.message : '';
    return [code, message].filter(Boolean).join(': ') || 'GraphQL error';
  }

  private oauthErrorDetail(body: unknown): string {
    const { error, error_description } = (body ?? {}) as {
      error?: unknown;
      error_description?: unknown;
    };
    return (
      [error, error_description]
        .filter((part): part is string => typeof part === 'string')
        .join(': ') || 'no error in the answer'
    );
  }

  /**
   * Logs a failed call and returns the error to throw. What Linear (or the
   * network) says can echo a credential back, so every secret of the call is
   * redacted from the text before it is logged or kept in the error.
   */
  private fail(
    kind: LinearApiErrorKind,
    operation: Operation,
    httpStatus: number | undefined,
    detail: string,
    secrets: string[],
  ): LinearApiError {
    const safeDetail = this.redact(detail, secrets).slice(
      0,
      MAX_LOGGED_DETAIL_LENGTH,
    );
    const metadata = { operation, kind, httpStatus, detail: safeDetail };
    if (kind === 'unavailable') {
      this.logger.error(metadata, 'Linear API call failed');
    } else {
      this.logger.warn(metadata, 'Linear API call failed');
    }
    return new LinearApiError(
      kind,
      `Linear ${operation} failed (${kind}${httpStatus ? `, HTTP ${httpStatus}` : ''}): ${safeDetail}`,
      httpStatus,
    );
  }

  private redact(text: string, secrets: string[]): string {
    let safe = text;
    for (const secret of secrets) {
      if (secret) safe = safe.split(secret).join('[redacted]');
    }
    return safe;
  }
}
