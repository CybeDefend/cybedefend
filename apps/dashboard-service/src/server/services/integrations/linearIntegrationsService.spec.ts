import { vi, describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
vi.mock('../../api/gatewayAPI', () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

import {
  LINEAR_REFUSALS,
  createLinearIssues,
  disconnectLinear,
  getLinearInstallation,
  getLinearOAuthUrl,
  getLinearProjectIssues,
  getLinearTeamOptions,
  getProjectLinearConfig,
  installLinearIntegration,
  linearRefusalKey,
  linearRefusalOf,
  linkLinearIssue,
  listLinearTeams,
  removeProjectLinearConfig,
  setProjectLinearConfig,
  syncLinearIssueStatus,
} from './linearIntegrationsService';

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

const ok = (data: unknown, status = 200) => ({ status, data });

describe('getLinearInstallation', () => {
  it('reads the installation of the organization', async () => {
    const installation = { isConfigured: true, workspaceName: 'Acme', needsReconnect: false };
    mockGet.mockResolvedValueOnce(ok(installation));

    await expect(getLinearInstallation('org-1')).resolves.toEqual(installation);
    expect(mockGet).toHaveBeenCalledWith('/organization/org-1/linear/installation');
  });

  it('two parallel installation reads share one request', async () => {
    let resolveResponse: (value: { status: number; data: unknown }) => void;
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const first = getLinearInstallation('org-1');
    const second = getLinearInstallation('org-1');
    resolveResponse!(ok({ isConfigured: true }));

    const [a, b] = await Promise.all([first, second]);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ isConfigured: true });
    expect(b).toEqual({ isConfigured: true });
  });

  it('does not share a request between two organizations', async () => {
    mockGet.mockResolvedValueOnce(ok({ isConfigured: true }));
    mockGet.mockResolvedValueOnce(ok({ isConfigured: false }));

    const [a, b] = await Promise.all([getLinearInstallation('org-1'), getLinearInstallation('org-2')]);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ isConfigured: true });
    expect(b).toEqual({ isConfigured: false });
  });

  it('asks again once the previous read settled', async () => {
    mockGet.mockResolvedValueOnce(ok({ isConfigured: true }));
    mockGet.mockResolvedValueOnce(ok({ isConfigured: false }));

    expect(await getLinearInstallation('org-1')).toEqual({ isConfigured: true });
    expect(await getLinearInstallation('org-1')).toEqual({ isConfigured: false });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('releases the shared request when it fails, so a retry is possible', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    mockGet.mockResolvedValueOnce(ok({ isConfigured: true }));

    await expect(getLinearInstallation('org-1')).rejects.toThrow('boom');
    await expect(getLinearInstallation('org-1')).resolves.toEqual({ isConfigured: true });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('throws on an unexpected status', async () => {
    mockGet.mockResolvedValueOnce(ok({}, 204));
    await expect(getLinearInstallation('org-1')).rejects.toThrow('Unexpected status code: 204');
  });
});

describe('OAuth and connection', () => {
  it('getLinearOAuthUrl reads the install url', async () => {
    mockGet.mockResolvedValueOnce(ok({ installUrl: 'https://linear.app/oauth/authorize?x=1' }));

    await expect(getLinearOAuthUrl('org-1')).resolves.toEqual({ installUrl: 'https://linear.app/oauth/authorize?x=1' });
    expect(mockGet).toHaveBeenCalledWith('/organization/org-1/linear/oauth/url');
  });

  it('installLinearIntegration posts the code, redirect uri and state', async () => {
    mockPost.mockResolvedValueOnce(ok({ success: true }));
    const payload = { code: 'c', redirectUri: 'https://app/integrations/linear/callback', state: 's' };

    await expect(installLinearIntegration('org-1', payload)).resolves.toEqual({ success: true });
    expect(mockPost).toHaveBeenCalledWith('/organization/org-1/linear/install/callback', payload);
  });

  it('installLinearIntegration throws on an unexpected status', async () => {
    mockPost.mockResolvedValueOnce(ok({}, 204));
    await expect(installLinearIntegration('org-1', { code: 'c', redirectUri: 'r', state: 's' })).rejects.toThrow(
      'Unexpected status code: 204',
    );
  });

  it('disconnectLinear deletes the connection', async () => {
    mockDelete.mockResolvedValueOnce(ok({ success: true }));

    await expect(disconnectLinear('org-1')).resolves.toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith('/organization/org-1/linear/disconnect');
  });

  it('listLinearTeams returns the teams array', async () => {
    const teams = [{ id: 't-1', key: 'ENG', name: 'Engineering' }];
    mockGet.mockResolvedValueOnce(ok({ teams }));

    await expect(listLinearTeams('org-1')).resolves.toEqual(teams);
    expect(mockGet).toHaveBeenCalledWith('/organization/org-1/linear/teams');
  });

  it('listLinearTeams throws on an unexpected status', async () => {
    mockGet.mockResolvedValueOnce(ok({ teams: [] }, 204));
    await expect(listLinearTeams('org-1')).rejects.toThrow('Unexpected status code: 204');
  });

  it('getLinearTeamOptions reads the projects, labels and members of one team', async () => {
    const options = {
      projects: [{ id: 'p-1', name: 'Platform' }],
      labels: [{ id: 'l-1', name: 'security' }],
      members: [{ id: 'm-1', name: 'ada', displayName: 'Ada L.' }],
    };
    mockGet.mockResolvedValueOnce(ok(options));

    await expect(getLinearTeamOptions('org-1', 'team-1')).resolves.toEqual(options);
    expect(mockGet).toHaveBeenCalledWith('/organization/org-1/linear/teams/team-1/options');
  });
});

describe('project configuration', () => {
  const base = '/organization/org-1/project/proj-1/linear/config';

  it('setProjectLinearConfig posts the configuration', async () => {
    mockPost.mockResolvedValueOnce(ok({ success: true }));
    const config = {
      teamId: 'team-1',
      linearProjectId: 'lp-1',
      labelIds: ['l-1', 'l-2'],
      allowedBranches: ['main'],
      autoCreateEnabled: true,
    };

    await expect(setProjectLinearConfig('org-1', 'proj-1', config)).resolves.toEqual({ success: true });
    expect(mockPost).toHaveBeenCalledWith(base, config);
  });

  it('getProjectLinearConfig reads the configuration', async () => {
    const config = {
      isConfigured: true,
      teamId: 'team-1',
      teamKey: 'ENG',
      teamName: 'Engineering',
      linearProjectId: '',
      linearProjectName: '',
      labels: [{ id: 'l-1', name: 'security' }],
      allowedBranches: ['main'],
      autoCreateEnabled: false,
    };
    mockGet.mockResolvedValueOnce(ok(config));

    await expect(getProjectLinearConfig('org-1', 'proj-1')).resolves.toEqual(config);
    expect(mockGet).toHaveBeenCalledWith(base);
  });

  it('removeProjectLinearConfig deletes the configuration', async () => {
    mockDelete.mockResolvedValueOnce(ok({ success: true }));

    await expect(removeProjectLinearConfig('org-1', 'proj-1')).resolves.toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith(base);
  });

  it('throws on an unexpected status', async () => {
    mockGet.mockResolvedValueOnce(ok({}, 204));
    await expect(getProjectLinearConfig('org-1', 'proj-1')).rejects.toThrow('Unexpected status code: 204');
  });
});

describe('issues', () => {
  const base = '/organization/org-1/project/proj-1/linear/issues';

  it('createLinearIssues posts the per-ticket choices as they are', async () => {
    const result = { success: true, issues: [], failedVulnerabilityIds: ['v-2'] };
    mockPost.mockResolvedValueOnce(ok(result));
    const payload = {
      scanId: '',
      mode: 2,
      vulnerabilities: [{ vulnerabilityId: 'v-1', scannerType: 'sast' }],
      cybedefendBaseUrl: 'https://app.example.com',
      teamId: 'team-1',
      linearProjectId: 'lp-1',
      labelIds: ['l-1'],
      assigneeId: 'm-1',
      priority: 2,
    };

    await expect(createLinearIssues('org-1', 'proj-1', payload)).resolves.toEqual(result);
    expect(mockPost).toHaveBeenCalledWith(base, payload);
  });

  it('linkLinearIssue posts the issue reference', async () => {
    mockPost.mockResolvedValueOnce(ok({ success: true, issue: { issueId: 'i-1' } }));
    const payload = {
      issueRef: 'ENG-142',
      vulnerabilityIds: ['v-1'],
      scannerType: 'sast',
      cybedefendBaseUrl: 'https://app.example.com',
    };

    await expect(linkLinearIssue('org-1', 'proj-1', payload)).resolves.toEqual({
      success: true,
      issue: { issueId: 'i-1' },
    });
    expect(mockPost).toHaveBeenCalledWith(`${base}/link`, payload);
  });

  it('getLinearProjectIssues reads the issues of the project', async () => {
    const result = { success: true, issues: [{ issueId: 'i-1', linearIdentifier: 'ENG-1' }] };
    mockGet.mockResolvedValueOnce(ok(result));

    await expect(getLinearProjectIssues('org-1', 'proj-1')).resolves.toEqual(result);
    expect(mockGet).toHaveBeenCalledWith(base);
  });

  it('syncLinearIssueStatus asks the server to read the project tickets again', async () => {
    mockPost.mockResolvedValueOnce(ok({ success: true, updated: 3 }));

    await expect(syncLinearIssueStatus('org-1', 'proj-1')).resolves.toEqual({ success: true, updated: 3 });
    expect(mockPost).toHaveBeenCalledWith(`${base}/sync-status`);
  });

  it('throws on an unexpected status', async () => {
    mockPost.mockResolvedValueOnce(ok({}, 204));
    await expect(
      createLinearIssues('org-1', 'proj-1', { scanId: '', mode: 2, vulnerabilities: [], cybedefendBaseUrl: 'u' }),
    ).rejects.toThrow('Unexpected status code: 204');
  });
});

describe('refusals', () => {
  const refused = (message: unknown) => ({ response: { status: 400, data: { message } } });

  it('linearRefusalOf returns a known code and null for any other message', () => {
    for (const code of LINEAR_REFUSALS) {
      expect(linearRefusalOf(refused(code))).toBe(code);
    }

    expect(linearRefusalOf(refused('Something went wrong'))).toBeNull();
    expect(linearRefusalOf(refused('LINEAR_NOT_CONNECTED: details'))).toBeNull();
    expect(linearRefusalOf(refused('linear_not_connected'))).toBeNull();
    expect(linearRefusalOf(refused(['LINEAR_NOT_CONNECTED']))).toBeNull();
    expect(linearRefusalOf(refused(undefined))).toBeNull();
    expect(linearRefusalOf({ response: { data: { code: 'LINEAR_NOT_CONNECTED' } } })).toBeNull();
    expect(linearRefusalOf({ response: {} })).toBeNull();
    expect(linearRefusalOf({ message: 'LINEAR_NOT_CONNECTED' })).toBeNull();
    expect(linearRefusalOf(new Error('LINEAR_NOT_CONNECTED'))).toBeNull();
    expect(linearRefusalOf(null)).toBeNull();
    expect(linearRefusalOf(undefined)).toBeNull();
    expect(linearRefusalOf('LINEAR_NOT_CONNECTED')).toBeNull();
  });

  it('keeps the closed list of the server', () => {
    expect([...LINEAR_REFUSALS]).toEqual([
      'LINEAR_NOT_CONNECTED',
      'LINEAR_NEEDS_RECONNECT',
      'LINEAR_WORKSPACE_TAKEN',
      'LINEAR_NO_TEAM',
      'LINEAR_TEAM_NOT_FOUND',
      'LINEAR_ISSUE_NOT_FOUND',
    ]);
  });

  it('linearRefusalKey names a fixed translation per code', () => {
    expect(linearRefusalKey('LINEAR_NEEDS_RECONNECT')).toBe('components.linearRefusals.LINEAR_NEEDS_RECONNECT');
  });

  it.each(['en', 'fr'] as const)('has a plain sentence for every code in %s', (lng) => {
    const file = path.resolve(__dirname, `../../../i18n/locales/${lng}/components/linearRefusals.json`);
    const sentences = JSON.parse(fs.readFileSync(file, 'utf8')).components.linearRefusals as Record<string, unknown>;

    expect(Object.keys(sentences).sort()).toEqual([...LINEAR_REFUSALS].sort());
    for (const code of LINEAR_REFUSALS) {
      const sentence = sentences[code];
      expect(typeof sentence).toBe('string');
      expect((sentence as string).trim().length).toBeGreaterThan(0);
      // Never the server's code or an internal name in the sentence the user reads.
      expect(sentence).not.toMatch(/LINEAR_|gRPC|RpcException|GraphQL/);
    }
  });
});
