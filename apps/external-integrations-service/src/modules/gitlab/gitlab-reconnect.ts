import { IsNull, Repository } from 'typeorm';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';

/** The logger methods used here; both GitLab services' loggers have them. */
interface ReconnectLogger {
  warn(message: string): void;
  error(message: string): void;
}

/**
 * True when GitLab's token endpoint refused a refresh token as revoked or
 * expired: HTTP 400 or 401 with the OAuth error `invalid_grant` (RFC 6749
 * §5.2), which is what GitLab answers once the application is revoked under
 * User Settings → Applications. Anything else (`invalid_client`, which is our
 * own credentials, 429, 5xx, a network error) says nothing about the
 * organization's connection.
 *
 * Read structurally rather than through `axios.isAxiosError`: axios is
 * auto-mocked in the GitLab specs, and `HttpService` errors carry the same
 * `response` shape.
 */
export function isRevokedGrant(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const response = (
    error as { response?: { status?: unknown; data?: unknown } }
  ).response;
  if (!response || (response.status !== 400 && response.status !== 401)) {
    return false;
  }
  const data = response.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { error?: unknown }).error === 'invalid_grant'
  );
}

/**
 * Marks the connection as needing a reconnection, in ONE conditional UPDATE:
 * only while the stored refresh token is still the one GitLab refused, and
 * only while the connection is not marked yet. GitLab refresh tokens are
 * single-use and GitlabIssueService refreshes without the Redis lock
 * GitlabService takes, so a refresh can be refused because another process
 * has just rotated the token; the row then holds a new token, the UPDATE
 * matches nothing, and the healthy connection stays unmarked. On a broken
 * connection every GitLab call refreshes again and is refused again: only
 * the first refusal (healthy → broken) writes its timestamp and logs
 * `GITLAB_RECONNECT_REQUIRED`. When the UPDATE matches nothing (already
 * marked, token replaced meanwhile, or row gone), nothing is logged.
 *
 * Never throws: a failed write is logged and the caller's error stands.
 */
export async function flagReconnectRequired(
  repository: Repository<GitlabIntegration>,
  logger: ReconnectLogger,
  integration: Pick<GitlabIntegration, 'id' | 'organizationId'>,
  sentRefreshToken: string,
): Promise<void> {
  try {
    const result = await repository.update(
      {
        id: integration.id,
        refreshToken: sentRefreshToken,
        reconnectRequiredAt: IsNull(),
      },
      { reconnectRequiredAt: new Date() },
    );
    if ((result?.affected ?? 0) > 0) {
      logger.warn(
        `GITLAB_RECONNECT_REQUIRED org=${integration.organizationId} integration=${integration.id}`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Could not mark GitLab integration ${integration.id} as needing a reconnection: ${message}`,
    );
  }
}
