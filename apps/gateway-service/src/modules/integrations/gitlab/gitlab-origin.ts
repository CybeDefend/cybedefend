export const DEFAULT_GITLAB_API_URL = 'https://gitlab.com/api/v4';

/**
 * The web origin of the GitLab instance: GITLAB_API_URL without a trailing
 * `/api/v4` (and its trailing slashes). undefined or '' → 'https://gitlab.com'.
 */
export function gitlabWebOrigin(apiUrl: string | undefined): string {
  const raw =
    apiUrl === undefined || apiUrl.trim() === ''
      ? DEFAULT_GITLAB_API_URL
      : apiUrl.trim();
  return raw
    .replace(/\/+$/, '')
    .replace(/\/api\/v4$/, '')
    .replace(/\/+$/, '');
}
