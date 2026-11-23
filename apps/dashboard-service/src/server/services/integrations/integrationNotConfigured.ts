/**
 * An integration (GitHub App, GitLab, Jira, Linear) is optional on a
 * self-hosted instance. Without its credentials, the connect routes answer a
 * 4xx whose `message` (or `code`) is one of these codes. The dashboard reads
 * it as a fixed translated sentence pointing to the setup guide, never as the
 * generic connection failure.
 */
export const INTEGRATION_NOT_CONFIGURED_CODES = {
  GITHUB_APP_NOT_CONFIGURED: 'github',
  GITLAB_NOT_CONFIGURED: 'gitlab',
  JIRA_NOT_CONFIGURED: 'jira',
  LINEAR_NOT_CONFIGURED: 'linear',
} as const;

export type UnconfiguredIntegration =
  (typeof INTEGRATION_NOT_CONFIGURED_CODES)[keyof typeof INTEGRATION_NOT_CONFIGURED_CODES];

const providerOfCode = (value: unknown): UnconfiguredIntegration | null =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTEGRATION_NOT_CONFIGURED_CODES, value)
    ? INTEGRATION_NOT_CONFIGURED_CODES[value as keyof typeof INTEGRATION_NOT_CONFIGURED_CODES]
    : null;

/**
 * The integration an HTTP error says is not configured on this instance: a
 * 4xx whose `code`, or whose `message` (a string or a one-entry list), is
 * exactly one of the codes. Anything else is null and keeps the caller's
 * usual handling.
 */
export function integrationNotConfiguredOf(error: unknown): UnconfiguredIntegration | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null | undefined)?.response;
  if (!response || typeof response.status !== 'number' || response.status < 400 || response.status >= 500) {
    return null;
  }
  const data = response.data as { code?: unknown; message?: unknown } | null | undefined;
  const message = Array.isArray(data?.message) && data.message.length === 1 ? data.message[0] : data?.message;
  return providerOfCode(data?.code) ?? providerOfCode(message);
}

/** The translation key of the sentence shown for an integration not configured on this instance. */
export const integrationNotConfiguredKey = (provider: UnconfiguredIntegration): string =>
  `components.integrationNotConfigured.${provider}`;
