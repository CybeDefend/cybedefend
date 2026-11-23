import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import {
  getJiraProjectIssues,
  getProjectJiraConfig,
  type JiraIssueInfo,
} from "@/server/services/integrations/jiraIntegrationsService";
import {
  getLinearProjectIssues,
  getProjectLinearConfig,
  type LinearIssueInfo,
  type LinearProjectConfig,
} from "@/server/services/integrations/linearIntegrationsService";

export type TicketProvider = "jira" | "linear";

/** The ticket tools, in the order they are listed. */
export const TICKET_PROVIDERS: readonly TicketProvider[] = ["jira", "linear"];

export type TicketStatusCategory = "new" | "indeterminate" | "done";

/** A ticket of either tool, as the results pages show it. */
export interface TrackedTicket {
  provider: TicketProvider;
  /** KAN-12 for Jira, ENG-142 for Linear. */
  key: string;
  url: string;
  /** The state name the tool shows (« In Progress »). */
  status: string;
  statusCategory: TicketStatusCategory;
  priority?: string;
  assignee?: string;
  /** The Jira project key or the Linear team key. */
  container?: string;
}

/** What a ticket is written from: an occurrence as the results pages hold it. */
export interface TicketVulnerability {
  vulnerabilityId: string;
  scannerType: string;
  severity: string;
  name: string;
  shortDescription?: string;
  filePath?: string;
  startLine?: number;
  packageName?: string;
  packageVersion?: string;
  externalId?: string;
  branch?: string;
  /** CWE identifiers, which the issue detail sends. */
  cwe?: string[];
}

export interface IssueTracking {
  organizationId: string;
  /** Every ticket of every linked tool, by vulnerability id (Jira first). */
  ticketsByVulnerability: Map<string, TrackedTicket[]>;
  jira: { configured: boolean; projectKey?: string; allowedBranches: string[] };
  /**
   * `connected`: Linear is connected to the organisation (`isLinearLinked`).
   * `configured`: the project also has Linear settings (team, project,
   * labels, branches). A ticket can be created as soon as Linear is
   * connected: without settings, its form asks for a team.
   */
  linear: { connected: boolean; configured: boolean; config?: LinearProjectConfig; allowedBranches: string[] };
  /**
   * At least one tool can take a ticket for this project: Jira configured for
   * it, or Linear connected to the organisation (`ticketToolAvailable`).
   */
  anyConfigured: boolean;
  refresh: () => Promise<void>;
}

type JiraSide = IssueTracking["jira"];
/** What is read of the project's Linear settings; `connected` comes from the link. */
type LinearSettings = Omit<IssueTracking["linear"], "connected">;

/** What is read of one tool for one project: its settings and its tickets. */
interface ToolRead<Side> {
  /** The organisation and project the read belongs to; another one's read is never shown. */
  scope: string;
  side: Side;
  links: Array<{ ticket: TrackedTicket; vulnerabilityIds: string[] }>;
}

const scopeOf = (organizationId: string, projectId: string): string => `${organizationId}/${projectId}`;

const NO_JIRA: ToolRead<JiraSide> = { scope: "", side: { configured: false, allowedBranches: [] }, links: [] };
const NO_LINEAR: ToolRead<LinearSettings> = { scope: "", side: { configured: false, allowedBranches: [] }, links: [] };

// ========== Jira ==========

/** The key of a Jira issue: from its /browse/ URL, else from the start of its title. */
const jiraKeyOf = (issue: JiraIssueInfo): string =>
  issue.url?.split("/browse/")[1] || issue.title?.match(/^([A-Z]+-\d+)/)?.[1] || "";

/** The category of a Jira state, as the Jira-only tracker derived it. */
const jiraCategoryOf = (state: string | undefined): TicketStatusCategory => {
  const name = (state || "").toLowerCase();
  if (name === "done" || name === "closed" || name === "resolved") return "done";
  if (name !== "open" && name !== "to do" && name !== "") return "indeterminate";
  return "new";
};

const readJira = async (organizationId: string, projectId: string): Promise<ToolRead<JiraSide>> => {
  const [config, issues] = await Promise.all([
    getProjectJiraConfig(organizationId, projectId).catch(() => null),
    getJiraProjectIssues(organizationId, projectId)
      .then((response) => response.issues ?? [])
      .catch((): JiraIssueInfo[] => []),
  ]);

  const side: JiraSide = config?.isConfigured
    ? { configured: true, projectKey: config.jiraProjectKey, allowedBranches: config.allowedBranches ?? [] }
    : NO_JIRA.side;

  const links = issues.flatMap((issue) => {
    const key = jiraKeyOf(issue);
    if (!key) return [];
    const ticket: TrackedTicket = {
      provider: "jira",
      key,
      url: issue.url,
      status: issue.state || "",
      statusCategory: jiraCategoryOf(issue.state),
      priority: issue.jiraPriority,
      assignee: issue.jiraAssignee,
      container: issue.jiraProjectKey,
    };
    return [{ ticket, vulnerabilityIds: issue.vulnerabilityIds ?? [] }];
  });

  return { scope: scopeOf(organizationId, projectId), side, links };
};

// ========== Linear ==========

const LINEAR_CATEGORY: Record<string, TicketStatusCategory> = {
  backlog: "new",
  unstarted: "new",
  started: "indeterminate",
  completed: "done",
  canceled: "done",
};

/** The category of a Linear ticket from its state type; a ticket removed in Linear is stored `deleted`. */
const linearCategoryOf = (issue: LinearIssueInfo): TicketStatusCategory =>
  (issue.state || "").toLowerCase() === "deleted"
    ? "done"
    : LINEAR_CATEGORY[(issue.linearStateType || "").toLowerCase()] ?? "new";

/** The identifier of a Linear ticket (ENG-142), else the one in its linear.app URL. */
const linearKeyOf = (issue: LinearIssueInfo): string =>
  issue.linearIdentifier || issue.url?.match(/\/issue\/([A-Za-z0-9]+-\d+)/)?.[1] || "";

const readLinear = async (organizationId: string, projectId: string): Promise<ToolRead<LinearSettings>> => {
  const [config, issues] = await Promise.all([
    getProjectLinearConfig(organizationId, projectId).catch(() => null),
    getLinearProjectIssues(organizationId, projectId)
      .then((response) => response.issues ?? [])
      .catch((): LinearIssueInfo[] => []),
  ]);

  const side: LinearSettings = config?.isConfigured
    ? { configured: true, config, allowedBranches: config.allowedBranches ?? [] }
    : NO_LINEAR.side;

  const links = issues.flatMap((issue) => {
    const key = linearKeyOf(issue);
    if (!key) return [];
    const ticket: TrackedTicket = {
      provider: "linear",
      key,
      url: issue.url,
      status: issue.state || "",
      statusCategory: linearCategoryOf(issue),
      priority: issue.linearPriority,
      assignee: issue.linearAssignee,
      container: issue.linearTeamKey,
    };
    return [{ ticket, vulnerabilityIds: issue.vulnerabilityIds ?? [] }];
  });

  return { scope: scopeOf(organizationId, projectId), side, links };
};

// ========== Hook ==========

/**
 * The Jira and Linear tickets of a project, and whether each tool is set up
 * for it.
 *
 * `links` come from the /project/:id payload. A tool is read only once its
 * link is `true`; `null` (the project is still loading) reads nothing, and
 * `false` (the tool is not linked to the organisation) clears what was read.
 * A tool's project settings count only when `isConfigured`; its tickets are
 * shown either way.
 *
 * What was read, or is being read, for one organisation and project is never
 * shown for another: a change of either drops the reads in flight and starts
 * from nothing, so a create on project B never carries project A's Jira key,
 * team or branches.
 */
export function useIssueTracking(
  projectId: string,
  links: { isJiraLinked: boolean | null; isLinearLinked: boolean | null },
): IssueTracking {
  const organizationId = useSelector((state: RootState) => state.organization.selectedOrganization?.id) || "";
  const { isJiraLinked, isLinearLinked } = links;
  const scope = scopeOf(organizationId, projectId);

  const [jira, setJira] = useState<ToolRead<JiraSide>>(NO_JIRA);
  const [linear, setLinear] = useState<ToolRead<LinearSettings>>(NO_LINEAR);
  // Only the latest read of a tool may land: a slower, older answer is dropped.
  const jiraRead = useRef(0);
  const linearRead = useRef(0);

  // Another organisation or project: drop what is in flight, start from nothing.
  // Declared before the reads, so it runs before the next project's reads start.
  useEffect(() => {
    jiraRead.current += 1;
    linearRead.current += 1;
    setJira(NO_JIRA);
    setLinear(NO_LINEAR);
  }, [scope]);

  const loadJira = useCallback(async () => {
    if (!organizationId || !projectId || isJiraLinked !== true) {
      // Nothing to read now: whatever is in flight no longer applies.
      jiraRead.current += 1;
      if (isJiraLinked === false) setJira(NO_JIRA);
      return;
    }
    const read = ++jiraRead.current;
    const result = await readJira(organizationId, projectId);
    if (read === jiraRead.current) setJira(result);
  }, [organizationId, projectId, isJiraLinked]);

  const loadLinear = useCallback(async () => {
    if (!organizationId || !projectId || isLinearLinked !== true) {
      linearRead.current += 1;
      if (isLinearLinked === false) setLinear(NO_LINEAR);
      return;
    }
    const read = ++linearRead.current;
    const result = await readLinear(organizationId, projectId);
    if (read === linearRead.current) setLinear(result);
  }, [organizationId, projectId, isLinearLinked]);

  useEffect(() => {
    void loadJira();
  }, [loadJira]);

  useEffect(() => {
    void loadLinear();
  }, [loadLinear]);

  const refresh = useCallback(async () => {
    await Promise.all([loadJira(), loadLinear()]);
  }, [loadJira, loadLinear]);

  // The render that follows a project change still holds the previous
  // project's state (the reset above runs after it): never show it.
  const jiraNow = jira.scope === scope ? jira : NO_JIRA;
  const linearNow = linear.scope === scope ? linear : NO_LINEAR;
  const linearConnected = isLinearLinked === true && !!organizationId && !!projectId;

  const ticketsByVulnerability = useMemo(() => {
    const map = new Map<string, TrackedTicket[]>();
    for (const { ticket, vulnerabilityIds } of [...jiraNow.links, ...linearNow.links]) {
      for (const id of vulnerabilityIds) {
        const list = map.get(id);
        if (!list) map.set(id, [ticket]);
        else if (!list.some((t) => t.provider === ticket.provider && t.key === ticket.key)) list.push(ticket);
      }
    }
    return map;
  }, [jiraNow.links, linearNow.links]);

  const linearSide = useMemo(
    () => ({ connected: linearConnected, ...linearNow.side }),
    [linearConnected, linearNow.side],
  );

  return useMemo(
    () => ({
      organizationId,
      ticketsByVulnerability,
      jira: jiraNow.side,
      linear: linearSide,
      anyConfigured: jiraNow.side.configured || linearSide.connected,
      refresh,
    }),
    [organizationId, ticketsByVulnerability, jiraNow.side, linearSide, refresh],
  );
}

/**
 * Whether a tool can take a ticket for this project: Jira once the project
 * names its Jira project, Linear as soon as the organisation has it connected
 * (without project settings, the ticket form asks for a team).
 */
export function ticketToolAvailable(tracking: IssueTracking, provider: TicketProvider): boolean {
  return provider === "jira" ? tracking.jira.configured : tracking.linear.connected;
}

// ========== Helpers ==========

export interface GroupTickets {
  /** Each ticket once, with the occurrences of the group it is linked to. */
  tickets: Array<TrackedTicket & { linkedVulnerabilityIds: string[] }>;
  /** For each tool that can take a ticket, the occurrences without an open ticket of that tool. */
  unlinkedByProvider: Record<TicketProvider, string[]>;
  totalOccurrences: number;
}

/**
 * A closed ticket (category `done`), or a Linear ticket deleted in Linear: the
 * server's duplicate check ignores it, so a new ticket can be created.
 */
const isTerminalTicket = (ticket: TrackedTicket): boolean =>
  ticket.statusCategory === "done" || (ticket.provider === "linear" && ticket.status.toLowerCase() === "deleted");

/**
 * The tickets of a group of occurrences. The tools are independent: an
 * occurrence linked to a Jira ticket still has no Linear ticket. An occurrence
 * whose tickets of a tool are all closed or deleted counts as unlinked for that
 * tool, and those tickets are still listed. A tool that cannot take a ticket
 * (`ticketToolAvailable`) lists no unlinked occurrence, but its tickets are
 * listed.
 */
export function groupTicketsOf(tracking: IssueTracking, occurrenceIds: string[]): GroupTickets {
  const tickets = new Map<string, TrackedTicket & { linkedVulnerabilityIds: string[] }>();
  const unlinkedByProvider: Record<TicketProvider, string[]> = { jira: [], linear: [] };

  for (const id of occurrenceIds) {
    const linked = tracking.ticketsByVulnerability.get(id) ?? [];
    for (const ticket of linked) {
      const ticketId = `${ticket.provider}:${ticket.key}`;
      const existing = tickets.get(ticketId);
      if (existing) existing.linkedVulnerabilityIds.push(id);
      else tickets.set(ticketId, { ...ticket, linkedVulnerabilityIds: [id] });
    }
    for (const provider of TICKET_PROVIDERS) {
      if (
        ticketToolAvailable(tracking, provider) &&
        !linked.some((t) => t.provider === provider && !isTerminalTicket(t))
      ) {
        unlinkedByProvider[provider].push(id);
      }
    }
  }

  return { tickets: [...tickets.values()], unlinkedByProvider, totalOccurrences: occurrenceIds.length };
}

/**
 * Whether a tool may take a ticket for a finding of this branch: the tool can
 * take a ticket (`ticketToolAvailable`), and its project settings name no
 * branch or name this one. A connected Linear without settings names none.
 */
export function branchAllowed(tracking: IssueTracking, provider: TicketProvider, branch?: string): boolean {
  if (!ticketToolAvailable(tracking, provider)) return false;
  const { allowedBranches } = tracking[provider];
  return allowedBranches.length === 0 || (branch !== undefined && allowedBranches.includes(branch));
}

/**
 * The tracking of one finding: a tool whose project settings name other
 * branches cannot take a ticket for it (`branchAllowed`). Its tickets are
 * still listed. The same object when every tool is allowed on the branch.
 */
export function trackingForBranch(tracking: IssueTracking, branch?: string): IssueTracking {
  const jira = branchAllowed(tracking, "jira", branch);
  const linear = branchAllowed(tracking, "linear", branch);
  if (jira === ticketToolAvailable(tracking, "jira") && linear === ticketToolAvailable(tracking, "linear")) {
    return tracking;
  }
  return {
    ...tracking,
    jira: jira ? tracking.jira : { ...tracking.jira, configured: false },
    linear: linear ? tracking.linear : { ...tracking.linear, connected: false },
    anyConfigured: jira || linear,
  };
}

export default useIssueTracking;
