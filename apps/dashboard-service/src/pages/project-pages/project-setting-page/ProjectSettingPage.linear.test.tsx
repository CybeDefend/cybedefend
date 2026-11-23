import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

// Holder hoisted above the vi.mock factories so they can reference it safely.
const h = vi.hoisted(() => ({
  captured: null as any,
  // The project in the URL: the page is reused across :projectId without a remount.
  projectId: 'p1',
  // The URL the page is served at: the settings page exists in both product
  // spaces, and the URL decides which one this is.
  pathname: '/appsec/project/p1/settings',
  isLinearLinked: true as boolean | null,
  listLinearTeamsMock: vi.fn(),
  getLinearTeamOptionsMock: vi.fn(),
  getProjectLinearConfigMock: vi.fn(),
  setProjectLinearConfigMock: vi.fn(),
  removeProjectLinearConfigMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const mockState = {
  organization: {
    selectedOrganization: { id: 'org-1', name: 'Org' },
  },
};

vi.mock('react-redux', () => ({
  useSelector: (fn: (s: any) => any) => fn(mockState),
  useDispatch: () => vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: h.projectId }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: h.pathname }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('react-toastify', () => ({
  toast: {
    success: (...a: unknown[]) => h.toastSuccess(...a),
    error: (...a: unknown[]) => h.toastError(...a),
  },
}));
vi.mock('../../../server/services/projectService', () => ({
  deleteProject: vi.fn(),
  fetchProject: vi.fn().mockResolvedValue({
    id: 'p1',
    name: 'Project One',
    teamId: 't1',
    teamName: 'Team A',
  }),
  updateProject: vi.fn(),
  fetchProjectSecurityContext: vi.fn().mockResolvedValue(null),
  updateProjectSecurityContext: vi.fn(),
}));
vi.mock('../../../server/services/integrations/githubIntegrationsService', () => ({
  unlinkGithubRepository: vi.fn(),
  getGithubRepositories: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../server/services/integrations/gitlabIntegrationsService', () => ({
  unlinkGitlabRepository: vi.fn(),
  getGitlabRepositories: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../server/services/integrations/slackIntegrationsService', () => ({
  getSlackInstallation: vi.fn().mockResolvedValue({ isConfigured: false }),
  getProjectSlackChannel: vi.fn().mockResolvedValue(null),
  listSlackChannels: vi.fn().mockResolvedValue([]),
  setProjectSlackChannel: vi.fn(),
}));
vi.mock('../../../server/services/integrations/jiraIntegrationsService', () => ({
  getProjectJiraConfig: vi.fn().mockResolvedValue(null),
  listJiraProjects: vi.fn().mockResolvedValue([]),
  setProjectJiraConfig: vi.fn(),
  removeProjectJiraConfig: vi.fn(),
}));
// The calls are stubbed; the two pure refusal helpers stay the real ones, so a
// refusal is read exactly as the page reads it.
vi.mock('../../../server/services/integrations/linearIntegrationsService', async () => {
  const actual = await vi.importActual<typeof import('../../../server/services/integrations/linearIntegrationsService')>(
    '../../../server/services/integrations/linearIntegrationsService',
  );
  return {
    linearRefusalOf: actual.linearRefusalOf,
    linearRefusalKey: actual.linearRefusalKey,
    listLinearTeams: (...a: unknown[]) => h.listLinearTeamsMock(...a),
    getLinearTeamOptions: (...a: unknown[]) => h.getLinearTeamOptionsMock(...a),
    getProjectLinearConfig: (...a: unknown[]) => h.getProjectLinearConfigMock(...a),
    setProjectLinearConfig: (...a: unknown[]) => h.setProjectLinearConfigMock(...a),
    removeProjectLinearConfig: (...a: unknown[]) => h.removeProjectLinearConfigMock(...a),
  };
});
vi.mock('../../../server/hooks/useProjectPageData', () => ({
  useProjectPageData: () => ({ branches: [], isJiraLinked: false, isLinearLinked: h.isLinearLinked }),
}));
vi.mock('@/server/hooks/useProjectBranchesList', () => ({
  useProjectBranchesList: () => ({
    branches: [],
    loading: false,
    error: null,
    search: '',
    setSearch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));
vi.mock('../../../utils/function/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clearScannerStorage: vi.fn(),
}));
vi.mock('@/utils/projectEvents', () => ({ dispatchProjectUpdated: vi.fn() }));
vi.mock('@/utils/data/agentCategoriesData', () => ({ CICD_CATEGORY_NAMES: [] }));
// Stub the presentation component: capture the props the page hands down.
vi.mock('./ProjectSettingTemplate', () => ({
  default: (props: any) => {
    h.captured = props;
    return <div data-testid="tpl" />;
  },
}));

import ProjectSettingPage from './ProjectSettingPage';

const TEAMS = [
  { id: 't-eng', key: 'ENG', name: 'Engineering' },
  { id: 't-ops', key: 'OPS', name: 'Operations' },
];

const OPTIONS_ENG = {
  projects: [
    { id: 'lp-sec', name: 'Security fixes' },
    { id: 'lp-debt', name: 'Tech debt' },
  ],
  labels: [
    { id: 'lb-vuln', name: 'Vulnerability' },
    { id: 'lb-sec', name: 'Security' },
  ],
  members: [],
};

const OPTIONS_OPS = {
  projects: [{ id: 'lp-infra', name: 'Infra' }],
  labels: [{ id: 'lb-ops', name: 'Ops' }],
  members: [],
};

const SAVED_CONFIG = {
  isConfigured: true,
  teamId: 't-eng',
  teamKey: 'ENG',
  teamName: 'Engineering',
  linearProjectId: 'lp-sec',
  linearProjectName: 'Security fixes',
  labels: [{ id: 'lb-vuln', name: 'Vulnerability' }],
  allowedBranches: ['main'],
  autoCreateEnabled: false,
};

beforeEach(() => {
  h.captured = null;
  h.projectId = 'p1';
  h.pathname = '/appsec/project/p1/settings';
  h.isLinearLinked = true;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.listLinearTeamsMock.mockReset().mockResolvedValue(TEAMS);
  h.getLinearTeamOptionsMock
    .mockReset()
    .mockImplementation(async (_org: string, teamId: string) => (teamId === 't-ops' ? OPTIONS_OPS : OPTIONS_ENG));
  h.getProjectLinearConfigMock.mockReset().mockResolvedValue(SAVED_CONFIG);
  h.setProjectLinearConfigMock.mockReset().mockResolvedValue({ success: true });
  h.removeProjectLinearConfigMock.mockReset().mockResolvedValue({ success: true });
});

/** The body of the nth save, as the gateway receives it. */
const savedBody = (n: number) => h.setProjectLinearConfigMock.mock.calls[n][2];

/**
 * A synchronous act: this harness's `t` changes identity on every render, so the
 * page never stops re-running its load effect and an async act would wait for a
 * quiet that never comes. The assertions wait with `waitFor` instead.
 */
const call = (fn: () => unknown) => {
  act(() => {
    void fn();
  });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const loaded = async () => {
  render(<ProjectSettingPage />);
  await waitFor(() => expect(h.captured?.linearConfig).toBeTruthy());
  await waitFor(() => expect(h.captured.linearTeamOptions).toBeTruthy());
};

describe('ProjectSettingPage — Linear settings', () => {
  it('reads the workspace teams, the saved config and that team’s options when Linear is connected', async () => {
    await loaded();

    expect(h.listLinearTeamsMock).toHaveBeenCalledWith('org-1');
    expect(h.getProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p1');
    expect(h.getLinearTeamOptionsMock).toHaveBeenCalledWith('org-1', 't-eng');
    expect(h.captured.isLinearConnected).toBe(true);
    expect(h.captured.linearTeams).toEqual(TEAMS);
    expect(h.captured.linearConfig).toEqual(SAVED_CONFIG);
    expect(h.captured.linearTeamOptions).toEqual(OPTIONS_ENG);
  });

  it('reads no team options for a project that has no Linear team yet', async () => {
    h.getProjectLinearConfigMock.mockResolvedValue({ isConfigured: false });

    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearTeams).toEqual(TEAMS));
    await settle();

    expect(h.captured.isLinearConnected).toBe(true);
    expect(h.captured.linearConfig).toBeNull();
    expect(h.getLinearTeamOptionsMock).not.toHaveBeenCalled();
  });

  it('reads nothing Linear when the organization has no Linear connection', async () => {
    h.isLinearLinked = false;

    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured).not.toBeNull());
    await settle();

    expect(h.captured.isLinearConnected).toBe(false);
    expect(h.listLinearTeamsMock).not.toHaveBeenCalled();
    expect(h.getProjectLinearConfigMock).not.toHaveBeenCalled();
    expect(h.getLinearTeamOptionsMock).not.toHaveBeenCalled();
  });

  it('reads nothing Linear while the project data are still loading', async () => {
    h.isLinearLinked = null;

    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured).not.toBeNull());
    await settle();

    expect(h.captured.isLinearConnected).toBe(false);
    expect(h.listLinearTeamsMock).not.toHaveBeenCalled();
  });

  it('saves the whole Linear config on each change and removes it when the team is cleared', async () => {
    await loaded();

    // Auto-create: everything else in the config is sent again.
    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.captured.linearConfig.autoCreateEnabled).toBe(true));
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);
    expect(h.setProjectLinearConfigMock.mock.calls[0].slice(0, 2)).toEqual(['org-1', 'p1']);
    expect(savedBody(0)).toEqual({
      teamId: 't-eng',
      linearProjectId: 'lp-sec',
      labelIds: ['lb-vuln'],
      allowedBranches: ['main'],
      autoCreateEnabled: true,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith('pages.projectSetting.toast.linearConfigUpdateSuccess');

    // Labels: the page resolves the ids against the team's options.
    call(() => h.captured.onLinearLabelsChange(['lb-vuln', 'lb-sec']));
    await waitFor(() => expect(h.captured.linearConfig.labels).toHaveLength(2));
    expect(savedBody(1)).toEqual({
      teamId: 't-eng',
      linearProjectId: 'lp-sec',
      labelIds: ['lb-vuln', 'lb-sec'],
      allowedBranches: ['main'],
      autoCreateEnabled: true,
    });
    expect(h.captured.linearConfig.labels).toEqual([
      { id: 'lb-vuln', name: 'Vulnerability' },
      { id: 'lb-sec', name: 'Security' },
    ]);

    // Branches.
    call(() => h.captured.onLinearAllowedBranchesChange(['main', 'dev']));
    await waitFor(() => expect(h.captured.linearConfig.allowedBranches).toEqual(['main', 'dev']));
    expect(savedBody(2).allowedBranches).toEqual(['main', 'dev']);
    expect(savedBody(2).labelIds).toEqual(['lb-vuln', 'lb-sec']);

    // Project: chosen, then dropped.
    call(() => h.captured.onLinearProjectChange('lp-debt'));
    await waitFor(() => expect(h.captured.linearConfig.linearProjectName).toBe('Tech debt'));
    expect(savedBody(3).linearProjectId).toBe('lp-debt');
    call(() => h.captured.onLinearProjectChange(null));
    await waitFor(() => expect(h.captured.linearConfig.linearProjectId).toBe(''));
    expect(savedBody(4).linearProjectId).toBeUndefined();

    // Clearing the team removes the whole config.
    call(() => h.captured.onLinearTeamChange(null));
    await waitFor(() => expect(h.captured.linearConfig).toBeNull());
    expect(h.removeProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p1');
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(5);
    await waitFor(() => expect(h.captured.linearTeamOptions).toBeNull());
    expect(h.toastSuccess).toHaveBeenLastCalledWith('pages.projectSetting.toast.linearConfigRemoveSuccess');
  });

  it('ignores a project that is not one of the team’s, and leaves out a label it cannot name', async () => {
    await loaded();

    call(() => h.captured.onLinearProjectChange('lp-from-another-team'));
    call(() => h.captured.onLinearLabelsChange(['lb-vuln', 'lb-from-another-team']));
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
    await settle();

    // No save for the foreign project; the unknown label was left out of the other.
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);
    expect(savedBody(0).linearProjectId).toBe('lp-sec');
    expect(savedBody(0).labelIds).toEqual(['lb-vuln']);
  });

  it('clears the project and labels of the old team when the team changes, and loads the new team’s options', async () => {
    await loaded();

    call(() => h.captured.onLinearTeamChange('t-ops'));
    await waitFor(() => expect(h.captured.linearConfig.teamId).toBe('t-ops'));

    // Nothing of the old team goes with the new one; the rest of the config does.
    expect(savedBody(0)).toEqual({
      teamId: 't-ops',
      linearProjectId: undefined,
      labelIds: [],
      allowedBranches: ['main'],
      autoCreateEnabled: false,
    });
    expect(h.captured.linearConfig).toMatchObject({
      isConfigured: true,
      teamId: 't-ops',
      teamKey: 'OPS',
      teamName: 'Operations',
      linearProjectId: '',
      linearProjectName: '',
      labels: [],
    });

    // The new team's projects and labels replace the old team's.
    await waitFor(() => expect(h.captured.linearTeamOptions).toEqual(OPTIONS_OPS));
    expect(h.getLinearTeamOptionsMock).toHaveBeenLastCalledWith('org-1', 't-ops');
  });

  it('saves nothing when the team chosen is the one already set', async () => {
    await loaded();

    call(() => h.captured.onLinearTeamChange('t-eng'));
    await settle();

    expect(h.setProjectLinearConfigMock).not.toHaveBeenCalled();
  });

  it('chooses a first team for a project without a Linear config', async () => {
    h.getProjectLinearConfigMock.mockResolvedValue({ isConfigured: false });
    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearTeams).toEqual(TEAMS));

    call(() => h.captured.onLinearTeamChange('t-eng'));
    await waitFor(() => expect(h.captured.linearConfig?.teamId).toBe('t-eng'));

    expect(savedBody(0)).toEqual({
      teamId: 't-eng',
      linearProjectId: undefined,
      labelIds: [],
      allowedBranches: [],
      autoCreateEnabled: false,
    });
    await waitFor(() => expect(h.captured.linearTeamOptions).toEqual(OPTIONS_ENG));
  });

  it('keeps the config as it was and says why, from a fixed sentence, when Linear refuses the save', async () => {
    await loaded();
    h.setProjectLinearConfigMock.mockRejectedValue({
      response: { data: { message: 'LINEAR_NEEDS_RECONNECT' } },
    });

    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());

    expect(h.toastError).toHaveBeenCalledWith('components.linearRefusals.LINEAR_NEEDS_RECONNECT');
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(false);
  });

  it('shows a generic error, never the server’s text, for any other failure', async () => {
    await loaded();
    h.setProjectLinearConfigMock.mockRejectedValue({
      response: { data: { message: 'connect ECONNREFUSED 10.0.0.7:50051' } },
    });

    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());

    expect(h.toastError).toHaveBeenCalledWith('pages.projectSetting.toast.linearConfigUpdateError');
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(false);
  });

  it('says it could not remove the config, from a fixed sentence, when the removal fails', async () => {
    await loaded();
    h.removeProjectLinearConfigMock.mockRejectedValue({ response: { data: { message: 'boom' } } });

    call(() => h.captured.onLinearTeamChange(null));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());

    expect(h.toastError).toHaveBeenCalledWith('pages.projectSetting.toast.linearConfigRemoveError');
    expect(h.captured.linearConfig).not.toBeNull();
  });
});

/** A promise settled by hand, to hold a request open while the user keeps editing. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/*
  The server replaces the whole config on each save. A second edit made while
  the first is still on its way must not be computed from the config as it was
  before the first: it would overwrite it on the server and report a success.
*/
describe('ProjectSettingPage — Linear saves made one after the other', () => {
  it('sends both changes when a second one is made before the first save answers, and shows both at once', async () => {
    await loaded();
    const first = deferred<{ success: boolean }>();
    h.setProjectLinearConfigMock.mockReturnValueOnce(first.promise);

    call(() => h.captured.onLinearLabelsChange(['lb-vuln', 'lb-sec']));
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
    // The labels show before the server has answered: the select is not bounced back.
    expect(h.captured.linearConfig.labels.map((label: { id: string }) => label.id)).toEqual(['lb-vuln', 'lb-sec']);

    call(() => h.captured.onLinearAutoCreateToggle());
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(true);
    expect(h.captured.linearConfig.labels).toHaveLength(2);
    // One save at a time: the second waits for the first.
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);

    first.resolve({ success: true });
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(2));

    expect(savedBody(0).labelIds).toEqual(['lb-vuln', 'lb-sec']);
    expect(savedBody(0).autoCreateEnabled).toBe(false);
    expect(savedBody(1)).toEqual({
      teamId: 't-eng',
      linearProjectId: 'lp-sec',
      labelIds: ['lb-vuln', 'lb-sec'],
      allowedBranches: ['main'],
      autoCreateEnabled: true,
    });
    await settle();
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(true);
    expect(h.captured.linearConfig.labels).toHaveLength(2);
  });

  it('sends the latest config once when two changes are made before any save starts', async () => {
    await loaded();

    act(() => {
      void h.captured.onLinearLabelsChange(['lb-vuln', 'lb-sec']);
      void h.captured.onLinearAllowedBranchesChange(['main', 'dev']);
    });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await settle();

    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);
    expect(savedBody(0).labelIds).toEqual(['lb-vuln', 'lb-sec']);
    expect(savedBody(0).allowedBranches).toEqual(['main', 'dev']);
    expect(h.captured.linearConfig.allowedBranches).toEqual(['main', 'dev']);
  });

  it('rolls back to what the server confirmed, with the refusal sentence, when a save fails', async () => {
    await loaded();
    const first = deferred<{ success: boolean }>();
    h.setProjectLinearConfigMock.mockReturnValueOnce(first.promise);

    call(() => h.captured.onLinearLabelsChange(['lb-vuln', 'lb-sec']));
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
    call(() => h.captured.onLinearAutoCreateToggle());
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(true);

    first.reject({ response: { data: { message: 'LINEAR_NEEDS_RECONNECT' } } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));

    // Both edits are undone, the second one is not sent over a config the server never took.
    expect(h.toastError).toHaveBeenCalledWith('components.linearRefusals.LINEAR_NEEDS_RECONNECT');
    expect(h.captured.linearConfig).toEqual(SAVED_CONFIG);
    await settle();
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('rolls back only the change the server refused, to the one it confirmed before', async () => {
    await loaded();
    const second = deferred<{ success: boolean }>();
    h.setProjectLinearConfigMock.mockResolvedValueOnce({ success: true }).mockReturnValueOnce(second.promise);

    call(() => h.captured.onLinearLabelsChange(['lb-vuln', 'lb-sec']));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(2));
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(true);

    second.reject(new Error('boom'));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));

    expect(h.toastError).toHaveBeenCalledWith('pages.projectSetting.toast.linearConfigUpdateError');
    expect(h.captured.linearConfig.autoCreateEnabled).toBe(false);
    expect(h.captured.linearConfig.labels).toHaveLength(2);
  });

  it('removes the config in turn with the saves before it', async () => {
    await loaded();
    const first = deferred<{ success: boolean }>();
    h.setProjectLinearConfigMock.mockReturnValueOnce(first.promise);

    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
    call(() => h.captured.onLinearTeamChange(null));
    expect(h.captured.linearConfig).toBeNull();
    expect(h.removeProjectLinearConfigMock).not.toHaveBeenCalled();

    first.resolve({ success: true });
    await waitFor(() => expect(h.removeProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p1'));
    expect(h.captured.linearConfig).toBeNull();
  });
});

/*
  The settings page is reused across :projectId without a remount: the Linear
  config, its team's options and the saves in flight belong to one project.
*/
describe('ProjectSettingPage — Linear settings across projects', () => {
  const otherProjectNotConfigured = () =>
    h.getProjectLinearConfigMock.mockImplementation(async (_org: string, projectId: string) =>
      projectId === 'p2' ? { isConfigured: false } : SAVED_CONFIG,
    );

  it('shows nothing of the first project’s config on a project that has none, and saves none of its values there', async () => {
    otherProjectNotConfigured();
    const { rerender } = render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearConfig).toBeTruthy());
    await waitFor(() => expect(h.captured.linearTeamOptions).toBeTruthy());

    h.projectId = 'p2';
    rerender(<ProjectSettingPage />);
    await waitFor(() => expect(h.getProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p2'));
    await waitFor(() => expect(h.captured.isLinearConfigLoading).toBe(false));

    expect(h.captured.linearConfig).toBeNull();
    expect(h.captured.linearTeamOptions).toBeNull();

    // Nothing to toggle or edit on a project with no team.
    call(() => h.captured.onLinearAutoCreateToggle());
    call(() => h.captured.onLinearAllowedBranchesChange(['main']));
    await settle();
    expect(h.setProjectLinearConfigMock).not.toHaveBeenCalled();

    // The first team chosen on it starts from empty values, not from the first project's.
    call(() => h.captured.onLinearTeamChange('t-ops'));
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
    expect(h.setProjectLinearConfigMock.mock.calls[0].slice(0, 2)).toEqual(['org-1', 'p2']);
    expect(savedBody(0)).toEqual({
      teamId: 't-ops',
      linearProjectId: undefined,
      labelIds: [],
      allowedBranches: [],
      autoCreateEnabled: false,
    });
  });

  it('drops the answer of a config read that comes back after the project changed', async () => {
    const late = deferred<typeof SAVED_CONFIG>();
    h.getProjectLinearConfigMock.mockImplementation((_org: string, projectId: string) =>
      projectId === 'p1' ? late.promise : Promise.resolve({ isConfigured: false }),
    );
    const { rerender } = render(<ProjectSettingPage />);
    await waitFor(() => expect(h.getProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p1'));

    h.projectId = 'p2';
    rerender(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured.isLinearConfigLoading).toBe(false));

    late.resolve(SAVED_CONFIG);
    await settle();

    expect(h.captured.linearConfig).toBeNull();
    expect(h.captured.isLinearConfigLoading).toBe(false);
  });

  it('does not let a save still on its way for the first project touch the second', async () => {
    otherProjectNotConfigured();
    const { rerender } = render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearConfig).toBeTruthy());
    const inFlight = deferred<{ success: boolean }>();
    h.setProjectLinearConfigMock.mockReturnValueOnce(inFlight.promise);
    call(() => h.captured.onLinearAutoCreateToggle());
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));

    h.projectId = 'p2';
    rerender(<ProjectSettingPage />);
    await waitFor(() => expect(h.getProjectLinearConfigMock).toHaveBeenCalledWith('org-1', 'p2'));
    await waitFor(() => expect(h.captured.isLinearConfigLoading).toBe(false));

    inFlight.resolve({ success: true });
    await settle();

    expect(h.captured.linearConfig).toBeNull();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1);
  });
});

/*
  A team picked before the stored config has been read would be saved over the
  stored branches and auto-create (the server replaces the whole config), and
  the late answer would then overwrite what was just saved.
*/
describe('ProjectSettingPage — Linear controls while the config is being read', () => {
  it('is loading until the config read answers, and saves nothing meanwhile', async () => {
    const pending = deferred<typeof SAVED_CONFIG | { isConfigured: false }>();
    h.getProjectLinearConfigMock.mockReturnValue(pending.promise);

    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearTeams).toEqual(TEAMS));

    expect(h.captured.isLinearConfigLoading).toBe(true);
    call(() => h.captured.onLinearTeamChange('t-ops'));
    await settle();
    expect(h.setProjectLinearConfigMock).not.toHaveBeenCalled();
    expect(h.captured.linearConfig).toBeNull();

    pending.resolve({ isConfigured: false });
    await waitFor(() => expect(h.captured.isLinearConfigLoading).toBe(false));

    call(() => h.captured.onLinearTeamChange('t-ops'));
    await waitFor(() => expect(h.setProjectLinearConfigMock).toHaveBeenCalledTimes(1));
  });

  it('stays loading, and saves nothing, when the config cannot be read', async () => {
    h.getProjectLinearConfigMock.mockRejectedValue(new Error('network'));

    render(<ProjectSettingPage />);
    await waitFor(() => expect(h.captured?.linearTeams).toEqual(TEAMS));
    await settle();

    expect(h.captured.isLinearConfigLoading).toBe(true);
    call(() => h.captured.onLinearTeamChange('t-ops'));
    await settle();
    expect(h.setProjectLinearConfigMock).not.toHaveBeenCalled();
  });
});
