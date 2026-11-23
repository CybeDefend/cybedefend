/**
 * Runtime configuration of the dashboard.
 *
 * `public/config.js` sets `window.__CYBEDEFEND_CONFIG__` before the bundle
 * runs. Its default is an empty object, so a build keeps its build-time
 * values; the Community image rewrites the file at container start
 * (`nginx/docker-entrypoint.d/40-cybedefend-config.sh`), so one image serves
 * any API address.
 *
 * The file can be edited by whoever runs the container, never by a visitor,
 * but every value is still checked: a value that is not a string is dropped,
 * and a URL must be http(s) or a path on this origin ('/api', never '//host').
 */

export interface RuntimeConfig {
  apiUrl?: string;
  githubAppUrl?: string;
  slackClientId?: string;
  jiraClientId?: string;
  publicUrl?: string;
}

type ConfigWindow = Window & { __CYBEDEFEND_CONFIG__?: unknown };

const URL_KEYS = ['apiUrl', 'githubAppUrl', 'publicUrl'] as const;
const TEXT_KEYS = ['slackClientId', 'jiraClientId'] as const;

/** An http(s) URL as given, or a same-origin path resolved against the origin. */
function acceptUrl(value: string): string | undefined {
  const origin = window.location.origin;
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return undefined;
    let resolved: URL;
    try {
      resolved = new URL(value, origin);
    } catch {
      return undefined;
    }
    // '/\evil.com' is parsed as '//evil.com': only a path that stays here counts.
    if (resolved.origin !== origin) return undefined;
    return `${origin}${value}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  return value;
}

export function readRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') return {};
  const raw = (window as ConfigWindow).__CYBEDEFEND_CONFIG__;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const config: RuntimeConfig = {};
  for (const key of URL_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || value === '') continue;
    const url = acceptUrl(value);
    if (url !== undefined) config[key] = url;
  }
  for (const key of TEXT_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') config[key] = value;
  }
  return config;
}

/** The gateway's base URL: the runtime value, else the build's `VITE_GATEWAY_URL`. */
export function getApiUrl(): string {
  return readRuntimeConfig().apiUrl ?? import.meta.env.VITE_GATEWAY_URL;
}

/** The GitHub App installation URL, or '' when none is configured. */
export function getGithubAppUrl(): string {
  return readRuntimeConfig().githubAppUrl ?? (import.meta.env.VITE_GITHUB_INTEGRATION_URL || '');
}

/** The Slack app's client id, or '' when none is configured. */
export function getSlackClientId(): string {
  return readRuntimeConfig().slackClientId ?? (import.meta.env.VITE_SLACK_CLIENT_ID || '');
}

/** The Jira app's client id, or '' when none is configured. */
export function getJiraClientId(): string {
  return readRuntimeConfig().jiraClientId ?? (import.meta.env.VITE_JIRA_CLIENT_ID || '');
}
