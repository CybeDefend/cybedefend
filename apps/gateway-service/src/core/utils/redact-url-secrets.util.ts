/**
 * Routes whose path carries a secret. Jira's dynamic webhooks cannot send a
 * custom header, so POST /webhooks/jira/:token is authenticated by the last path
 * segment (external-integrations registers `${GATEWAY_URL}/webhooks/jira/<secret>`
 * with Jira). The Community Edition's POST /auth/invitations/:token/accept
 * carries the invitation token the same way.
 *
 * Everything after the prefix is masked up to the query string, extra segments
 * included: `/webhooks/jira/<secret>/x` does not match the route, and the 404 it
 * gets is logged with its URL. Unanchored on purpose: masking a lookalike path
 * costs nothing, while a `^` anchor would leak an absolute-form URL or the path
 * behind a future global prefix.
 */
const SECRET_PATH_PATTERNS = [
  /(\/webhooks\/jira\/)[^?#]+/i,
  /(\/auth\/invitations\/)[^?#]+/i,
];

/**
 * Masks the secrets a request URL can carry in its path, so that the URL can be
 * logged or echoed. Any other URL is returned unchanged.
 */
export function redactUrlSecrets(url: string): string {
  return SECRET_PATH_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, '$1[REDACTED]'),
    url,
  );
}
