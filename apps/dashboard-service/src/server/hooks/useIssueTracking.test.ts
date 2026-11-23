import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The results pages show, for each finding, the Jira and the Linear tickets it
 * is linked to. One hook reads both tools of the project, each only once the
 * project payload says the tool is linked to the organisation.
 */

const h = vi.hoisted(() => ({
  getProjectJiraConfig: vi.fn(),
  getJiraProjectIssues: vi.fn(),
  getProjectLinearConfig: vi.fn(),
  getLinearProjectIssues: vi.fn(),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/server/services/integrations/jiraIntegrationsService', () => ({
  getProjectJiraConfig: h.getProjectJiraConfig,
  getJiraProjectIssues: h.getJiraProjectIssues,
}));
vi.mock('@/server/services/integrations/linearIntegrationsService', () => ({
  getProjectLinearConfig: h.getProjectLinearConfig,
  getLinearProjectIssues: h.getLinearProjectIssues,
}));

import {
  useIssueTracking,
  groupTicketsOf,
  branchAllowed,
  ticketToolAvailable,
  trackingForBranch,
  type IssueTracking,
  type TrackedTicket,
} from './useIssueTracking';

const P = 'project-1';

const jiraConfig = {
  jiraProjectId: '10001',
  jiraProjectKey: 'KAN',
  jiraProjectName: 'Kanban',
  allowedBranches: ['main'],
  isConfigured: true,
  autoCreateEnabled: false,
};

const linearConfig = {
  isConfigured: true,
  teamId: 'team-1',
  teamKey: 'ENG',
  teamName: 'Engineering',
  linearProjectId: 'lp-1',
  linearProjectName: 'Security',
  labels: [{ id: 'l-1', name: 'security' }],
  allowedBranches: [],
  autoCreateEnabled: false,
};

const jiraIssue = (over: Record<string, unknown> = {}) => ({
  issueId: '10042',
  issueNumber: 1,
  title: 'KAN-1 SQL injection',
  url: 'https://acme.atlassian.net/browse/KAN-1',
  state: 'In Progress',
  vulnerabilityIds: ['v-1', 'v-2'],
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  jiraProjectKey: 'KAN',
  jiraPriority: 'High',
  jiraAssignee: 'Ada Lovelace',
  ...over,
});

const linearIssue = (over: Record<string, unknown> = {}) => ({
  issueId: '6f1c3a1e-0000-4000-8000-000000000007',
  issueNumber: 7,
  title: 'SQL injection',
  url: 'https://linear.app/acme/issue/ENG-7/sql-injection',
  state: 'Todo',
  vulnerabilityIds: ['v-2', 'v-3'],
  createdAt: '2026-10-21T10:00:00Z',
  updatedAt: '2026-10-21T10:00:00Z',
  linearIdentifier: 'ENG-7',
  linearTeamKey: 'ENG',
  linearPriority: 'Urgent',
  linearAssignee: 'Grace Hopper',
  linearStateType: 'unstarted',
  ...over,
});

/** Waits for the microtasks the hook's effects start. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise the test settles itself. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

type Links = { isJiraLinked: boolean | null; isLinearLinked: boolean | null };

describe('useIssueTracking', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.getProjectJiraConfig.mockResolvedValue(jiraConfig);
    h.getJiraProjectIssues.mockResolvedValue({ success: true, issues: [jiraIssue()] });
    h.getProjectLinearConfig.mockResolvedValue(linearConfig);
    h.getLinearProjectIssues.mockResolvedValue({ success: true, issues: [linearIssue()] });
  });

  it('reads nothing while a link is unknown', async () => {
    const { result, rerender } = renderHook(({ links }) => useIssueTracking(P, links), {
      initialProps: { links: { isJiraLinked: null, isLinearLinked: null } as Links },
    });
    await settle();

    expect(h.getProjectJiraConfig).not.toHaveBeenCalled();
    expect(h.getJiraProjectIssues).not.toHaveBeenCalled();
    expect(h.getProjectLinearConfig).not.toHaveBeenCalled();
    expect(h.getLinearProjectIssues).not.toHaveBeenCalled();
    expect(result.current.anyConfigured).toBe(false);
    expect(result.current.ticketsByVulnerability.size).toBe(0);

    // Jira is now known to be linked, Linear still unknown: only Jira is read.
    rerender({ links: { isJiraLinked: true, isLinearLinked: null } });
    await waitFor(() => expect(result.current.jira.configured).toBe(true));
    expect(h.getProjectJiraConfig).toHaveBeenCalledWith('org-1', P);
    expect(h.getJiraProjectIssues).toHaveBeenCalledWith('org-1', P);
    expect(h.getProjectLinearConfig).not.toHaveBeenCalled();
    expect(h.getLinearProjectIssues).not.toHaveBeenCalled();
  });

  it('merges Jira and Linear tickets per vulnerability', async () => {
    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: true, isLinearLinked: true }));

    await waitFor(() => expect(result.current.ticketsByVulnerability.get('v-2')).toHaveLength(2));

    const jira: TrackedTicket = {
      provider: 'jira',
      key: 'KAN-1',
      url: 'https://acme.atlassian.net/browse/KAN-1',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      priority: 'High',
      assignee: 'Ada Lovelace',
      container: 'KAN',
    };
    const linear: TrackedTicket = {
      provider: 'linear',
      key: 'ENG-7',
      url: 'https://linear.app/acme/issue/ENG-7/sql-injection',
      status: 'Todo',
      statusCategory: 'new',
      priority: 'Urgent',
      assignee: 'Grace Hopper',
      container: 'ENG',
    };
    expect(result.current.ticketsByVulnerability.get('v-1')).toEqual([jira]);
    expect(result.current.ticketsByVulnerability.get('v-2')).toEqual([jira, linear]);
    expect(result.current.ticketsByVulnerability.get('v-3')).toEqual([linear]);

    expect(result.current.organizationId).toBe('org-1');
    expect(result.current.jira).toEqual({ configured: true, projectKey: 'KAN', allowedBranches: ['main'] });
    expect(result.current.linear).toEqual({ connected: true, configured: true, config: linearConfig, allowedBranches: [] });
    expect(result.current.anyConfigured).toBe(true);
  });

  it('keeps a tool unconfigured when its project settings are not configured, and shows its tickets all the same', async () => {
    h.getProjectLinearConfig.mockResolvedValue({ ...linearConfig, isConfigured: false });
    h.getProjectJiraConfig.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: true, isLinearLinked: true }));

    await waitFor(() => expect(result.current.ticketsByVulnerability.get('v-2')).toHaveLength(2));
    expect(result.current.jira).toEqual({ configured: false, allowedBranches: [] });
    // Linear is connected to the organisation: it can take a ticket, the form asks for a team.
    expect(result.current.linear).toEqual({ connected: true, configured: false, allowedBranches: [] });
    expect(result.current.anyConfigured).toBe(true);
  });

  it('counts no tool when Jira has no project settings and Linear is not connected', async () => {
    h.getProjectJiraConfig.mockResolvedValue({ ...jiraConfig, isConfigured: false });

    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: true, isLinearLinked: false }));

    await waitFor(() => expect(result.current.ticketsByVulnerability.size).toBeGreaterThan(0));
    expect(result.current.linear).toEqual({ connected: false, configured: false, allowedBranches: [] });
    expect(result.current.anyConfigured).toBe(false);
  });

  it('drops the read of the previous project when the next one is not known yet', async () => {
    const jiraA = deferred<typeof jiraConfig>();
    const linearA = deferred<typeof linearConfig>();
    h.getProjectJiraConfig.mockReturnValueOnce(jiraA.promise);
    h.getProjectLinearConfig.mockReturnValueOnce(linearA.promise);

    const { result, rerender } = renderHook(({ projectId, links }) => useIssueTracking(projectId, links), {
      initialProps: { projectId: 'project-A', links: { isJiraLinked: true, isLinearLinked: true } as Links },
    });
    await waitFor(() => expect(h.getProjectJiraConfig).toHaveBeenCalledWith('org-1', 'project-A'));

    // Project B is still loading: its links are unknown.
    rerender({ projectId: 'project-B', links: { isJiraLinked: null, isLinearLinked: null } });
    await act(async () => {
      jiraA.resolve(jiraConfig);
      linearA.resolve(linearConfig);
      await settle();
    });

    expect(result.current.jira).toEqual({ configured: false, allowedBranches: [] });
    expect(result.current.linear).toEqual({ connected: false, configured: false, allowedBranches: [] });
    expect(result.current.ticketsByVulnerability.size).toBe(0);
    expect(result.current.anyConfigured).toBe(false);
  });

  it("never shows the previous project's tools while the next project is read", async () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useIssueTracking(projectId, { isJiraLinked: true, isLinearLinked: true }),
      { initialProps: { projectId: 'project-A' } },
    );
    await waitFor(() => expect(result.current.jira.projectKey).toBe('KAN'));
    expect(result.current.linear.config).toEqual(linearConfig);

    const jiraB = deferred<typeof jiraConfig>();
    h.getProjectJiraConfig.mockReturnValueOnce(jiraB.promise);
    h.getJiraProjectIssues.mockResolvedValueOnce({ success: true, issues: [] });
    h.getProjectLinearConfig.mockReturnValueOnce(new Promise(() => undefined));
    h.getLinearProjectIssues.mockReturnValueOnce(new Promise(() => undefined));

    rerender({ projectId: 'project-B' });

    // B is being read: nothing of A.
    expect(result.current.jira).toEqual({ configured: false, allowedBranches: [] });
    expect(result.current.linear).toEqual({ connected: true, configured: false, allowedBranches: [] });
    expect(result.current.ticketsByVulnerability.size).toBe(0);
    expect(branchAllowed(result.current, 'jira', 'main')).toBe(false);

    await act(async () => {
      jiraB.resolve({ ...jiraConfig, jiraProjectKey: 'OPS', allowedBranches: [] });
      await settle();
    });
    expect(result.current.jira).toEqual({ configured: true, projectKey: 'OPS', allowedBranches: [] });
  });

  it('maps Linear state types to categories', async () => {
    h.getLinearProjectIssues.mockResolvedValue({
      success: true,
      issues: [
        linearIssue({ linearIdentifier: 'ENG-1', vulnerabilityIds: ['backlog'], linearStateType: 'backlog' }),
        linearIssue({ linearIdentifier: 'ENG-2', vulnerabilityIds: ['unstarted'], linearStateType: 'unstarted' }),
        linearIssue({ linearIdentifier: 'ENG-3', vulnerabilityIds: ['started'], linearStateType: 'started' }),
        linearIssue({ linearIdentifier: 'ENG-4', vulnerabilityIds: ['completed'], linearStateType: 'completed' }),
        linearIssue({ linearIdentifier: 'ENG-5', vulnerabilityIds: ['canceled'], linearStateType: 'canceled' }),
        // A ticket removed in Linear is stored with the state `deleted`.
        linearIssue({ linearIdentifier: 'ENG-6', vulnerabilityIds: ['deleted'], state: 'deleted', linearStateType: 'started' }),
      ],
    });

    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: false, isLinearLinked: true }));
    await waitFor(() => expect(result.current.ticketsByVulnerability.size).toBe(6));

    const category = (id: string) => result.current.ticketsByVulnerability.get(id)?.[0].statusCategory;
    expect(category('backlog')).toBe('new');
    expect(category('unstarted')).toBe('new');
    expect(category('started')).toBe('indeterminate');
    expect(category('completed')).toBe('done');
    expect(category('canceled')).toBe('done');
    expect(category('deleted')).toBe('done');
    expect(h.getJiraProjectIssues).not.toHaveBeenCalled();
  });

  it('reads the Linear identifier from the ticket URL when the identifier is absent', async () => {
    h.getLinearProjectIssues.mockResolvedValue({
      success: true,
      issues: [linearIssue({ linearIdentifier: undefined, vulnerabilityIds: ['v-9'] })],
    });

    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: false, isLinearLinked: true }));
    await waitFor(() => expect(result.current.ticketsByVulnerability.get('v-9')?.[0].key).toBe('ENG-7'));
  });

  it('reads both tools again on refresh', async () => {
    const { result } = renderHook(() => useIssueTracking(P, { isJiraLinked: true, isLinearLinked: true }));
    await waitFor(() => expect(result.current.anyConfigured).toBe(true));
    h.getJiraProjectIssues.mockResolvedValue({ success: true, issues: [] });
    h.getLinearProjectIssues.mockResolvedValue({ success: true, issues: [] });

    await result.current.refresh();

    await waitFor(() => expect(result.current.ticketsByVulnerability.size).toBe(0));
    expect(h.getJiraProjectIssues).toHaveBeenCalledTimes(2);
    expect(h.getLinearProjectIssues).toHaveBeenCalledTimes(2);
  });
});

const ticket = (provider: TrackedTicket['provider'], key: string): TrackedTicket => ({
  provider,
  key,
  url: `https://example.test/${key}`,
  status: 'Todo',
  statusCategory: 'new',
});

const trackingWith = (over: Partial<IssueTracking> = {}): IssueTracking => ({
  organizationId: 'org-1',
  ticketsByVulnerability: new Map(),
  jira: { configured: true, projectKey: 'KAN', allowedBranches: [] },
  linear: { connected: true, configured: true, config: linearConfig, allowedBranches: [] },
  anyConfigured: true,
  refresh: async () => undefined,
  ...over,
});

describe('groupTicketsOf', () => {
  const kan1 = ticket('jira', 'KAN-1');
  const eng7 = ticket('linear', 'ENG-7');
  const tickets = new Map<string, TrackedTicket[]>([
    ['v-1', [kan1]],
    ['v-2', [kan1, eng7]],
  ]);

  it('groupTicketsOf lists unlinked occurrences per configured provider', () => {
    const group = groupTicketsOf(trackingWith({ ticketsByVulnerability: tickets }), ['v-1', 'v-2', 'v-3']);

    expect(group.tickets).toEqual([
      { ...kan1, linkedVulnerabilityIds: ['v-1', 'v-2'] },
      { ...eng7, linkedVulnerabilityIds: ['v-2'] },
    ]);
    expect(group.unlinkedByProvider).toEqual({ jira: ['v-3'], linear: ['v-1', 'v-3'] });
    expect(group.totalOccurrences).toBe(3);
  });

  it('lists no unlinked occurrence for a tool that cannot take a ticket', () => {
    const tracking = trackingWith({
      ticketsByVulnerability: tickets,
      jira: { configured: false, allowedBranches: [] },
      linear: { connected: false, configured: false, allowedBranches: [] },
    });

    const group = groupTicketsOf(tracking, ['v-1', 'v-2', 'v-3']);

    expect(group.unlinkedByProvider).toEqual({ jira: [], linear: [] });
    // Their tickets are still shown.
    expect(group.tickets.map((t) => t.key)).toEqual(['KAN-1', 'ENG-7']);
  });

  // The server's duplicate check ignores a closed or deleted ticket: a new one
  // can be created for the occurrence, and the closed one stays listed.
  it('counts an occurrence whose only tickets of a tool are closed or deleted as unlinked for that tool', () => {
    const doneJira: TrackedTicket = { ...ticket('jira', 'KAN-9'), status: 'Done', statusCategory: 'done' };
    const canceledLinear: TrackedTicket = { ...ticket('linear', 'ENG-8'), status: 'Canceled', statusCategory: 'done' };
    const deletedLinear: TrackedTicket = { ...ticket('linear', 'ENG-6'), status: 'deleted', statusCategory: 'done' };
    const tracking = trackingWith({
      ticketsByVulnerability: new Map<string, TrackedTicket[]>([
        ['v-1', [doneJira, canceledLinear]],
        ['v-2', [deletedLinear]],
        ['v-3', [kan1, canceledLinear, eng7]],
      ]),
    });

    const group = groupTicketsOf(tracking, ['v-1', 'v-2', 'v-3']);

    expect(group.unlinkedByProvider).toEqual({ jira: ['v-1', 'v-2'], linear: ['v-1', 'v-2'] });
    expect(group.tickets.map((t) => t.key)).toEqual(['KAN-9', 'ENG-8', 'ENG-6', 'KAN-1', 'ENG-7']);
  });

  it('lists the unlinked occurrences of a connected Linear without project settings', () => {
    const tracking = trackingWith({
      ticketsByVulnerability: tickets,
      linear: { connected: true, configured: false, allowedBranches: [] },
    });

    const group = groupTicketsOf(tracking, ['v-1', 'v-2', 'v-3']);

    expect(group.unlinkedByProvider.linear).toEqual(['v-1', 'v-3']);
  });
});

describe('branchAllowed', () => {
  it("branchAllowed honours each provider's allowed branches", () => {
    const tracking = trackingWith({
      jira: { configured: true, projectKey: 'KAN', allowedBranches: [] },
      linear: { connected: true, configured: true, config: linearConfig, allowedBranches: ['main', 'release'] },
    });

    expect(branchAllowed(tracking, 'jira', 'feature/x')).toBe(true);
    expect(branchAllowed(tracking, 'jira')).toBe(true);
    expect(branchAllowed(tracking, 'linear', 'main')).toBe(true);
    expect(branchAllowed(tracking, 'linear', 'release')).toBe(true);
    expect(branchAllowed(tracking, 'linear', 'feature/x')).toBe(false);
    expect(branchAllowed(tracking, 'linear')).toBe(false);
  });

  it('allows no branch for a tool that cannot take a ticket', () => {
    const tracking = trackingWith({
      jira: { configured: false, allowedBranches: [] },
      linear: { connected: false, configured: false, allowedBranches: [] },
    });

    expect(branchAllowed(tracking, 'jira', 'main')).toBe(false);
    expect(branchAllowed(tracking, 'linear', 'main')).toBe(false);
  });

  it('allows every branch for a connected Linear without project settings', () => {
    const tracking = trackingWith({ linear: { connected: true, configured: false, allowedBranches: [] } });

    expect(branchAllowed(tracking, 'linear', 'feature/x')).toBe(true);
  });
});

describe('ticketToolAvailable', () => {
  it('takes Jira once configured for the project and Linear once connected to the organisation', () => {
    expect(ticketToolAvailable(trackingWith({ jira: { configured: false, allowedBranches: [] } }), 'jira')).toBe(false);
    expect(ticketToolAvailable(trackingWith(), 'jira')).toBe(true);
    expect(
      ticketToolAvailable(trackingWith({ linear: { connected: true, configured: false, allowedBranches: [] } }), 'linear'),
    ).toBe(true);
    expect(
      ticketToolAvailable(trackingWith({ linear: { connected: false, configured: false, allowedBranches: [] } }), 'linear'),
    ).toBe(false);
  });
});

describe('trackingForBranch', () => {
  const tickets = new Map<string, TrackedTicket[]>([['v-1', [ticket('jira', 'KAN-1')]]]);

  it('offers on a finding only the tools allowed on its branch, and keeps every ticket', () => {
    const tracking = trackingWith({
      ticketsByVulnerability: tickets,
      jira: { configured: true, projectKey: 'KAN', allowedBranches: ['main'] },
      linear: { connected: true, configured: false, allowedBranches: [] },
    });

    const onFeature = trackingForBranch(tracking, 'feature/x');

    expect(ticketToolAvailable(onFeature, 'jira')).toBe(false);
    expect(ticketToolAvailable(onFeature, 'linear')).toBe(true);
    expect(onFeature.anyConfigured).toBe(true);
    // The Jira ticket already linked is still shown.
    expect(onFeature.ticketsByVulnerability).toBe(tickets);
    expect(onFeature.refresh).toBe(tracking.refresh);
  });

  it('hands the tracking back unchanged when every tool is allowed on the branch', () => {
    const tracking = trackingWith({ jira: { configured: true, projectKey: 'KAN', allowedBranches: ['main'] } });

    expect(trackingForBranch(tracking, 'main')).toBe(tracking);
  });

  it('offers no tool when none is allowed on the branch', () => {
    const tracking = trackingWith({
      jira: { configured: true, projectKey: 'KAN', allowedBranches: ['main'] },
      linear: { connected: true, configured: true, config: linearConfig, allowedBranches: ['release'] },
    });

    const onFeature = trackingForBranch(tracking, 'feature/x');

    expect(ticketToolAvailable(onFeature, 'jira')).toBe(false);
    expect(ticketToolAvailable(onFeature, 'linear')).toBe(false);
    expect(onFeature.anyConfigured).toBe(false);
  });
});
