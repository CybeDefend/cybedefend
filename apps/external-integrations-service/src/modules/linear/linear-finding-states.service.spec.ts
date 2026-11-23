import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { FindOperator } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { LinearFindingStatesService } from './linear-finding-states.service';
import { LinearService } from './linear.service';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { createLoggerMock } from '../../test-utils/mocks';

const PROJECT = 'project-1';
const WORKSPACE = 'lin-workspace-1';
const OTHER_WORKSPACE = 'lin-workspace-2';
const EARLIER = new Date('2026-10-20T08:00:00.000Z');

type Row = VulnerabilityIssueMapping;
type Where = Record<string, unknown>;

interface LinearState {
  id: string;
  name: string;
  type: string;
  position: number;
}

interface FakeIssue {
  state: { name: string; type: string };
  teamStates: LinearState[];
}

interface LinearCallRecord {
  query: string;
  variables?: Record<string, unknown>;
  options?: { retryOnServerError?: boolean };
  integration: LinearIntegration;
}

// The states of a Linear team, deliberately out of position order.
const ENG_STATES: LinearState[] = [
  { id: 'eng-done-late', name: 'Released', type: 'completed', position: 9 },
  { id: 'eng-todo', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'eng-done', name: 'Done', type: 'completed', position: 5 },
  { id: 'eng-dup', name: 'Duplicate', type: 'canceled', position: 8 },
  { id: 'eng-canceled', name: 'Canceled', type: 'canceled', position: 6 },
  { id: 'eng-backlog', name: 'Backlog', type: 'backlog', position: 0 },
];

const OPS_STATES: LinearState[] = [
  { id: 'ops-shipped', name: 'Shipped', type: 'completed', position: 3 },
  { id: 'ops-wontdo', name: "Won't do", type: 'canceled', position: 4 },
  { id: 'ops-todo', name: 'Todo', type: 'unstarted', position: 1 },
];

/**
 * Does a stored value satisfy one TypeORM where value (In, IsNull, Not)? As in
 * SQL, NULL matches nothing but IS NULL: `NULL != x` and `NOT(NULL IN (...))`
 * are not true.
 */
function matchesValue(actual: unknown, expected: unknown): boolean {
  const isNull = actual === null || actual === undefined;
  if (expected instanceof FindOperator) {
    switch (expected.type) {
      case 'in':
        return (expected.value as unknown[]).includes(actual);
      case 'isNull':
        return isNull;
      case 'not':
        if (isNull) return false;
        return expected.child
          ? !matchesValue(actual, expected.child)
          : actual !== expected.value;
      default:
        throw new Error(`Unsupported operator in fake: ${expected.type}`);
    }
  }
  return actual === expected;
}

/** One where object, or an array of them (OR), as TypeORM reads it. */
function matches(row: Row, where: Where | Where[]): boolean {
  const alternatives = Array.isArray(where) ? where : [where];
  return alternatives.some((one) =>
    Object.entries(one).every(([key, expected]) =>
      matchesValue((row as unknown as Where)[key], expected),
    ),
  );
}

describe('LinearFindingStatesService', () => {
  let service: LinearFindingStatesService;
  let rows: Row[];
  let integrations: LinearIntegration[];
  let issues: Map<string, FakeIssue>;
  let calls: LinearCallRecord[];
  let failingIssues: Set<string>;
  // What a failing issue's Linear calls throw.
  let failure: unknown;
  let onIssueUpdate: (issueId: string) => void;
  let logger: Logger;

  let issueMappingRepo: { find: jest.Mock; update: jest.Mock };
  let integrationRepo: { findOne: jest.Mock };

  let nextId = 0;
  const row = (overrides: Partial<Row>): Row =>
    ({
      id: `row-${++nextId}`,
      projectId: PROJECT,
      vulnerabilityId: `vuln-${nextId}`,
      scannerType: 'sast',
      platform: IssuePlatform.LINEAR,
      externalIssueId: 'issue-1',
      issueUrl: 'https://linear.app/acme/issue/ENG-1',
      issueTitle: 'SQL injection',
      issueState: 'Todo',
      linearStateType: 'unstarted',
      linearOrganizationId: WORKSPACE,
      linearTeamKey: 'ENG',
      linearIdentifier: 'ENG-1',
      creationMode: 'per_vulnerability_type',
      groupKey: 'src/db/query.ts',
      doneAt: null,
      doneReason: null,
      ...overrides,
    }) as Row;

  const openIssue = (id: string, teamStates = ENG_STATES) =>
    issues.set(id, {
      state: { name: 'Todo', type: 'unstarted' },
      teamStates,
    });

  const apply = (
    vulnerabilityIds: string[],
    outcome: string,
    reason = '',
    projectId = PROJECT,
  ) =>
    service.applyFindingStates({
      projectId,
      vulnerabilityIds,
      outcome,
      reason,
    });

  const callsTo = (field: string) =>
    calls.filter(({ query }) => query.includes(`${field}(`));
  const reads = () => callsTo('issue');
  const stateChanges = () => callsTo('issueUpdate');
  const comments = () => callsTo('commentCreate');
  const commentBody = (call: LinearCallRecord) =>
    (call.variables.input as { body: string }).body;
  const rowById = (id: string) => rows.find((r) => r.id === id);

  beforeEach(async () => {
    nextId = 0;
    rows = [];
    calls = [];
    failingIssues = new Set();
    failure = new RpcException({
      code: status.UNAVAILABLE,
      message: 'Linear is unavailable',
    });
    onIssueUpdate = () => undefined;
    issues = new Map();
    integrations = [
      {
        id: 'integration-1',
        organizationId: 'org-1',
        linearOrganizationId: WORKSPACE,
        needsReconnect: false,
      } as LinearIntegration,
    ];

    issueMappingRepo = {
      find: jest.fn(async ({ where }: { where: Where | Where[] }) =>
        rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      ),
      update: jest.fn(
        async (criteria: Where | Where[], changes: Partial<Row>) => {
          const hit = rows.filter((r) => matches(r, criteria));
          for (const r of hit) Object.assign(r, changes);
          return { affected: hit.length, raw: [], generatedMaps: [] };
        },
      ),
    };
    integrationRepo = {
      findOne: jest.fn(
        async ({ where }: { where: Partial<LinearIntegration> }) =>
          integrations.find(
            (i) => i.linearOrganizationId === where.linearOrganizationId,
          ) ?? null,
      ),
    };

    const linearService = {
      linearCall: jest.fn(
        async (
          integration: LinearIntegration,
          query: string,
          variables?: Record<string, unknown>,
          options?: { retryOnServerError?: boolean },
        ) => {
          calls.push({ query, variables, options, integration });
          if (query.includes('issueUpdate(')) {
            const issueId = variables.id as string;
            if (failingIssues.has(issueId)) throw failure;
            const { stateId } = variables.input as { stateId: string };
            const issue = issues.get(issueId);
            const state = issue.teamStates.find((s) => s.id === stateId);
            issue.state = { name: state.name, type: state.type };
            onIssueUpdate(issueId);
            return { issueUpdate: { success: true } };
          }
          if (query.includes('commentCreate(')) {
            return { commentCreate: { success: true } };
          }
          if (query.includes('issue(')) {
            const issueId = variables.id as string;
            if (failingIssues.has(issueId)) throw failure;
            const issue = issues.get(issueId);
            return {
              issue: issue
                ? {
                    state: issue.state,
                    team: { states: { nodes: issue.teamStates } },
                  }
                : null,
            };
          }
          throw new Error(`Unexpected Linear call: ${query}`);
        },
      ),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinearFindingStatesService,
        {
          provide: getRepositoryToken(VulnerabilityIssueMapping),
          useValue: issueMappingRepo,
        },
        {
          provide: getRepositoryToken(LinearIntegration),
          useValue: integrationRepo,
        },
        { provide: LinearService, useValue: linearService },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    service = module.get(LinearFindingStatesService);
  });

  it('does nothing without Linear rows for these vulnerabilities', async () => {
    rows.push(
      row({ vulnerabilityId: 'vuln-jira', platform: IssuePlatform.JIRA }),
      row({ vulnerabilityId: 'vuln-other-project', projectId: 'project-2' }),
    );

    await expect(
      apply(['vuln-jira', 'vuln-other-project', 'vuln-unknown'], 'fixed'),
    ).resolves.toEqual({ closed: 0, commented: 0 });

    expect(calls).toHaveLength(0);
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
  });

  it('closes a CybeDefend ticket as completed when every finding is handled and one was fixed', async () => {
    openIssue('issue-1');
    const ignored = row({
      vulnerabilityId: 'vuln-a',
      doneAt: EARLIER,
      doneReason: 'ignored',
    });
    const fixed = row({ vulnerabilityId: 'vuln-b' });
    rows.push(ignored, fixed);

    await expect(
      apply(['vuln-b'], 'fixed', 'file_deleted_or_fixed'),
    ).resolves.toEqual({ closed: 1, commented: 0 });

    // The first completed state by position, not the first listed.
    expect(stateChanges()).toHaveLength(1);
    expect(stateChanges()[0].variables).toEqual({
      id: 'issue-1',
      input: { stateId: 'eng-done' },
    });
    expect(stateChanges()[0].options?.retryOnServerError).not.toBe(false);

    expect(comments()).toHaveLength(1);
    expect(comments()[0].variables.input).toEqual({
      issueId: 'issue-1',
      body: 'Handled in CybeDefend: 1 fixed, 1 ignored.',
    });
    // A comment is not idempotent: never retried on a server error.
    expect(comments()[0].options).toEqual({ retryOnServerError: false });

    const fixedRow = rowById(fixed.id);
    expect(fixedRow.doneAt).toBeInstanceOf(Date);
    expect(fixedRow.doneReason).toBe('fixed');
    for (const r of rows) {
      expect(r.issueState).toBe('Done');
      expect(r.linearStateType).toBe('completed');
    }
    expect(rowById(ignored.id).doneReason).toBe('ignored');
    expect(rowById(ignored.id).doneAt).toEqual(EARLIER);
  });

  it('records the close on rows that have no Linear state type yet', async () => {
    // linearStateType is NULL until a webhook or a sync fills it: the closing
    // record must still claim those rows (NULL is not "not terminal" in SQL).
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a', linearStateType: null }),
      row({ vulnerabilityId: 'vuln-b', linearStateType: null }),
    );

    await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
      closed: 1,
      commented: 0,
    });

    expect(comments()).toHaveLength(1);
    for (const r of rows) {
      expect(r.issueState).toBe('Done');
      expect(r.linearStateType).toBe('completed');
    }
  });

  it('closes as canceled when every finding was ignored', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a' }),
      row({ vulnerabilityId: 'vuln-b' }),
    );

    await expect(
      apply(['vuln-a', 'vuln-b'], 'ignored', 'Accepted risk'),
    ).resolves.toEqual({ closed: 1, commented: 0 });

    expect(stateChanges()).toHaveLength(1);
    expect(stateChanges()[0].variables.input).toEqual({
      stateId: 'eng-canceled',
    });
    expect(comments()).toHaveLength(1);
    expect(commentBody(comments()[0])).toBe(
      [
        'Handled in CybeDefend: 0 fixed, 2 ignored.',
        '',
        'Dismissal reasons:',
        '- Accepted risk',
      ].join('\n'),
    );
    for (const r of rows) {
      expect(r.doneReason).toBe('ignored');
      expect(r.issueState).toBe('Canceled');
      expect(r.linearStateType).toBe('canceled');
    }
  });

  it('comments once per ticket on a partial update and leaves it open', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a' }),
      row({ vulnerabilityId: 'vuln-b' }),
      row({ vulnerabilityId: 'vuln-c' }),
      row({ vulnerabilityId: 'vuln-d' }),
    );

    await expect(
      apply(['vuln-a', 'vuln-b', 'vuln-c'], 'fixed'),
    ).resolves.toEqual({ closed: 0, commented: 1 });

    expect(stateChanges()).toHaveLength(0);
    expect(comments()).toHaveLength(1);
    expect(commentBody(comments()[0])).toBe(
      [
        'Handled in CybeDefend: 3 findings fixed.',
        '3 of 4 findings linked to this issue are handled.',
      ].join('\n'),
    );
    expect(comments()[0].options).toEqual({ retryOnServerError: false });
    for (const r of rows) expect(r.linearStateType).toBe('unstarted');
  });

  it('only comments on a linked ticket, never changes its state', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a', creationMode: 'linked' }),
      row({ vulnerabilityId: 'vuln-b', creationMode: 'linked' }),
    );

    await expect(
      apply(['vuln-a', 'vuln-b'], 'ignored', 'False positive'),
    ).resolves.toEqual({ closed: 0, commented: 1 });

    expect(reads()).toHaveLength(0);
    expect(stateChanges()).toHaveLength(0);
    expect(comments()).toHaveLength(1);
    expect(commentBody(comments()[0])).toBe(
      [
        'Handled in CybeDefend: 2 findings ignored.',
        '2 of 2 findings linked to this issue are handled.',
        '',
        'Dismissal reasons:',
        '- False positive',
      ].join('\n'),
    );
  });

  // A ticket is CybeDefend's when any of its rows is not `linked`: new
  // occurrences are added to it by linking, and a ticket a person made in
  // Linear only ever has linked rows.
  it('closes a CybeDefend ticket that another project linked as well, once every finding is handled', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a' }),
      row({
        vulnerabilityId: 'vuln-elsewhere',
        projectId: 'project-2',
        creationMode: 'linked',
        doneAt: EARLIER,
        doneReason: 'fixed',
      }),
    );

    await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
      closed: 1,
      commented: 0,
    });
    expect(stateChanges()).toHaveLength(1);
    for (const r of rows) expect(r.linearStateType).toBe('completed');
  });

  it('closes a CybeDefend ticket whose new occurrences were linked to it, once all are handled', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a' }),
      row({ vulnerabilityId: 'vuln-b', creationMode: 'linked' }),
      row({ vulnerabilityId: 'vuln-c', creationMode: 'linked' }),
    );

    await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 1,
    });
    expect(stateChanges()).toHaveLength(0);

    await expect(apply(['vuln-c'], 'fixed')).resolves.toEqual({
      closed: 1,
      commented: 0,
    });
    expect(stateChanges()).toHaveLength(1);
    expect(commentBody(comments()[1])).toBe(
      'Handled in CybeDefend: 3 fixed, 0 ignored.',
    );
  });

  it('only comments on a ticket whose rows are all linked, even across projects', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a', creationMode: 'linked' }),
      row({
        vulnerabilityId: 'vuln-elsewhere',
        projectId: 'project-2',
        creationMode: 'linked',
        doneAt: EARLIER,
        doneReason: 'fixed',
      }),
    );

    await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 1,
    });
    expect(reads()).toHaveLength(0);
    expect(stateChanges()).toHaveLength(0);
  });

  it('leaves completed, canceled and deleted tickets alone', async () => {
    openIssue('issue-done');
    openIssue('issue-canceled');
    openIssue('issue-deleted');
    rows.push(
      row({
        vulnerabilityId: 'vuln-a',
        externalIssueId: 'issue-done',
        issueState: 'Done',
        linearStateType: 'completed',
      }),
      row({
        vulnerabilityId: 'vuln-b',
        externalIssueId: 'issue-canceled',
        issueState: 'Canceled',
        linearStateType: 'canceled',
      }),
      row({
        vulnerabilityId: 'vuln-c',
        externalIssueId: 'issue-deleted',
        issueState: 'deleted',
        linearStateType: 'started',
      }),
    );

    await expect(
      apply(['vuln-a', 'vuln-b', 'vuln-c'], 'fixed'),
    ).resolves.toEqual({ closed: 0, commented: 0 });

    expect(calls).toHaveLength(0);
    expect(rows.map((r) => r.issueState)).toEqual([
      'Done',
      'Canceled',
      'deleted',
    ]);
  });

  it('reopened clears doneAt so a later fix does not close the ticket early', async () => {
    openIssue('issue-1');
    const a = row({ vulnerabilityId: 'vuln-a' });
    const b = row({ vulnerabilityId: 'vuln-b' });
    rows.push(a, b);

    await apply(['vuln-a'], 'fixed');
    calls = [];

    await expect(apply(['vuln-a'], 'reopened')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });
    expect(calls).toHaveLength(0);
    expect(rowById(a.id).doneAt).toBeNull();
    expect(rowById(a.id).doneReason).toBeNull();

    await expect(apply(['vuln-b'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 1,
    });
    expect(stateChanges()).toHaveLength(0);
    expect(commentBody(comments()[0])).toBe(
      [
        'Handled in CybeDefend: 1 finding fixed.',
        '1 of 2 findings linked to this issue are handled.',
      ].join('\n'),
    );
  });

  it('reopened leaves the rows of a closed ticket and a finding that was not handled as they are', async () => {
    const closed = row({
      vulnerabilityId: 'vuln-a',
      externalIssueId: 'issue-done',
      issueState: 'Done',
      linearStateType: 'completed',
      doneAt: EARLIER,
      doneReason: 'fixed',
    });
    const open = row({ vulnerabilityId: 'vuln-b' });
    rows.push(closed, open);

    await expect(apply(['vuln-a', 'vuln-b'], 'reopened')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });

    expect(calls).toHaveLength(0);
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
    expect(rowById(closed.id).doneAt).toEqual(EARLIER);
    expect(rowById(closed.id).doneReason).toBe('fixed');
  });

  it('uses the team the ticket is in now', async () => {
    // Stored rows still say ENG; the ticket moved to OPS in Linear.
    openIssue('issue-1', OPS_STATES);
    rows.push(row({ vulnerabilityId: 'vuln-a', linearTeamKey: 'ENG' }));

    await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
      closed: 1,
      commented: 0,
    });

    expect(reads()).toHaveLength(1);
    expect(reads()[0].variables).toEqual({ id: 'issue-1' });
    expect(stateChanges()[0].variables.input).toEqual({
      stateId: 'ops-shipped',
    });
    expect(rows[0].issueState).toBe('Shipped');
  });

  it('a Linear error on one ticket does not stop the others', async () => {
    openIssue('issue-1');
    openIssue('issue-2');
    failingIssues.add('issue-1');
    failure = new RpcException({
      code: status.INTERNAL,
      message: 'Linear GraphQL error',
    });
    rows.push(
      row({ vulnerabilityId: 'vuln-a', externalIssueId: 'issue-1' }),
      row({ vulnerabilityId: 'vuln-b', externalIssueId: 'issue-2' }),
    );

    await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
      closed: 1,
      commented: 0,
    });

    expect(stateChanges().map((c) => c.variables.id)).toEqual(['issue-2']);
    // The failed ticket keeps its finding handled, and stays open: a ticket
    // is closed only by a call that handles one of its findings.
    expect(rows[0].doneAt).toBeInstanceOf(Date);
    expect(rows[0].linearStateType).toBe('unstarted');
    expect(rows[1].linearStateType).toBe('completed');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        linearOrganizationId: WORKSPACE,
        issueId: 'issue-1',
        code: status.INTERNAL,
      }),
      expect.any(String),
    );
  });

  // A slow or refusing Linear must not hold up the scan that reports.
  it.each([
    [
      'Linear is unavailable',
      () =>
        new RpcException({
          code: status.UNAVAILABLE,
          message: 'Linear is unavailable',
        }),
      status.UNAVAILABLE,
    ],
    [
      "Linear's rate limit is reached",
      () =>
        new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: 'Linear rate limit reached',
        }),
      status.RESOURCE_EXHAUSTED,
    ],
    [
      'the workspace must be reconnected',
      () =>
        new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'LINEAR_NEEDS_RECONNECT',
        }),
      status.FAILED_PRECONDITION,
    ],
  ])(
    'stops the remaining tickets of the call when %s, and logs it once',
    async (_case, error, code) => {
      failure = error();
      for (const id of ['issue-1', 'issue-2', 'issue-3']) openIssue(id);
      failingIssues.add('issue-1');
      rows.push(
        row({ vulnerabilityId: 'vuln-a', externalIssueId: 'issue-1' }),
        row({ vulnerabilityId: 'vuln-b', externalIssueId: 'issue-2' }),
        row({ vulnerabilityId: 'vuln-c', externalIssueId: 'issue-3' }),
      );

      await expect(
        apply(['vuln-a', 'vuln-b', 'vuln-c'], 'fixed'),
      ).resolves.toEqual({ closed: 0, commented: 0 });

      // One read of the first ticket, then nothing.
      expect(calls.map((c) => c.variables.id)).toEqual(['issue-1']);
      // The findings stay handled all the same.
      for (const r of rows) expect(r.doneReason).toBe('fixed');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linearOrganizationId: WORKSPACE,
          issueId: 'issue-1',
          code,
        }),
        expect.any(String),
      );
    },
  );

  describe('findings sent again in the state they already have', () => {
    it('a finding already handled the same way is not reported again', async () => {
      openIssue('issue-1');
      const done = row({
        vulnerabilityId: 'vuln-a',
        doneAt: EARLIER,
        doneReason: 'ignored',
      });
      rows.push(done, row({ vulnerabilityId: 'vuln-b' }));

      await expect(apply(['vuln-a'], 'ignored', 'Again')).resolves.toEqual({
        closed: 0,
        commented: 0,
      });

      expect(calls).toHaveLength(0);
      expect(rowById(done.id).doneAt).toEqual(EARLIER);
    });

    it('a finding ignored before and fixed now counts as handled by this call', async () => {
      openIssue('issue-1');
      const before = row({
        vulnerabilityId: 'vuln-a',
        doneAt: EARLIER,
        doneReason: 'ignored',
      });
      rows.push(before, row({ vulnerabilityId: 'vuln-b' }));

      await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
        closed: 0,
        commented: 1,
      });
      expect(rowById(before.id).doneReason).toBe('fixed');
      expect(commentBody(comments()[0])).toBe(
        [
          'Handled in CybeDefend: 1 finding fixed.',
          '1 of 2 findings linked to this issue are handled.',
        ].join('\n'),
      );
    });

    it('never closes again a ticket a person reopened in Linear', async () => {
      // Every finding was handled and the ticket closed; a person reopened it
      // in Linear (the webhook recorded `started`). A bulk triage sends the
      // same findings again in the same state.
      issues.set('issue-1', {
        state: { name: 'In Progress', type: 'started' },
        teamStates: ENG_STATES,
      });
      const reopenedInLinear = {
        issueState: 'In Progress',
        linearStateType: 'started',
        doneAt: EARLIER,
        doneReason: 'fixed',
      };
      rows.push(
        row({ vulnerabilityId: 'vuln-a', ...reopenedInLinear }),
        row({ vulnerabilityId: 'vuln-b', ...reopenedInLinear }),
      );

      await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
        closed: 0,
        commented: 0,
      });

      expect(calls).toHaveLength(0);
      expect(issueMappingRepo.update).not.toHaveBeenCalled();
      for (const r of rows) {
        expect(r.linearStateType).toBe('started');
        expect(r.doneAt).toEqual(EARLIER);
      }
    });

    it('closes a reopened ticket again once a finding newly handled completes it', async () => {
      issues.set('issue-1', {
        state: { name: 'In Progress', type: 'started' },
        teamStates: ENG_STATES,
      });
      rows.push(
        row({
          vulnerabilityId: 'vuln-a',
          issueState: 'In Progress',
          linearStateType: 'started',
          doneAt: EARLIER,
          doneReason: 'fixed',
        }),
        row({
          vulnerabilityId: 'vuln-b',
          issueState: 'In Progress',
          linearStateType: 'started',
        }),
      );

      // vuln-a is sent again unchanged, vuln-b is newly fixed.
      await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
        closed: 1,
        commented: 0,
      });

      expect(stateChanges()).toHaveLength(1);
      expect(stateChanges()[0].variables.input).toEqual({
        stateId: 'eng-done',
      });
      expect(comments()).toHaveLength(1);
      expect(commentBody(comments()[0])).toBe(
        'Handled in CybeDefend: 2 fixed, 0 ignored.',
      );
      for (const r of rows) expect(r.linearStateType).toBe('completed');
    });
  });

  it('only records the state of a ticket Linear already closed', async () => {
    issues.set('issue-1', {
      state: { name: 'Released', type: 'completed' },
      teamStates: ENG_STATES,
    });
    rows.push(row({ vulnerabilityId: 'vuln-a' }));

    await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });

    expect(stateChanges()).toHaveLength(0);
    expect(comments()).toHaveLength(0);
    expect(rows[0].issueState).toBe('Released');
    expect(rows[0].linearStateType).toBe('completed');
  });

  it('a ticket another call closed meanwhile gets no second closing comment', async () => {
    openIssue('issue-1');
    rows.push(row({ vulnerabilityId: 'vuln-a' }));
    // Another call recorded the close between our read and our write.
    onIssueUpdate = () => {
      for (const r of rows) {
        r.issueState = 'Done';
        r.linearStateType = 'completed';
      }
    };

    await expect(apply(['vuln-a'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });
    expect(stateChanges()).toHaveLength(1);
    expect(comments()).toHaveLength(0);
  });

  it('makes no Linear call for a workspace that is gone or must be reconnected', async () => {
    integrations.push({
      id: 'integration-2',
      organizationId: 'org-2',
      linearOrganizationId: OTHER_WORKSPACE,
      needsReconnect: true,
    } as LinearIntegration);
    rows.push(
      row({
        vulnerabilityId: 'vuln-a',
        externalIssueId: 'issue-1',
        linearOrganizationId: OTHER_WORKSPACE,
      }),
      row({
        vulnerabilityId: 'vuln-b',
        externalIssueId: 'issue-2',
        linearOrganizationId: 'lin-workspace-gone',
      }),
    );

    await expect(apply(['vuln-a', 'vuln-b'], 'fixed')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });

    expect(calls).toHaveLength(0);
    // Still recorded as handled. The tickets stay as they are: a ticket is
    // closed only by a call that handles one of its findings.
    for (const r of rows) expect(r.doneReason).toBe('fixed');
  });

  it('writes the dismissal reason as plain text on one line, and no location', async () => {
    openIssue('issue-1');
    rows.push(
      row({ vulnerabilityId: 'vuln-a', groupKey: 'src/secret/config.ts' }),
      row({ vulnerabilityId: 'vuln-b', groupKey: 'src/secret/config.ts' }),
    );

    await apply(
      ['vuln-a'],
      'ignored',
      '  Test data\n\n![x](https://evil.example/p.png) [see](https://evil.example)  ',
    );

    const body = commentBody(comments()[0]);
    expect(body).toBe(
      [
        'Handled in CybeDefend: 1 finding ignored.',
        '1 of 2 findings linked to this issue are handled.',
        '',
        'Dismissal reasons:',
        '- Test data \\!\\[x\\](https://evil.example/p.png) \\[see\\](https://evil.example)',
      ].join('\n'),
    );
    expect(body).not.toContain('src/secret/config.ts');
  });

  it('refuses an unknown outcome without touching anything', async () => {
    rows.push(row({ vulnerabilityId: 'vuln-a' }));

    await expect(apply(['vuln-a'], 'resolved')).resolves.toEqual({
      closed: 0,
      commented: 0,
    });

    expect(issueMappingRepo.find).not.toHaveBeenCalled();
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
