import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { In, IsNull, Not } from 'typeorm';
import {
  CreateLinearIssuesRequest,
  GetLinearProjectIssuesRequest,
  IssueCreationMode,
  LinkLinearIssueRequest,
  SyncLinearIssueStatusRequest,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';
import { LinearIssueService } from './linear-issue.service';
import { LinearDescriptionService } from './linear-description.service';
import { LinearService } from './linear.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { LinearProjectMapping } from '../../entities/linear-project-mapping.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';

const BASE_URL = 'https://app.example.com';
const INTEGRATION = {
  id: 'int-1',
  organizationId: 'org-1',
  linearOrganizationId: 'lin-org-1',
  workspaceUrlKey: 'acme',
};

type Variables = Record<string, unknown>;
type Input = Record<string, unknown>;

function vuln(overrides: Partial<VulnerabilityInfo> = {}): VulnerabilityInfo {
  return {
    vulnerabilityId: 'vuln-1',
    scannerType: 'sast',
    severity: 'high',
    name: 'SQL Injection',
    shortDescription: 'User input reaches a SQL query.',
    description: 'How to prevent: use parameterised queries.',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 15,
    cwe: ['CWE-89'],
    owaspTop10: [],
    cvssScore: 8,
    packageName: '',
    packageVersion: '',
    fixedVersion: '',
    externalId: 'CWE-89',
    cybedefendUrl: '',
    branch: 'main',
    ...overrides,
  };
}

function request(
  overrides: Partial<CreateLinearIssuesRequest> = {},
): CreateLinearIssuesRequest {
  return {
    projectId: 'proj-1',
    organizationId: 'org-1',
    scanId: 'scan-1',
    mode: IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
    vulnerabilities: [vuln()],
    cybedefendBaseUrl: BASE_URL,
    teamId: 'team-1',
    linearProjectId: '',
    labelIds: [],
    assigneeId: '',
    ...overrides,
  };
}

function projectMapping(
  overrides: Partial<LinearProjectMapping> = {},
): LinearProjectMapping {
  return {
    id: 'map-1',
    integrationId: INTEGRATION.id,
    integration: INTEGRATION,
    projectId: 'proj-1',
    teamId: 'team-project',
    teamKey: 'SEC',
    teamName: 'Security',
    linearProjectId: 'linear-project-1',
    linearProjectName: 'Hardening',
    labels: JSON.stringify([{ id: 'label-1', name: 'security' }]),
    allowedBranches: null,
    autoCreateEnabled: true,
    ...overrides,
  } as LinearProjectMapping;
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    key: 'ENG',
    name: 'Engineering',
    triageEnabled: false,
    defaultIssueState: { id: 'state-todo', type: 'unstarted' },
    states: {
      nodes: [
        { id: 'state-backlog', type: 'backlog', position: 0, name: 'Backlog' },
        { id: 'state-todo', type: 'unstarted', position: 1, name: 'Todo' },
        { id: 'state-done', type: 'completed', position: 3, name: 'Done' },
      ],
    },
    ...overrides,
  };
}

function createdIssue(n: number) {
  return {
    id: `0b5c3a3e-0000-4000-8000-00000000000${n}`,
    identifier: `ENG-${n}`,
    url: `https://linear.app/acme/issue/ENG-${n}/sql-injection`,
    priorityLabel: 'High',
    state: { name: 'Todo', type: 'unstarted' },
    team: { key: 'ENG' },
    assignee: null,
  };
}

/** What Linear answers for a ticket looked up by identifier or by UUID. */
function linearIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: '7e1f0c58-0000-4000-8000-000000000042',
    identifier: 'ENG-42',
    url: 'https://linear.app/acme/issue/ENG-42/login-bug',
    title: 'Login bug',
    priorityLabel: 'High',
    state: { name: 'In Progress', type: 'started' },
    team: { key: 'ENG' },
    assignee: { name: 'Ada Lovelace' },
    ...overrides,
  };
}

function linkRequest(
  overrides: Partial<LinkLinearIssueRequest> = {},
): LinkLinearIssueRequest {
  return {
    projectId: 'proj-1',
    organizationId: 'org-1',
    issueRef: 'ENG-42',
    vulnerabilityIds: ['vuln-1'],
    scannerType: 'sast',
    vulnerabilities: [vuln()],
    cybedefendBaseUrl: BASE_URL,
    ...overrides,
  };
}

/** A stored Linear ticket link, stale by default (Todo, unassigned). */
function mappingRow(
  overrides: Partial<VulnerabilityIssueMapping> = {},
): VulnerabilityIssueMapping {
  return {
    id: 'row-1',
    projectId: 'proj-1',
    vulnerabilityId: 'vuln-1',
    scannerType: 'sast',
    platform: IssuePlatform.LINEAR,
    externalIssueId: linearIssue().id,
    issueUrl: 'https://linear.app/acme/issue/ENG-42/login-bug',
    issueTitle: 'Login bug',
    issueState: 'Todo',
    linearIdentifier: 'ENG-42',
    linearTeamKey: 'ENG',
    linearPriority: 'High',
    linearAssignee: null,
    linearStateType: 'unstarted',
    linearOrganizationId: 'lin-org-1',
    creationMode: 'per_vulnerability_type',
    groupKey: 'CWE-89',
    scanId: 'scan-1',
    doneAt: null,
    doneReason: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-02T10:00:00.000Z'),
    ...overrides,
  } as VulnerabilityIssueMapping;
}

describe('LinearIssueService', () => {
  let service: LinearIssueService;
  let issueMappingRepo: ReturnType<
    typeof createMockRepository<VulnerabilityIssueMapping>
  >;
  let linearService: {
    getIntegrationForOrga: jest.Mock;
    getInstallationForOrga: jest.Mock;
    findProjectConfig: jest.Mock;
    linearCall: jest.Mock;
  };
  let billingWritable: { assertWritable: jest.Mock };
  let logger: Logger;
  let pause: jest.SpyInstance;
  let teamAnswer: Record<string, unknown> | null;
  let issueCreateFailures: Map<number, unknown>;
  let attachmentFailure: unknown;
  // What a ticket lookup by identifier answers, or fails with.
  let lookupAnswer: Record<string, unknown> | null;
  let lookupFailure: unknown;
  // What the batched status read answers for the UUIDs it is given, or fails
  // with on its nth call.
  let tickets: Map<string, Record<string, unknown>>;
  let statusFailures: Map<number, unknown>;

  const callsTo = (operation: string) =>
    linearService.linearCall.mock.calls.filter(([, query]) =>
      (query as string).includes(operation),
    );
  const issueInputs = () =>
    callsTo('issueCreate').map(
      ([, , variables]) => (variables as Variables).input as Input,
    );
  const attachmentInputs = () =>
    callsTo('attachmentCreate').map(
      ([, , variables]) => (variables as Variables).input as Input,
    );
  const savedRows = () =>
    issueMappingRepo.save.mock.calls.map(
      ([row]) => row as Partial<VulnerabilityIssueMapping>,
    );

  const expectRefusal = async (
    promise: Promise<unknown>,
    message: string,
    code: status,
  ) => {
    const error = await promise.then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual({ code, message });
  };

  beforeEach(async () => {
    issueMappingRepo = createMockRepository<VulnerabilityIssueMapping>();
    issueMappingRepo.findOne.mockResolvedValue(null);
    issueMappingRepo.find.mockResolvedValue([]);
    issueMappingRepo.save.mockImplementation(
      async (row) => row as VulnerabilityIssueMapping,
    );

    teamAnswer = team();
    issueCreateFailures = new Map();
    attachmentFailure = undefined;
    lookupAnswer = linearIssue();
    lookupFailure = undefined;
    tickets = new Map();
    statusFailures = new Map();
    let creations = 0;
    let statusReads = 0;
    linearService = {
      getIntegrationForOrga: jest.fn().mockResolvedValue(INTEGRATION),
      // The presence probe: answers whatever the state of the connection.
      getInstallationForOrga: jest.fn().mockResolvedValue({
        isConfigured: true,
        linearOrganizationId: INTEGRATION.linearOrganizationId,
        needsReconnect: false,
      }),
      findProjectConfig: jest.fn().mockResolvedValue(null),
      linearCall: jest.fn(async (_integration, query: string, variables) => {
        if (query.includes('issue(id')) {
          if (lookupFailure) throw lookupFailure;
          return { issue: lookupAnswer };
        }
        if (query.includes('issues(filter')) {
          statusReads += 1;
          if (statusFailures.has(statusReads)) {
            throw statusFailures.get(statusReads);
          }
          const nodes = (variables as { ids: string[] }).ids
            .filter((id) => tickets.has(id))
            .map((id) => tickets.get(id));
          return { issues: { nodes } };
        }
        if (query.includes('issueCreate')) {
          creations += 1;
          if (issueCreateFailures.has(creations)) {
            throw issueCreateFailures.get(creations);
          }
          return {
            issueCreate: { success: true, issue: createdIssue(creations) },
          };
        }
        if (query.includes('attachmentCreate')) {
          if (attachmentFailure) throw attachmentFailure;
          return { attachmentCreate: { success: true } };
        }
        if (query.includes('team(')) return { team: teamAnswer };
        throw new Error(`unexpected Linear query: ${query}`);
      }),
    };
    billingWritable = {
      assertWritable: jest.fn().mockResolvedValue(undefined),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinearIssueService,
        LinearDescriptionService,
        {
          provide: getRepositoryToken(VulnerabilityIssueMapping),
          useValue: issueMappingRepo,
        },
        { provide: LinearService, useValue: linearService },
        { provide: ENTITLEMENTS_PORT, useValue: billingWritable },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    service = module.get(LinearIssueService);
    pause = jest
      .spyOn(
        service as unknown as { pause: (ms: number) => Promise<void> },
        'pause',
      )
      .mockResolvedValue(undefined);
  });

  it('createIssues checks writability before anything else', async () => {
    billingWritable.assertWritable.mockRejectedValue(
      new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'WRITES_BLOCKED',
      }),
    );

    await expectRefusal(
      service.createIssues(request()),
      'WRITES_BLOCKED',
      status.PERMISSION_DENIED,
    );
    expect(billingWritable.assertWritable).toHaveBeenCalledWith('org-1');
    expect(linearService.getIntegrationForOrga).not.toHaveBeenCalled();
    expect(linearService.findProjectConfig).not.toHaveBeenCalled();
    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
  });

  it('createIssues uses the project team when none is given, and refuses with LINEAR_NO_TEAM without one', async () => {
    linearService.findProjectConfig.mockResolvedValue(projectMapping());

    await service.createIssues(
      request({
        teamId: '',
        // Ignored without a team: the project's settings decide.
        linearProjectId: 'other-project',
        labelIds: ['other-label'],
      }),
    );

    expect(linearService.findProjectConfig).toHaveBeenCalledWith('proj-1');
    expect(callsTo('team(')[0][2]).toEqual({ teamId: 'team-project' });
    expect(issueInputs()).toEqual([
      expect.objectContaining({
        teamId: 'team-project',
        projectId: 'linear-project-1',
        labelIds: ['label-1'],
      }),
    ]);

    linearService.linearCall.mockClear();
    linearService.findProjectConfig.mockResolvedValue(null);
    await expectRefusal(
      service.createIssues(request({ teamId: '' })),
      'LINEAR_NO_TEAM',
      status.FAILED_PRECONDITION,
    );

    // Settings that belong to another organisation's integration are not ours.
    linearService.findProjectConfig.mockResolvedValue(
      projectMapping({
        integrationId: 'int-other',
        integration: { ...INTEGRATION, id: 'int-other' } as never,
      }),
    );
    await expectRefusal(
      service.createIssues(request({ teamId: '' })),
      'LINEAR_NO_TEAM',
      status.FAILED_PRECONDITION,
    );
    expect(linearService.linearCall).not.toHaveBeenCalled();
  });

  it('createIssues honours per-ticket team, project, labels, assignee and priority', async () => {
    linearService.findProjectConfig.mockResolvedValue(projectMapping());

    await service.createIssues(
      request({
        teamId: 'team-1',
        linearProjectId: 'linear-project-9',
        labelIds: ['label-a', 'label-b'],
        assigneeId: 'user-1',
        priority: 4,
      }),
    );

    expect(callsTo('team(')[0][2]).toEqual({ teamId: 'team-1' });
    expect(issueInputs()[0]).toEqual({
      teamId: 'team-1',
      title: '[CybeDefend] SQL Injection (1 occurrence)',
      description: expect.any(String),
      priority: 4,
      stateId: 'state-todo',
      assigneeId: 'user-1',
      projectId: 'linear-project-9',
      labelIds: ['label-a', 'label-b'],
    });

    // Without a priority, the highest severity of the group decides; an empty
    // project, label list or assignee means none, never the project's settings.
    linearService.linearCall.mockClear();
    await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'v-low', severity: 'low' }),
          vuln({ vulnerabilityId: 'v-critical', severity: 'critical' }),
        ],
      }),
    );

    const input = issueInputs()[0];
    expect(input.priority).toBe(1);
    expect(input).not.toHaveProperty('projectId');
    expect(input).not.toHaveProperty('labelIds');
    expect(input).not.toHaveProperty('assigneeId');

    // 0 is Linear's « no priority », a choice; a value Linear does not know
    // falls back to the severity's.
    linearService.linearCall.mockClear();
    await service.createIssues(request({ priority: 0 }));
    await service.createIssues(request({ priority: 7 }));
    expect(issueInputs().map((i) => i.priority)).toEqual([0, 2]);
  });

  it('createIssues sends an explicit stateId that is never triage', async () => {
    teamAnswer = team({
      triageEnabled: true,
      defaultIssueState: { id: 'state-triage', type: 'triage' },
      states: {
        nodes: [
          { id: 'state-triage', type: 'triage', position: 0, name: 'Triage' },
          { id: 'backlog-2', type: 'backlog', position: 2, name: 'Later' },
          { id: 'backlog-1', type: 'backlog', position: 1, name: 'Backlog' },
          { id: 'state-todo', type: 'unstarted', position: 3, name: 'Todo' },
        ],
      },
    });

    await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', externalId: 'CWE-89' }),
          vuln({ vulnerabilityId: 'b', externalId: 'CWE-79', name: 'XSS' }),
        ],
      }),
    );

    expect(issueInputs().map((input) => input.stateId)).toEqual([
      'backlog-1',
      'backlog-1',
    ]);
    // The team and its states are read once per call.
    expect(callsTo('team(')).toHaveLength(1);
  });

  it('createIssues creates nothing when the team has no state to start in', async () => {
    teamAnswer = team({
      defaultIssueState: { id: 'state-triage', type: 'triage' },
      states: {
        nodes: [
          { id: 'state-triage', type: 'triage', position: 0, name: 'Triage' },
          { id: 'state-done', type: 'completed', position: 1, name: 'Done' },
        ],
      },
    });

    const result = await service.createIssues(request());

    expect(callsTo('issueCreate')).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.failedVulnerabilityIds).toEqual(['vuln-1']);
  });

  it('createIssues refuses with LINEAR_TEAM_NOT_FOUND for a team Linear does not know', async () => {
    teamAnswer = null;
    await expectRefusal(
      service.createIssues(request()),
      'LINEAR_TEAM_NOT_FOUND',
      status.NOT_FOUND,
    );

    linearService.linearCall.mockRejectedValue(
      new RpcException({
        code: status.NOT_FOUND,
        message: 'Linear entity not found',
      }),
    );
    await expectRefusal(
      service.createIssues(request()),
      'LINEAR_TEAM_NOT_FOUND',
      status.NOT_FOUND,
    );
  });

  it('createIssues filters disallowed branches', async () => {
    linearService.findProjectConfig.mockResolvedValue(
      projectMapping({ allowedBranches: JSON.stringify(['main']) }),
    );

    const result = await service.createIssues(
      request({
        teamId: 'team-1',
        vulnerabilities: [
          vuln({ vulnerabilityId: 'on-main', branch: 'main' }),
          vuln({ vulnerabilityId: 'on-dev', branch: 'dev' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(1);
    expect(savedRows().map((row) => row.vulnerabilityId)).toEqual(['on-main']);
    expect(result.issues[0].vulnerabilityIds).toEqual(['on-main']);
    expect(result.failedVulnerabilityIds).toEqual([]);

    linearService.linearCall.mockClear();
    const refused = await service.createIssues(
      request({
        vulnerabilities: [vuln({ vulnerabilityId: 'on-dev', branch: 'dev' })],
      }),
    );

    expect(refused.success).toBe(false);
    expect(refused.issues).toEqual([]);
    expect(refused.failedVulnerabilityIds).toEqual(['on-dev']);
    expect(linearService.linearCall).not.toHaveBeenCalled();
  });

  it('createIssues skips a group whose open Linear ticket exists, and a vulnerability linked to an open Linear ticket', async () => {
    const open = {
      issueState: Not('deleted'),
      linearStateType: Not(In(['completed', 'canceled'])),
    };
    const noStateType = {
      issueState: Not('deleted'),
      linearStateType: IsNull(),
    };

    issueMappingRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      externalIssueId: 'existing-uuid',
    } as VulnerabilityIssueMapping);
    const skippedGroup = await service.createIssues(request());

    const groupWhere = {
      projectId: 'proj-1',
      platform: IssuePlatform.LINEAR,
      groupKey: 'CWE-89',
      creationMode: 'per_vulnerability_type',
    };
    expect(issueMappingRepo.findOne).toHaveBeenCalledWith({
      where: [
        { ...groupWhere, ...open },
        { ...groupWhere, ...noStateType },
      ],
    });
    expect(callsTo('issueCreate')).toHaveLength(0);
    expect(skippedGroup.issues).toEqual([]);
    expect(skippedGroup.failedVulnerabilityIds).toEqual([]);

    issueMappingRepo.find.mockResolvedValueOnce([
      {
        id: 'row-2',
        externalIssueId: 'other-uuid',
      } as VulnerabilityIssueMapping,
    ]);
    const skippedVulnerability = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a' }),
          vuln({ vulnerabilityId: 'b' }),
        ],
      }),
    );

    const vulnerabilityWhere = {
      projectId: 'proj-1',
      platform: IssuePlatform.LINEAR,
      vulnerabilityId: In(['a', 'b']),
    };
    expect(issueMappingRepo.find).toHaveBeenLastCalledWith({
      where: [
        { ...vulnerabilityWhere, ...open },
        { ...vulnerabilityWhere, ...noStateType },
      ],
    });
    expect(callsTo('issueCreate')).toHaveLength(0);
    expect(skippedVulnerability.issues).toEqual([]);
  });

  it('createIssues attaches the CybeDefend link and keeps the ticket when the attachment fails', async () => {
    const vulns = [
      vuln({ vulnerabilityId: 'a', severity: 'medium' }),
      vuln({ vulnerabilityId: 'b', severity: 'high' }),
    ];

    await service.createIssues(request({ vulnerabilities: vulns }));

    expect(attachmentInputs()).toEqual([
      {
        issueId: createdIssue(1).id,
        url: `${BASE_URL}/project/proj-1/sast?search=SQL%20Injection`,
        title: 'CybeDefend · SQL Injection',
        subtitle: '2 occurrences · High',
      },
    ]);
    // issueCreate is not idempotent and is never retried; attachmentCreate is
    // idempotent per (issue, URL) and keeps the default retry.
    expect(callsTo('issueCreate')[0][3]).toEqual({ retryOnServerError: false });
    expect(callsTo('attachmentCreate')[0][3]).toBeUndefined();

    linearService.linearCall.mockClear();
    issueMappingRepo.save.mockClear();
    attachmentFailure = new RpcException({
      code: status.UNAVAILABLE,
      message: 'Linear is unavailable',
    });
    const result = await service.createIssues(
      request({ vulnerabilities: [vuln({ severity: 'critical' })] }),
    );

    expect(attachmentInputs()[0].subtitle).toBe('1 occurrence · Critical');
    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.failedVulnerabilityIds).toEqual([]);
    expect(issueMappingRepo.save).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('createIssues writes CybeDefend links from the base URL only, never from a finding', async () => {
    await service.createIssues(
      request({
        vulnerabilities: [vuln({ cybedefendUrl: 'https://evil.example/x' })],
      }),
    );

    const [input] = issueInputs();
    const [attachment] = attachmentInputs();
    expect(input.description as string).not.toContain('evil.example');
    expect(JSON.stringify(attachment)).not.toContain('evil.example');
    expect(attachment.url as string).toMatch(
      new RegExp(`^${BASE_URL}/project/proj-1/`),
    );
    expect(input.description as string).toContain(attachment.url as string);
  });

  it('createIssues saves one mapping per vulnerability', async () => {
    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a' }),
          vuln({ vulnerabilityId: 'b', scannerType: 'sast' }),
        ],
      }),
    );

    const issue = createdIssue(1);
    const expected = {
      projectId: 'proj-1',
      scannerType: 'sast',
      platform: IssuePlatform.LINEAR,
      externalIssueId: issue.id,
      linearIdentifier: 'ENG-1',
      issueUrl: issue.url,
      issueTitle: '[CybeDefend] SQL Injection (2 occurrences)',
      issueState: 'Todo',
      linearTeamKey: 'ENG',
      linearPriority: 'High',
      linearStateType: 'unstarted',
      linearOrganizationId: 'lin-org-1',
      scanId: 'scan-1',
      groupKey: 'CWE-89',
      creationMode: 'per_vulnerability_type',
    };
    expect(savedRows()).toEqual([
      expect.objectContaining({ ...expected, vulnerabilityId: 'a' }),
      expect.objectContaining({ ...expected, vulnerabilityId: 'b' }),
    ]);
    for (const row of savedRows()) {
      expect(row.doneAt ?? null).toBeNull();
      expect(row.doneReason ?? null).toBeNull();
    }

    expect(result).toEqual({
      success: true,
      message: 'Created 1 Linear issue',
      issues: [
        expect.objectContaining({
          issueId: issue.id,
          title: '[CybeDefend] SQL Injection (2 occurrences)',
          url: issue.url,
          state: 'Todo',
          vulnerabilityIds: ['a', 'b'],
          linearIdentifier: 'ENG-1',
          linearTeamKey: 'ENG',
          linearPriority: 'High',
          linearStateType: 'unstarted',
        }),
      ],
      failedVulnerabilityIds: [],
    });
  });

  it('createIssues keeps the ticket when a mapping already exists', async () => {
    const duplicate = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
    });
    issueMappingRepo.save.mockRejectedValueOnce(duplicate);

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a' }),
          vuln({ vulnerabilityId: 'b' }),
        ],
      }),
    );

    expect(issueMappingRepo.save).toHaveBeenCalledTimes(2);
    expect(result.issues).toHaveLength(1);
    expect(result.failedVulnerabilityIds).toEqual([]);
  });

  it('createIssues reports a failed group and goes on with the next', async () => {
    issueCreateFailures.set(
      1,
      new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Linear rejected the request',
      }),
    );

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', externalId: 'CWE-89' }),
          vuln({ vulnerabilityId: 'b', externalId: 'CWE-79' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(2);
    expect(result.issues.map((issue) => issue.vulnerabilityIds)).toEqual([
      ['b'],
    ]);
    expect(result.failedVulnerabilityIds).toEqual(['a']);
  });

  it('createIssues stops at RATELIMITED and reports the rest as failed', async () => {
    issueCreateFailures.set(
      3,
      new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: 'Linear rate limit reached',
      }),
    );

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a1', externalId: 'A' }),
          vuln({ vulnerabilityId: 'b1', externalId: 'B' }),
          vuln({ vulnerabilityId: 'c1', externalId: 'C' }),
          vuln({ vulnerabilityId: 'c2', externalId: 'C' }),
          vuln({ vulnerabilityId: 'd1', externalId: 'D' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(3);
    expect(result.success).toBe(true);
    expect(result.issues.map((issue) => issue.vulnerabilityIds)).toEqual([
      ['a1'],
      ['b1'],
    ]);
    expect(savedRows().map((row) => row.vulnerabilityId)).toEqual(['a1', 'b1']);
    expect(result.failedVulnerabilityIds).toEqual(['c1', 'c2', 'd1']);
    // 300 ms between two creations, none before the first.
    expect(pause.mock.calls).toEqual([[300], [300]]);
  });

  it('createIssues stops when the workspace must be reconnected', async () => {
    issueCreateFailures.set(
      1,
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'LINEAR_NEEDS_RECONNECT',
      }),
    );

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', externalId: 'A' }),
          vuln({ vulnerabilityId: 'b', externalId: 'B' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.failedVulnerabilityIds).toEqual(['a', 'b']);
  });

  it('createIssues stops when Linear is unavailable and reports the rest as failed', async () => {
    issueCreateFailures.set(
      2,
      new RpcException({
        code: status.UNAVAILABLE,
        message: 'Linear is unavailable',
      }),
    );

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', externalId: 'A' }),
          vuln({ vulnerabilityId: 'b', externalId: 'B' }),
          vuln({ vulnerabilityId: 'c', externalId: 'C' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(2);
    expect(result.issues.map((issue) => issue.vulnerabilityIds)).toEqual([
      ['a'],
    ]);
    expect(result.failedVulnerabilityIds).toEqual(['b', 'c']);
  });

  it('createIssues answers success when nothing failed, every group already ticketed', async () => {
    // Every group has its open ticket: a scan after the first one.
    issueMappingRepo.findOne.mockResolvedValue({
      id: 'row-1',
      externalIssueId: 'existing-uuid',
    } as VulnerabilityIssueMapping);

    const result = await service.createIssues(
      request({
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', externalId: 'A' }),
          vuln({ vulnerabilityId: 'b', externalId: 'B' }),
        ],
      }),
    );

    expect(callsTo('issueCreate')).toHaveLength(0);
    expect(result).toEqual({
      success: true,
      message: 'Created 0 Linear issues',
      issues: [],
      failedVulnerabilityIds: [],
    });
  });

  it('createIssues logs the Linear issue it created when its findings cannot be recorded', async () => {
    issueMappingRepo.save.mockRejectedValueOnce(
      Object.assign(new Error('Connection lost'), { code: 'ECONNRESET' }),
    );

    const result = await service.createIssues(
      request({ vulnerabilities: [vuln({ vulnerabilityId: 'a' })] }),
    );

    const issue = createdIssue(1);
    expect(callsTo('issueCreate')).toHaveLength(1);
    expect(result.failedVulnerabilityIds).toEqual(['a']);
    expect(logger.error).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        projectId: 'proj-1',
        linearIssueId: issue.id,
        linearIdentifier: 'ENG-1',
        reason: 'Error',
      },
      expect.any(String),
    );
  });

  // ========== Issue reference ==========

  it('parseIssueRef accepts an identifier and a linear.app issue URL, and refuses anything else', () => {
    expect(service.parseIssueRef('ENG-142')).toBe('ENG-142');
    expect(service.parseIssueRef('  ENG-142\n')).toBe('ENG-142');
    expect(service.parseIssueRef('eng-142')).toBe('ENG-142');
    expect(service.parseIssueRef('A1-7')).toBe('A1-7');
    expect(service.parseIssueRef('ABCDEFGHIJ-1')).toBe('ABCDEFGHIJ-1');

    for (const url of [
      'https://linear.app/acme/issue/ENG-142/login-bug',
      'https://linear.app/acme/issue/ENG-142',
      'https://linear.app/acme/issue/ENG-142/',
      'https://linear.app/acme/issue/eng-142/login-bug',
      'https://linear.app/acme/issue/ENG-142/login-bug?foo=1#comment-9',
    ]) {
      expect(service.parseIssueRef(url)).toBe('ENG-142');
    }

    for (const refused of [
      '',
      '   ',
      'ENG',
      '142',
      'ENG-',
      '-142',
      'ENG142',
      'ENG-1a',
      '1NG-12',
      'ABCDEFGHIJK-1',
      'ENG-1234567890',
      'ENG-12 ENG-13',
      'ENG 12',
      'ENG-142/../../etc',
      'http://linear.app/acme/issue/ENG-142',
      'https://evil.example/acme/issue/ENG-142',
      'https://linear.app.evil.example/acme/issue/ENG-142',
      'https://user@linear.app/acme/issue/ENG-142',
      'https://linear.app/acme/project/ENG-142',
      'https://linear.app/acme/issue/not-an-identifier',
      'https://linear.app/acme/issue/',
      'https://linear.app/',
      'javascript:alert(1)',
    ]) {
      expect(service.parseIssueRef(refused)).toBeNull();
    }
    expect(service.parseIssueRef(undefined as unknown as string)).toBeNull();
  });

  // ========== linkExistingIssue ==========

  it('linkExistingIssue stores the UUID with creationMode linked and adds the attachment', async () => {
    const result = await service.linkExistingIssue(
      linkRequest({
        issueRef: 'https://linear.app/acme/issue/ENG-42/login-bug',
        vulnerabilityIds: ['a', 'b'],
        vulnerabilities: [
          vuln({ vulnerabilityId: 'a', severity: 'medium' }),
          vuln({ vulnerabilityId: 'b', severity: 'high' }),
        ],
      }),
    );

    expect(linearService.getIntegrationForOrga).toHaveBeenCalledWith('org-1');
    // The ticket is looked up by identifier, read-only (default retry).
    const lookups = callsTo('issue(id');
    expect(lookups).toHaveLength(1);
    expect(lookups[0][2]).toEqual({ id: 'ENG-42' });
    expect(lookups[0][3]).toBeUndefined();

    // The ticket is only read, and gets the CybeDefend attachment: its
    // description and every other field are never written.
    expect(
      linearService.linearCall.mock.calls.map(([, query]) => query as string),
    ).toEqual([
      expect.stringContaining('issue(id'),
      expect.stringContaining('attachmentCreate'),
    ]);
    expect(callsTo('issueUpdate')).toHaveLength(0);
    expect(callsTo('issueCreate')).toHaveLength(0);
    expect(attachmentInputs()).toEqual([
      {
        issueId: linearIssue().id,
        url: `${BASE_URL}/project/proj-1/sast?search=SQL%20Injection`,
        title: 'CybeDefend · SQL Injection',
        subtitle: '2 occurrences · High',
      },
    ]);
    // attachmentCreate is idempotent per (issue, URL): the default retry.
    expect(callsTo('attachmentCreate')[0][3]).toBeUndefined();

    const expected = {
      projectId: 'proj-1',
      scannerType: 'sast',
      platform: IssuePlatform.LINEAR,
      externalIssueId: linearIssue().id,
      linearIdentifier: 'ENG-42',
      issueUrl: 'https://linear.app/acme/issue/ENG-42/login-bug',
      issueTitle: 'Login bug',
      issueState: 'In Progress',
      linearTeamKey: 'ENG',
      linearPriority: 'High',
      linearAssignee: 'Ada Lovelace',
      linearStateType: 'started',
      linearOrganizationId: 'lin-org-1',
      creationMode: 'linked',
    };
    expect(savedRows()).toEqual([
      expect.objectContaining({ ...expected, vulnerabilityId: 'a' }),
      expect.objectContaining({ ...expected, vulnerabilityId: 'b' }),
    ]);
    for (const row of savedRows()) {
      expect(row.scanId ?? null).toBeNull();
      expect(row.groupKey ?? null).toBeNull();
      expect(row.doneAt ?? null).toBeNull();
      expect(row.doneReason ?? null).toBeNull();
    }

    expect(result).toEqual({
      success: true,
      message: 'Linked 2 vulnerabilities to ENG-42',
      issue: expect.objectContaining({
        issueId: linearIssue().id,
        title: 'Login bug',
        url: 'https://linear.app/acme/issue/ENG-42/login-bug',
        state: 'In Progress',
        vulnerabilityIds: ['a', 'b'],
        linearIdentifier: 'ENG-42',
        linearTeamKey: 'ENG',
        linearPriority: 'High',
        linearAssignee: 'Ada Lovelace',
        linearStateType: 'started',
      }),
    });
  });

  it('linkExistingIssue refuses an unknown issue with LINEAR_ISSUE_NOT_FOUND', async () => {
    lookupFailure = new RpcException({
      code: status.NOT_FOUND,
      message: 'Linear entity not found',
    });
    await expectRefusal(
      service.linkExistingIssue(linkRequest({ issueRef: 'ENG-9999' })),
      'LINEAR_ISSUE_NOT_FOUND',
      status.NOT_FOUND,
    );

    // Linear may also answer with no issue at all.
    lookupFailure = undefined;
    lookupAnswer = null;
    await expectRefusal(
      service.linkExistingIssue(linkRequest({ issueRef: 'ENG-9999' })),
      'LINEAR_ISSUE_NOT_FOUND',
      status.NOT_FOUND,
    );

    expect(callsTo('attachmentCreate')).toHaveLength(0);
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
  });

  it('linkExistingIssue passes any other Linear failure through and stores nothing', async () => {
    lookupFailure = new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: 'Linear rate limit reached',
    });

    await expectRefusal(
      service.linkExistingIssue(linkRequest()),
      'Linear rate limit reached',
      status.RESOURCE_EXHAUSTED,
    );
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
  });

  it('linkExistingIssue refuses a reference that is neither an identifier nor an issue URL, before calling Linear', async () => {
    await expectRefusal(
      service.linkExistingIssue(linkRequest({ issueRef: 'not a ticket' })),
      'Invalid Linear issue reference',
      status.INVALID_ARGUMENT,
    );

    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
  });

  it('linkExistingIssue refuses a call with no finding to link, before calling Linear', async () => {
    await expectRefusal(
      service.linkExistingIssue(linkRequest({ vulnerabilityIds: [] })),
      'No vulnerability to link',
      status.INVALID_ARGUMENT,
    );

    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
  });

  it("linkExistingIssue refuses an issue URL of another workspace, whose identifier would resolve to this workspace's own ticket", async () => {
    await expectRefusal(
      service.linkExistingIssue(
        linkRequest({
          issueRef: 'https://linear.app/other-co/issue/ENG-42/login-bug',
        }),
      ),
      'LINEAR_ISSUE_NOT_FOUND',
      status.NOT_FOUND,
    );

    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
  });

  it('linkExistingIssue updates an existing link instead of duplicating it', async () => {
    issueMappingRepo.find.mockResolvedValue([
      mappingRow({
        id: 'row-a',
        vulnerabilityId: 'a',
        creationMode: 'per_vulnerability_type',
      }),
    ]);

    const result = await service.linkExistingIssue(
      linkRequest({ vulnerabilityIds: ['a', 'b', 'b'] }),
    );

    expect(issueMappingRepo.find).toHaveBeenCalledWith({
      where: {
        projectId: 'proj-1',
        platform: IssuePlatform.LINEAR,
        externalIssueId: linearIssue().id,
        vulnerabilityId: In(['a', 'b']),
      },
    });
    // The finding that is linked already is refreshed in place...
    expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
    const [where, changes] = issueMappingRepo.update.mock.calls[0];
    expect(where).toEqual({ id: In(['row-a']) });
    expect(changes).toEqual(
      expect.objectContaining({
        issueTitle: 'Login bug',
        issueState: 'In Progress',
        linearStateType: 'started',
        linearAssignee: 'Ada Lovelace',
        linearIdentifier: 'ENG-42',
      }),
    );
    // ...without turning a ticket CybeDefend created into a linked one...
    expect(changes).not.toHaveProperty('creationMode');
    expect(changes).not.toHaveProperty('groupKey');
    // ...and only the new one is inserted, once.
    expect(savedRows().map((row) => row.vulnerabilityId)).toEqual(['b']);
    expect(result.issue.vulnerabilityIds).toEqual(['a', 'b']);
    expect(result.message).toBe('Linked 2 vulnerabilities to ENG-42');
  });

  it('linkExistingIssue inserts nothing when every finding is linked already', async () => {
    issueMappingRepo.find.mockResolvedValue([
      mappingRow({ id: 'row-1', vulnerabilityId: 'vuln-1' }),
    ]);

    const result = await service.linkExistingIssue(linkRequest());

    expect(issueMappingRepo.save).not.toHaveBeenCalled();
    expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Linked 1 vulnerability to ENG-42');
  });

  it('linkExistingIssue links the findings and keeps them when the attachment fails', async () => {
    attachmentFailure = new RpcException({
      code: status.UNAVAILABLE,
      message: 'Linear is unavailable',
    });

    const result = await service.linkExistingIssue(linkRequest());

    expect(callsTo('attachmentCreate')).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(savedRows()).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('linkExistingIssue writes the CybeDefend link from the base URL only, never from a finding', async () => {
    await service.linkExistingIssue(
      linkRequest({
        vulnerabilities: [vuln({ cybedefendUrl: 'https://evil.example/x' })],
      }),
    );

    const [attachment] = attachmentInputs();
    expect(JSON.stringify(attachment)).not.toContain('evil.example');
    expect(attachment.url as string).toMatch(
      new RegExp(`^${BASE_URL}/project/proj-1/sast\\?search=`),
    );

    // Without a base URL there is nothing to link to: the findings are still
    // linked, no attachment is attempted.
    linearService.linearCall.mockClear();
    issueMappingRepo.save.mockClear();
    const result = await service.linkExistingIssue(
      linkRequest({ cybedefendBaseUrl: '' }),
    );
    expect(callsTo('attachmentCreate')).toHaveLength(0);
    expect(result.success).toBe(true);
    expect(savedRows()).toHaveLength(1);
  });

  it('linkExistingIssue keeps what it stores within the columns and never stores a non-https URL', async () => {
    lookupAnswer = linearIssue({
      title: 'T'.repeat(300),
      url: 'http://linear.app/acme/issue/ENG-42/login-bug',
      priorityLabel: 'P'.repeat(40),
      assignee: { name: 'N'.repeat(300) },
      state: { name: 'S'.repeat(300), type: 'started' },
    });

    await service.linkExistingIssue(linkRequest());

    const [row] = savedRows();
    expect(row.issueTitle).toHaveLength(255);
    expect(row.issueState).toHaveLength(255);
    expect(row.linearPriority).toHaveLength(32);
    expect(row.linearAssignee).toHaveLength(255);
    expect(row.issueUrl).toBeNull();
  });

  // ========== getProjectIssues ==========

  const issuesRequest = (
    overrides: Partial<GetLinearProjectIssuesRequest> = {},
  ): GetLinearProjectIssuesRequest => ({
    projectId: 'proj-1',
    organizationId: 'org-1',
    state: 'all',
    vulnerabilityIds: [],
    ...overrides,
  });

  it("getProjectIssues returns the Linear rows of this organisation's project only", async () => {
    await service.getProjectIssues(issuesRequest());

    // Rows carry the workspace they were written for: another organisation's
    // rows are out of reach even for a project id that is guessed.
    expect(linearService.getInstallationForOrga).toHaveBeenCalledWith({
      organizationId: 'org-1',
    });
    expect(issueMappingRepo.find).toHaveBeenCalledWith({
      where: {
        projectId: 'proj-1',
        platform: IssuePlatform.LINEAR,
        linearOrganizationId: 'lin-org-1',
      },
      order: { createdAt: 'ASC' },
    });
  });

  it('getProjectIssues still answers while the workspace waits to be reconnected', async () => {
    linearService.getInstallationForOrga.mockResolvedValue({
      isConfigured: true,
      linearOrganizationId: 'lin-org-1',
      needsReconnect: true,
    });
    issueMappingRepo.find.mockResolvedValue([mappingRow()]);

    const result = await service.getProjectIssues(issuesRequest());

    // A read of the stored links: Linear is not called, and the refusing
    // lookup is not used.
    expect(linearService.getIntegrationForOrga).not.toHaveBeenCalled();
    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(issueMappingRepo.find).toHaveBeenCalledWith({
      where: expect.objectContaining({ linearOrganizationId: 'lin-org-1' }),
      order: { createdAt: 'ASC' },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issueId).toBe(linearIssue().id);
  });

  it('getProjectIssues refuses an organisation that has no Linear workspace, without reading any row', async () => {
    linearService.getInstallationForOrga.mockResolvedValue({
      isConfigured: false,
      linearOrganizationId: '',
      needsReconnect: false,
    });

    await expectRefusal(
      service.getProjectIssues(issuesRequest()),
      'LINEAR_NOT_CONNECTED',
      status.FAILED_PRECONDITION,
    );
    expect(issueMappingRepo.find).not.toHaveBeenCalled();
  });

  it('getProjectIssues and syncIssueStatus refuse a call with no project, before any lookup', async () => {
    for (const projectId of ['', undefined]) {
      await expectRefusal(
        service.getProjectIssues(issuesRequest({ projectId })),
        'projectId is required',
        status.INVALID_ARGUMENT,
      );
      await expectRefusal(
        service.syncIssueStatus(syncRequest({ projectId })),
        'projectId is required',
        status.INVALID_ARGUMENT,
      );
    }

    expect(linearService.getInstallationForOrga).not.toHaveBeenCalled();
    expect(linearService.getIntegrationForOrga).not.toHaveBeenCalled();
    expect(issueMappingRepo.find).not.toHaveBeenCalled();
    expect(linearService.linearCall).not.toHaveBeenCalled();
  });

  it('getProjectIssues filters by state and by vulnerability', async () => {
    const scope = {
      projectId: 'proj-1',
      platform: IssuePlatform.LINEAR,
      linearOrganizationId: 'lin-org-1',
    };

    await service.getProjectIssues(
      issuesRequest({ state: 'open', vulnerabilityIds: ['a', 'b'] }),
    );
    const openScope = { ...scope, vulnerabilityId: In(['a', 'b']) };
    expect(issueMappingRepo.find).toHaveBeenLastCalledWith({
      where: [
        {
          ...openScope,
          issueState: Not('deleted'),
          linearStateType: Not(In(['completed', 'canceled'])),
        },
        { ...openScope, issueState: Not('deleted'), linearStateType: IsNull() },
      ],
      order: { createdAt: 'ASC' },
    });

    await service.getProjectIssues(issuesRequest({ state: 'closed' }));
    expect(issueMappingRepo.find).toHaveBeenLastCalledWith({
      where: [
        { ...scope, linearStateType: In(['completed', 'canceled']) },
        { ...scope, issueState: 'deleted' },
      ],
      order: { createdAt: 'ASC' },
    });

    await service.getProjectIssues(issuesRequest({ state: '' }));
    expect(issueMappingRepo.find).toHaveBeenLastCalledWith({
      where: scope,
      order: { createdAt: 'ASC' },
    });
  });

  it('getProjectIssues groups rows by ticket', async () => {
    issueMappingRepo.find.mockResolvedValue([
      mappingRow({
        id: 'row-1',
        vulnerabilityId: 'a',
        externalIssueId: 'uuid-a',
        issueTitle: 'Login bug',
        issueState: 'In Progress',
        linearStateType: 'started',
        linearAssignee: 'Ada Lovelace',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
        updatedAt: new Date('2026-10-02T10:00:00.000Z'),
      }),
      mappingRow({
        id: 'row-2',
        vulnerabilityId: 'b',
        externalIssueId: 'uuid-a',
        issueTitle: 'Login bug',
        issueState: 'In Progress',
        linearStateType: 'started',
        linearAssignee: 'Ada Lovelace',
        createdAt: new Date('2026-10-03T10:00:00.000Z'),
        updatedAt: new Date('2026-10-04T10:00:00.000Z'),
      }),
      mappingRow({
        id: 'row-3',
        vulnerabilityId: 'c',
        externalIssueId: 'uuid-b',
        issueTitle: 'XSS',
        issueUrl: null,
        issueState: 'Done',
        linearIdentifier: 'SEC-3',
        linearTeamKey: 'SEC',
        linearPriority: null,
        linearAssignee: null,
        linearStateType: 'completed',
        createdAt: new Date('2026-10-05T10:00:00.000Z'),
        updatedAt: new Date('2026-10-06T10:00:00.000Z'),
      }),
    ]);

    const result = await service.getProjectIssues(issuesRequest());

    expect(result).toEqual({
      success: true,
      issues: [
        {
          issueId: 'uuid-a',
          issueNumber: 0,
          title: 'Login bug',
          url: 'https://linear.app/acme/issue/ENG-42/login-bug',
          state: 'In Progress',
          vulnerabilityIds: ['a', 'b'],
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-04T10:00:00.000Z',
          linearIdentifier: 'ENG-42',
          linearTeamKey: 'ENG',
          linearPriority: 'High',
          linearAssignee: 'Ada Lovelace',
          linearStateType: 'started',
        },
        {
          issueId: 'uuid-b',
          issueNumber: 0,
          title: 'XSS',
          url: '',
          state: 'Done',
          vulnerabilityIds: ['c'],
          createdAt: '2026-10-05T10:00:00.000Z',
          updatedAt: '2026-10-06T10:00:00.000Z',
          linearIdentifier: 'SEC-3',
          linearTeamKey: 'SEC',
          linearPriority: '',
          linearAssignee: '',
          linearStateType: 'completed',
        },
      ],
    });
  });

  // ========== syncIssueStatus ==========

  const syncRequest = (
    overrides: Partial<SyncLinearIssueStatusRequest> = {},
  ): SyncLinearIssueStatusRequest => ({
    projectId: 'proj-1',
    organizationId: 'org-1',
    ...overrides,
  });

  const statusReads = () => callsTo('issues(filter');

  it('syncIssueStatus re-reads the open tickets in one batched query and updates state, assignee, priority, identifier and URL', async () => {
    issueMappingRepo.find.mockResolvedValue([
      mappingRow({
        id: 'a-1',
        vulnerabilityId: 'a1',
        externalIssueId: 'uuid-a',
      }),
      mappingRow({
        id: 'a-2',
        vulnerabilityId: 'a2',
        externalIssueId: 'uuid-a',
      }),
      mappingRow({
        id: 'b-1',
        vulnerabilityId: 'b1',
        externalIssueId: 'uuid-b',
        linearIdentifier: 'ENG-9',
        issueUrl: 'https://linear.app/acme/issue/ENG-9/xss',
      }),
      mappingRow({
        id: 'c-1',
        vulnerabilityId: 'c1',
        externalIssueId: 'uuid-c',
      }),
    ]);
    // A: moved to another team and picked up by someone.
    tickets.set(
      'uuid-a',
      linearIssue({
        id: 'uuid-a',
        identifier: 'SEC-7',
        url: 'https://linear.app/acme/issue/SEC-7/login-bug',
        priorityLabel: 'Urgent',
        state: { name: 'In Progress', type: 'started' },
        team: { key: 'SEC' },
        assignee: { name: 'Ada Lovelace' },
      }),
    );
    // B: nothing moved since it was stored.
    tickets.set(
      'uuid-b',
      linearIssue({
        id: 'uuid-b',
        identifier: 'ENG-9',
        url: 'https://linear.app/acme/issue/ENG-9/xss',
        priorityLabel: 'High',
        state: { name: 'Todo', type: 'unstarted' },
        team: { key: 'ENG' },
        assignee: null,
      }),
    );
    // C: Linear does not return it (archived, deleted): left as it is.

    const result = await service.syncIssueStatus(syncRequest());

    expect(linearService.getIntegrationForOrga).toHaveBeenCalledWith('org-1');
    // Only this organisation's open tickets of the project are read.
    const scope = {
      projectId: 'proj-1',
      platform: IssuePlatform.LINEAR,
      linearOrganizationId: 'lin-org-1',
      issueState: Not('deleted'),
    };
    expect(issueMappingRepo.find).toHaveBeenCalledWith({
      where: [
        {
          ...scope,
          linearStateType: Not(In(['completed', 'canceled'])),
        },
        { ...scope, linearStateType: IsNull() },
      ],
    });

    // One read-only query for the three tickets (A once, for its two rows).
    expect(statusReads()).toHaveLength(1);
    const [, query, variables, options] = statusReads()[0];
    expect(query).toContain('issues(filter: { id: { in: $ids } }, first: 50)');
    expect(variables).toEqual({ ids: ['uuid-a', 'uuid-b', 'uuid-c'] });
    expect(options).toBeUndefined();

    // Only A changed, and it is written scoped to the workspace.
    expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
    expect(issueMappingRepo.update).toHaveBeenCalledWith(
      {
        platform: IssuePlatform.LINEAR,
        externalIssueId: 'uuid-a',
        linearOrganizationId: 'lin-org-1',
        issueState: Not('deleted'),
      },
      {
        issueState: 'In Progress',
        linearStateType: 'started',
        linearAssignee: 'Ada Lovelace',
        linearPriority: 'Urgent',
        linearTeamKey: 'SEC',
        linearIdentifier: 'SEC-7',
        issueUrl: 'https://linear.app/acme/issue/SEC-7/login-bug',
      },
    );
    // `updated` counts the rows that changed: A's two.
    expect(result).toEqual({ success: true, updated: 2 });
  });

  it('syncIssueStatus clears the assignee Linear no longer has, and leaves a field Linear did not give', async () => {
    issueMappingRepo.find.mockResolvedValue([
      mappingRow({
        id: 'a-1',
        externalIssueId: 'uuid-a',
        linearAssignee: 'Ada Lovelace',
      }),
    ]);
    tickets.set('uuid-a', {
      id: 'uuid-a',
      state: { name: 'Todo', type: 'unstarted' },
      assignee: null,
      // No identifier, team, priority label; a URL that is not https.
      url: 'http://linear.app/acme/issue/ENG-42/login-bug',
    });

    const result = await service.syncIssueStatus(syncRequest());

    expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
    expect(issueMappingRepo.update.mock.calls[0][1]).toEqual({
      issueState: 'Todo',
      linearStateType: 'unstarted',
      linearAssignee: '',
    });
    expect(result.updated).toBe(1);
  });

  it('syncIssueStatus asks for 50 tickets at a time', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `uuid-${i}`);
    issueMappingRepo.find.mockResolvedValue(
      ids.map((id, i) =>
        mappingRow({
          id: `row-${i}`,
          vulnerabilityId: `vuln-${i}`,
          externalIssueId: id,
        }),
      ),
    );

    const result = await service.syncIssueStatus(syncRequest());

    expect(
      statusReads().map(([, , vars]) => (vars as { ids: string[] }).ids),
    ).toEqual([ids.slice(0, 50), ids.slice(50, 100), ids.slice(100)]);
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, updated: 0 });
  });

  it('syncIssueStatus asks Linear nothing when the project has no open ticket', async () => {
    const result = await service.syncIssueStatus(syncRequest());

    expect(linearService.linearCall).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, updated: 0 });
  });

  it('syncIssueStatus refuses an organisation that has no usable Linear workspace, without reading any row', async () => {
    linearService.getIntegrationForOrga.mockRejectedValue(
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'LINEAR_NEEDS_RECONNECT',
      }),
    );

    await expectRefusal(
      service.syncIssueStatus(syncRequest()),
      'LINEAR_NEEDS_RECONNECT',
      status.FAILED_PRECONDITION,
    );
    expect(issueMappingRepo.find).not.toHaveBeenCalled();
    expect(linearService.linearCall).not.toHaveBeenCalled();
  });

  it('syncIssueStatus keeps what an earlier batch wrote when Linear refuses a later one', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `uuid-${i}`);
    issueMappingRepo.find.mockResolvedValue(
      ids.map((id, i) =>
        mappingRow({
          id: `row-${i}`,
          vulnerabilityId: `vuln-${i}`,
          externalIssueId: id,
        }),
      ),
    );
    tickets.set(
      'uuid-0',
      linearIssue({
        id: 'uuid-0',
        state: { name: 'Done', type: 'completed' },
      }),
    );
    statusFailures.set(
      2,
      new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: 'Linear rate limit reached',
      }),
    );

    await expectRefusal(
      service.syncIssueStatus(syncRequest()),
      'Linear rate limit reached',
      status.RESOURCE_EXHAUSTED,
    );

    expect(statusReads()).toHaveLength(2);
    expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
  });
});
