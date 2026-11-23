import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getApiUrl,
  getGithubAppUrl,
  getJiraClientId,
  getSlackClientId,
  readRuntimeConfig,
} from './runtimeConfig';

type ConfigWindow = Window & { __CYBEDEFEND_CONFIG__?: unknown };

function setConfig(value: unknown): void {
  (window as ConfigWindow).__CYBEDEFEND_CONFIG__ = value;
}

afterEach(() => {
  delete (window as ConfigWindow).__CYBEDEFEND_CONFIG__;
  vi.unstubAllEnvs();
});

describe('runtimeConfig', () => {
  it('runtime apiUrl wins over the build value', () => {
    vi.stubEnv('VITE_GATEWAY_URL', 'http://localhost:3000');
    setConfig({ apiUrl: 'https://api.example.org' });
    expect(getApiUrl()).toBe('https://api.example.org');
  });

  it('falls back to the build value without a runtime config', () => {
    vi.stubEnv('VITE_GATEWAY_URL', 'http://localhost:3000');
    expect(readRuntimeConfig()).toEqual({});
    expect(getApiUrl()).toBe('http://localhost:3000');
  });

  it('a relative /api is accepted and resolved against the origin', () => {
    setConfig({ apiUrl: '/api' });
    expect(readRuntimeConfig().apiUrl).toBe(`${window.location.origin}/api`);
    expect(getApiUrl()).toBe(`${window.location.origin}/api`);
  });

  it('//evil.com is ignored', () => {
    vi.stubEnv('VITE_GATEWAY_URL', 'http://localhost:3000');
    setConfig({ apiUrl: '//evil.com', githubAppUrl: '/\\evil.com', publicUrl: '//evil.com/x' });
    expect(readRuntimeConfig()).toEqual({});
    expect(getApiUrl()).toBe('http://localhost:3000');
  });

  it('a javascript: URL is ignored', () => {
    setConfig({ apiUrl: 'javascript:alert(1)', githubAppUrl: 'data:text/html,x', publicUrl: 'api' });
    expect(readRuntimeConfig()).toEqual({});
  });

  it('non-string values are ignored', () => {
    setConfig({ apiUrl: 42, githubAppUrl: { href: 'https://x.org' }, slackClientId: ['a'], jiraClientId: null, publicUrl: true });
    expect(readRuntimeConfig()).toEqual({});
  });

  it('a config that is not an object is ignored', () => {
    setConfig('apiUrl=https://evil.com');
    expect(readRuntimeConfig()).toEqual({});
  });

  it('keeps the client ids and the URLs it accepts', () => {
    setConfig({
      githubAppUrl: 'https://github.com/apps/acme/installations/select_target',
      slackClientId: '123.456',
      jiraClientId: 'jira-id',
      publicUrl: 'https://appsec.example.org',
    });
    expect(readRuntimeConfig()).toEqual({
      githubAppUrl: 'https://github.com/apps/acme/installations/select_target',
      slackClientId: '123.456',
      jiraClientId: 'jira-id',
      publicUrl: 'https://appsec.example.org',
    });
    expect(getGithubAppUrl()).toBe('https://github.com/apps/acme/installations/select_target');
    expect(getSlackClientId()).toBe('123.456');
    expect(getJiraClientId()).toBe('jira-id');
  });

  it('an empty runtime value keeps the build value', () => {
    vi.stubEnv('VITE_GITHUB_INTEGRATION_URL', 'https://github.com/apps/build/installations/select_target');
    vi.stubEnv('VITE_SLACK_CLIENT_ID', 'build-slack');
    setConfig({ githubAppUrl: '', slackClientId: '' });
    expect(getGithubAppUrl()).toBe('https://github.com/apps/build/installations/select_target');
    expect(getSlackClientId()).toBe('build-slack');
  });

  it('without any value, the integration getters answer an empty string', () => {
    vi.stubEnv('VITE_GITHUB_INTEGRATION_URL', '');
    vi.stubEnv('VITE_SLACK_CLIENT_ID', '');
    vi.stubEnv('VITE_JIRA_CLIENT_ID', '');
    expect(getGithubAppUrl()).toBe('');
    expect(getSlackClientId()).toBe('');
    expect(getJiraClientId()).toBe('');
  });
});
