/**
 * Every GitLab URL the service needs, derived from GITLAB_API_URL so a
 * self-managed instance works. The base is the API URL with a trailing '/'
 * and then '/api/v4' stripped; the OAuth endpoints and the clone URLs hang
 * off that base. gitlab.com stays the default when GITLAB_API_URL is unset.
 */
export interface GitlabUrls {
  api: string;
  base: string;
  oauthToken: string;
  oauthRevoke: string;
  cloneUrl(pathWithNamespace: string): string;
}

const DEFAULT_API_URL = 'https://gitlab.com/api/v4';

export function gitlabUrls(apiUrl: string | undefined): GitlabUrls {
  const trimmed = (apiUrl ?? '').replace(/\/+$/, '');
  const api = trimmed === '' ? DEFAULT_API_URL : trimmed;
  const base = api.replace(/\/api\/v4$/, '');
  return {
    api,
    base,
    oauthToken: `${base}/oauth/token`,
    oauthRevoke: `${base}/oauth/revoke`,
    cloneUrl: (pathWithNamespace: string) => `${base}/${pathWithNamespace}.git`,
  };
}
