import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';
import { LinearService } from './linear.service';
import { LinearApiClient, LinearApiError } from './linear-api.client';
import { TokenCipherService } from '../../core/crypto/token-cipher.service';
import SecretsService from '../../core/secrets/secrets.service';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { LinearProjectMapping } from '../../entities/linear-project-mapping.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { SetProjectLinearConfigRequest } from '@grpc/external-integrations/linear';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const ONE_DAY_S = 86399;
const QUERY = 'query { viewer { id } }';
const REDIRECT_URI = 'https://app.example.com/integrations/linear/callback';

type Where = Partial<LinearIntegration>;
type Row = Record<string, unknown>;

interface TransactionRead {
  entity: unknown;
  options: { where: Where; lock?: { mode: string } };
}

interface InjectedFailure {
  error: Error;
  /** Runs just before the failure, e.g. another install committing. */
  before?: () => void;
}

function matches(row: object, where: object): boolean {
  return Object.entries(where).every(
    ([key, value]) => (row as Row)[key] === value,
  );
}

function deleteWhere(table: Row[], where: Row): { affected: number } {
  const kept = table.filter((row) => !matches(row, where));
  const affected = table.length - kept.length;
  table.splice(0, table.length, ...kept);
  return { affected };
}

/** What a mysql2 error becomes once TypeORM wraps it. */
function mysqlError(code: string, errno: number, text: string): Error {
  return new QueryFailedError(
    'INSERT INTO `linear_integrations` ...',
    [],
    Object.assign(new Error(text), { code, errno }),
  );
}

/**
 * The linear_integrations table (plus the Linear project settings and issue
 * links), with a row lock that behaves like `SELECT ... FOR UPDATE`: a
 * transaction that reads with `lock: { mode: 'pessimistic_write' }` waits for
 * the transaction holding the lock to end. A transaction's writes land when it
 * returns, and are dropped when it throws.
 */
function createIntegrationStore() {
  const rows: LinearIntegration[] = [];
  const projectMappings: Row[] = [];
  const issueLinks: Row[] = [];
  const transactionReads: TransactionRead[] = [];
  const transactionWrites: Array<Partial<LinearIntegration>> = [];
  const failures: InjectedFailure[] = [];
  let lockTail: Promise<void> = Promise.resolve();
  let nextId = 1;
  const tableOf = (entity: unknown) =>
    entity === LinearProjectMapping ? projectMappings : issueLinks;

  const find = (where: Where) => rows.find((row) => matches(row, where));
  const copy = (row: LinearIntegration | undefined) =>
    row ? ({ ...row } as LinearIntegration) : null;
  const write = (entity: Partial<LinearIntegration>) => {
    const existing = entity.id
      ? rows.find((row) => row.id === entity.id)
      : undefined;
    if (existing) {
      Object.assign(existing, entity);
    } else {
      rows.push({ id: `int-new-${nextId++}`, ...entity } as LinearIntegration);
    }
  };
  const updateWhere = (where: Where, patch: Partial<LinearIntegration>) => {
    const hit = rows.filter((row) => matches(row, where));
    hit.forEach((row) => Object.assign(row, patch));
    return { affected: hit.length };
  };

  const repo = {
    ...createMockRepository<LinearIntegration>(),
    findOne: jest.fn(async ({ where }: { where: Where }) => copy(find(where))),
    update: jest.fn(async (where: Where, patch: Partial<LinearIntegration>) =>
      updateWhere(where, patch),
    ),
    remove: jest.fn(async (entity: LinearIntegration) => {
      const index = rows.findIndex((row) => row.id === entity.id);
      if (index >= 0) rows.splice(index, 1);
      return entity;
    }),
    manager: {
      transaction: jest.fn(
        async <T>(work: (em: unknown) => Promise<T>): Promise<T> => {
          const staged: Array<() => void> = [];
          let release: (() => void) | undefined;
          const em = {
            findOne: jest.fn(
              async (entity: unknown, options: TransactionRead['options']) => {
                transactionReads.push({ entity, options });
                if (options.lock?.mode === 'pessimistic_write' && !release) {
                  const previous = lockTail;
                  lockTail = new Promise<void>((resolve) => {
                    release = resolve;
                  });
                  await previous;
                }
                return copy(find(options.where));
              },
            ),
            getRepository: jest.fn((entity: unknown) => {
              if (entity !== LinearIntegration) {
                return {
                  delete: jest.fn(async (where: Row) => {
                    staged.push(() => deleteWhere(tableOf(entity), where));
                    return { affected: 0 };
                  }),
                };
              }
              return {
                create: jest.fn((fields: Partial<LinearIntegration>) => ({
                  ...fields,
                })),
                save: jest.fn(async (saved: Partial<LinearIntegration>) => {
                  const failure = failures.shift();
                  if (failure) {
                    failure.before?.();
                    throw failure.error;
                  }
                  transactionWrites.push({ ...saved });
                  staged.push(() => write({ ...saved }));
                  return saved;
                }),
                update: jest.fn(
                  async (where: Where, patch: Partial<LinearIntegration>) => {
                    transactionWrites.push({ ...patch });
                    staged.push(() => updateWhere(where, patch));
                    return { affected: 1 };
                  },
                ),
              };
            }),
          };
          try {
            const result = await work(em);
            staged.forEach((apply) => apply());
            return result;
          } finally {
            release?.();
          }
        },
      ),
    },
  };

  const plainRepo = (table: Row[]) => ({
    ...createMockRepository(),
    delete: jest.fn(async (where: Row) => deleteWhere(table, where)),
  });

  // The project settings table: `projectId` is unique, as in MySQL.
  let nextMappingId = 1;
  let beforeNextMappingSave: (() => void) | undefined;
  const projectMappingRepo = {
    ...plainRepo(projectMappings),
    findOne: jest.fn(
      async ({ where, relations }: { where: Row; relations?: string[] }) => {
        // TypeORM leaves an undefined value out of the filter: the row found is
        // then any row.
        const filter = Object.fromEntries(
          Object.entries(where).filter(([, value]) => value !== undefined),
        );
        const row = projectMappings.find((mapping) => matches(mapping, filter));
        if (!row) return null;
        return {
          ...row,
          ...(relations?.includes('integration')
            ? {
                integration: copy(
                  rows.find(
                    (integration) => integration.id === row.integrationId,
                  ),
                ),
              }
            : {}),
        };
      },
    ),
    create: jest.fn((fields: Row) => ({ ...fields })),
    save: jest.fn(async (saved: Row) => {
      const hook = beforeNextMappingSave;
      beforeNextMappingSave = undefined;
      hook?.();
      const existing = saved.id
        ? projectMappings.find((mapping) => mapping.id === saved.id)
        : undefined;
      if (existing) {
        Object.assign(existing, saved);
        return { ...existing };
      }
      if (projectMappings.some((m) => m.projectId === saved.projectId)) {
        throw mysqlError(
          'ER_DUP_ENTRY',
          1062,
          "Duplicate entry for key 'UQ_linear_project_mappings_projectId'",
        );
      }
      const row = { id: `map-${nextMappingId++}`, ...saved };
      projectMappings.push(row);
      return { ...row };
    }),
    remove: jest.fn(async (entity: Row) => {
      deleteWhere(projectMappings, { id: entity.id });
      return entity;
    }),
  };

  return {
    rows,
    projectMappings,
    issueLinks,
    repo,
    projectMappingRepo,
    issueMappingRepo: plainRepo(issueLinks),
    /** Runs just before the next save of a project setting, e.g. a racing save. */
    beforeNextMappingSave: (hook: () => void) => {
      beforeNextMappingSave = hook;
    },
    transactionReads,
    transactionWrites,
    /** The next saves of an integration row throw these, in order. */
    failNextSaves: (...next: InjectedFailure[]) => failures.push(...next),
    /** A fresh copy of a row, as a caller that loaded it gets it. */
    load: (id: string) => copy(rows.find((row) => row.id === id)),
  };
}

type Store = ReturnType<typeof createIntegrationStore>;

function integrationRow(
  overrides: Partial<LinearIntegration> = {},
): LinearIntegration {
  return {
    id: 'int-1',
    organizationId: 'org-1',
    linearOrganizationId: 'lin-org-1',
    workspaceName: 'Acme',
    workspaceUrlKey: 'acme',
    accessToken: 'enc(access-1)',
    refreshToken: 'enc(refresh-1)',
    tokenExpiresAt: new Date(NOW + 3_600_000),
    needsReconnect: false,
    installedByUserId: 'user-1',
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-02T09:00:00.000Z'),
    projectMappings: undefined,
    ...overrides,
  } as LinearIntegration;
}

function refusal(code: status, message: string) {
  return { error: expect.objectContaining({ code, message }) };
}

interface FakeTeam {
  key: string;
  name: string;
  projects: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>;
  members: Array<{
    id: string;
    name: string;
    displayName: string;
    active: boolean;
    app: boolean;
  }>;
}

interface FakeWorkspace {
  teams: Record<string, FakeTeam>;
  /** Labels with no team, shared by the whole workspace. */
  workspaceLabels: Array<{ id: string; name: string }>;
}

function fakeWorkspace(): FakeWorkspace {
  return {
    teams: {
      'team-eng': {
        key: 'ENG',
        name: 'Engineering',
        projects: [
          { id: 'lp-1', name: 'Q4 hardening' },
          { id: 'lp-2', name: 'Platform' },
        ],
        labels: [
          { id: 'lbl-sec', name: 'Security' },
          { id: 'lbl-bug', name: 'Bug' },
        ],
        members: [
          {
            id: 'u-1',
            name: 'Ada Lovelace',
            displayName: 'ada',
            active: true,
            app: false,
          },
          {
            id: 'u-2',
            name: 'Some Bot',
            displayName: 'bot',
            active: true,
            app: true,
          },
          {
            id: 'u-3',
            name: 'Gone Person',
            displayName: 'gone',
            active: false,
            app: false,
          },
        ],
      },
      'team-ops': {
        key: 'OPS',
        name: 'Operations',
        projects: [{ id: 'lp-ops', name: 'On call' }],
        labels: [{ id: 'lbl-ops', name: 'Ops only' }],
        members: [],
      },
    },
    workspaceLabels: [{ id: 'lbl-ws', name: 'Customer' }],
  };
}

function manyTeams(count: number): FakeWorkspace['teams'] {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `team-${i + 1}`,
      {
        key: `T${i + 1}`,
        name: `Team ${i + 1}`,
        projects: [],
        labels: [],
        members: [],
      },
    ]),
  );
}

function manyItems(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix} ${i + 1}`,
  }));
}

/**
 * Answers the GraphQL queries of the teams and settings screens from an
 * in-memory workspace, as Linear does: a connection is read `first: N` at a
 * time, `after` being the `endCursor` of the previous page. A connection query
 * that does not ask for a page size fails, so a missing `first:` cannot pass.
 */
function installFakeLinear(graphql: jest.Mock, workspace: FakeWorkspace) {
  const pageOf = <T>(
    items: T[],
    query: string,
    variables?: Record<string, unknown>,
  ) => {
    const first = Number(/\bfirst: (\d+)/.exec(query)?.[1]);
    if (!Number.isInteger(first)) {
      throw new Error(`connection read without first: N\n${query}`);
    }
    const start = variables?.after ? Number(variables.after) : 0;
    const nodes = items.slice(start, start + first);
    const end = start + nodes.length;
    return {
      nodes,
      pageInfo: { hasNextPage: end < items.length, endCursor: String(end) },
    };
  };
  const teamOf = (variables?: Record<string, unknown>) => {
    const id = String(variables?.teamId);
    const team = workspace.teams[id];
    if (!team) {
      throw new LinearApiError('not_found', 'Entity not found: Team');
    }
    return { id, ...team };
  };

  graphql.mockImplementation(
    async (_token: string, query: string, variables?: Row) => {
      if (/\bteams\(/.test(query)) {
        const teams = Object.entries(workspace.teams).map(([id, t]) => ({
          id,
          key: t.key,
          name: t.name,
        }));
        return { teams: pageOf(teams, query, variables) };
      }
      if (/\bissueLabels\(/.test(query)) {
        return {
          issueLabels: pageOf(workspace.workspaceLabels, query, variables),
        };
      }
      if (/\bteam\(id:/.test(query)) {
        const team = teamOf(variables);
        if (/\bprojects\(/.test(query)) {
          return {
            team: { projects: pageOf(team.projects, query, variables) },
          };
        }
        if (/\blabels\(/.test(query)) {
          return { team: { labels: pageOf(team.labels, query, variables) } };
        }
        if (/\bmembers\(/.test(query)) {
          return { team: { members: pageOf(team.members, query, variables) } };
        }
        return { team: { id: team.id, key: team.key, name: team.name } };
      }
      throw new Error(`query the fake Linear does not know\n${query}`);
    },
  );
}

function mappingRow(overrides: Row = {}): Row {
  return {
    id: 'map-1',
    integrationId: 'int-1',
    projectId: 'p-1',
    teamId: 'team-eng',
    teamKey: 'ENG',
    teamName: 'Engineering',
    linearProjectId: null,
    linearProjectName: null,
    labels: null,
    allowedBranches: null,
    autoCreateEnabled: 0,
    ...overrides,
  };
}

function setRequest(
  overrides: Partial<SetProjectLinearConfigRequest> = {},
): SetProjectLinearConfigRequest {
  return {
    organizationId: 'org-1',
    projectId: 'p-1',
    teamId: 'team-eng',
    linearProjectId: '',
    labelIds: [],
    allowedBranches: [],
    autoCreateEnabled: false,
    ...overrides,
  };
}

const NOT_CONFIGURED = {
  isConfigured: false,
  teamId: '',
  teamKey: '',
  teamName: '',
  linearProjectId: '',
  linearProjectName: '',
  labels: [],
  allowedBranches: [],
  autoCreateEnabled: false,
};

const NEW_TOKENS = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresInSeconds: ONE_DAY_S,
};

describe('LinearService', () => {
  let service: LinearService;
  let store: Store;
  let projectMappingRepo: Store['projectMappingRepo'];
  let issueMappingRepo: Store['issueMappingRepo'];
  let config: Map<string, string>;
  let secrets: { getSecret: jest.Mock; ensureCacheLoaded: jest.Mock };
  let logger: Logger;
  let linearApi: {
    exchangeCode: jest.Mock;
    refresh: jest.Mock;
    revoke: jest.Mock;
    graphql: jest.Mock;
    toRpcException: (err: unknown) => RpcException;
  };
  let tokenCipher: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    store = createIntegrationStore();
    projectMappingRepo = store.projectMappingRepo;
    issueMappingRepo = store.issueMappingRepo;

    config = new Map([
      ['NODE_ENV', 'development'],
      ['LINEAR_CLIENT_ID', 'linear-client-id'],
    ]);
    secrets = {
      getSecret: jest.fn(() => undefined),
      ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
    };
    logger = createLoggerMock();

    // The real error mapping: what a gRPC caller gets is part of the contract.
    const realClient = new LinearApiClient(
      { get: (key: string) => config.get(key) } as unknown as ConfigService,
      secrets as unknown as SecretsService,
      logger,
    );
    linearApi = {
      exchangeCode: jest.fn(),
      refresh: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      graphql: jest.fn(),
      toRpcException: (err) => realClient.toRpcException(err),
    };
    tokenCipher = {
      encrypt: jest.fn(async (plain: string) => `enc(${plain})`),
      decrypt: jest.fn(async (stored: string) =>
        stored.replace(/^enc\((.*)\)$/, '$1'),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinearService,
        {
          provide: getRepositoryToken(LinearIntegration),
          useValue: store.repo,
        },
        {
          provide: getRepositoryToken(LinearProjectMapping),
          useValue: projectMappingRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityIssueMapping),
          useValue: issueMappingRepo,
        },
        { provide: LinearApiClient, useValue: linearApi },
        { provide: TokenCipherService, useValue: tokenCipher },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config.get(key) },
        },
        { provide: SecretsService, useValue: secrets },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    service = module.get(LinearService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateOAuthUrl', () => {
    it('asks for read,write as the app', () => {
      const { installUrl } = service.generateOAuthUrl({
        redirectUri: REDIRECT_URI,
        state: 'st+ate/=',
      });

      const url = new URL(installUrl);
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://linear.app/oauth/authorize',
      );
      expect(installUrl).toContain('scope=read%2Cwrite');
      expect(installUrl).toContain(
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      );
      expect(installUrl).toContain('state=st%2Bate%2F%3D');
      expect(url.searchParams.get('client_id')).toBe('linear-client-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('actor')).toBe('app');
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('reads the client id from the secrets outside development', () => {
      config.set('NODE_ENV', 'production');
      secrets.getSecret.mockImplementation((key: string) =>
        key === 'LINEAR_CLIENT_ID' ? 'secret-client-id' : undefined,
      );

      const { installUrl } = service.generateOAuthUrl({
        redirectUri: REDIRECT_URI,
        state: 's',
      });

      expect(new URL(installUrl).searchParams.get('client_id')).toBe(
        'secret-client-id',
      );
    });

    it('refuses to build a URL without a client id, as a configuration refusal', () => {
      config.delete('LINEAR_CLIENT_ID');

      let thrown: unknown;
      try {
        service.generateOAuthUrl({ redirectUri: REDIRECT_URI, state: 's' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'LINEAR_NOT_CONFIGURED',
      });
    });
  });

  describe('callbackInstall', () => {
    beforeEach(() => {
      linearApi.exchangeCode.mockResolvedValue(NEW_TOKENS);
      linearApi.graphql.mockResolvedValue({
        viewer: {
          organization: { id: 'lin-org-1', name: 'Acme', urlKey: 'acme' },
        },
      });
    });

    it('stores the workspace with encrypted tokens', async () => {
      const result = await service.callbackInstall({
        organizationId: 'org-1',
        userId: 'user-1',
        code: 'the-code',
        redirectUri: REDIRECT_URI,
      });

      expect(result).toEqual({ returnUri: REDIRECT_URI });
      expect(linearApi.exchangeCode).toHaveBeenCalledWith(
        'the-code',
        REDIRECT_URI,
      );
      const [token, query] = linearApi.graphql.mock.calls[0];
      expect(token).toBe('access-2');
      expect(query.replace(/\s+/g, ' ')).toContain(
        'viewer { organization { id name urlKey } }',
      );
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        organizationId: 'org-1',
        linearOrganizationId: 'lin-org-1',
        workspaceName: 'Acme',
        workspaceUrlKey: 'acme',
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        tokenExpiresAt: new Date(NOW + ONE_DAY_S * 1000),
        needsReconnect: false,
        installedByUserId: 'user-1',
      });
    });

    // The Linear admin uninstalled the app, the organisation
    // connects the same workspace again.
    it('callbackInstall by the same organisation replaces the tokens and clears needsReconnect', async () => {
      store.rows.push(integrationRow({ needsReconnect: true }));
      store.projectMappings.push({ integrationId: 'int-1', projectId: 'p-1' });
      store.issueLinks.push({
        platform: IssuePlatform.LINEAR,
        linearOrganizationId: 'lin-org-1',
        vulnerabilityId: 'v-1',
      });

      await service.callbackInstall({
        organizationId: 'org-1',
        userId: 'user-2',
        code: 'the-code',
        redirectUri: REDIRECT_URI,
      });

      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        id: 'int-1',
        organizationId: 'org-1',
        linearOrganizationId: 'lin-org-1',
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        tokenExpiresAt: new Date(NOW + ONE_DAY_S * 1000),
        needsReconnect: false,
      });
      // Project settings and ticket links are kept.
      expect(store.projectMappings).toHaveLength(1);
      expect(store.issueLinks).toHaveLength(1);
      expect(linearApi.revoke).not.toHaveBeenCalled();
    });

    it('reconnecting the organisation on another workspace disconnects the previous one first', async () => {
      store.rows.push(integrationRow());
      store.projectMappings.push(
        { integrationId: 'int-1', projectId: 'p-1' },
        { integrationId: 'int-other', projectId: 'p-9' },
      );
      store.issueLinks.push(
        {
          platform: IssuePlatform.LINEAR,
          linearOrganizationId: 'lin-org-1',
          vulnerabilityId: 'v-1',
        },
        {
          platform: IssuePlatform.LINEAR,
          linearOrganizationId: 'lin-org-other',
          vulnerabilityId: 'v-2',
        },
        { platform: IssuePlatform.JIRA, vulnerabilityId: 'v-1' },
      );
      linearApi.graphql.mockResolvedValue({
        viewer: {
          organization: { id: 'lin-org-2', name: 'Beta', urlKey: 'beta' },
        },
      });
      const workspaceAtRevocation: string[] = [];
      linearApi.revoke.mockImplementation(async () => {
        workspaceAtRevocation.push(store.rows[0].linearOrganizationId);
      });

      await service.callbackInstall({
        organizationId: 'org-1',
        userId: 'user-2',
        code: 'the-code',
        redirectUri: REDIRECT_URI,
      });

      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        id: 'int-1',
        organizationId: 'org-1',
        linearOrganizationId: 'lin-org-2',
        workspaceName: 'Beta',
        workspaceUrlKey: 'beta',
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        needsReconnect: false,
        installedByUserId: 'user-2',
      });
      // The previous workspace's settings and Linear ticket links are gone.
      expect(store.projectMappings).toEqual([
        { integrationId: 'int-other', projectId: 'p-9' },
      ]);
      expect(store.issueLinks).toEqual([
        {
          platform: IssuePlatform.LINEAR,
          linearOrganizationId: 'lin-org-other',
          vulnerabilityId: 'v-2',
        },
        { platform: IssuePlatform.JIRA, vulnerabilityId: 'v-1' },
      ]);
      // Its grant is revoked once the switch is committed.
      expect(
        linearApi.revoke.mock.calls.map(([token]) => token).sort(),
      ).toEqual(['access-1', 'refresh-1']);
      expect(workspaceAtRevocation).toEqual(['lin-org-2', 'lin-org-2']);
    });

    it('callbackInstall of a workspace linked to another organisation keeps that organisation working', async () => {
      store.rows.push(
        integrationRow({
          id: 'int-a',
          organizationId: 'org-a',
          installedByUserId: 'user-a',
        }),
      );

      await expect(
        service.callbackInstall({
          organizationId: 'org-b',
          userId: 'user-b',
          code: 'the-code',
          redirectUri: REDIRECT_URI,
        }),
      ).rejects.toMatchObject(
        refusal(status.ALREADY_EXISTS, 'LINEAR_WORKSPACE_TAKEN'),
      );

      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        id: 'int-a',
        organizationId: 'org-a',
        installedByUserId: 'user-a',
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        tokenExpiresAt: new Date(NOW + ONE_DAY_S * 1000),
      });
      expect(store.rows.some((row) => row.organizationId === 'org-b')).toBe(
        false,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linearOrganizationId: 'lin-org-1',
          ownerOrganizationId: 'org-a',
          requestingOrganizationId: 'org-b',
        }),
        expect.any(String),
      );
    });

    it('stores nothing when Linear refuses the code', async () => {
      linearApi.exchangeCode.mockRejectedValue(
        new LinearApiError('invalid_grant', 'Linear token failed'),
      );

      await expect(
        service.callbackInstall({
          organizationId: 'org-1',
          userId: 'user-1',
          code: 'used-code',
          redirectUri: REDIRECT_URI,
        }),
      ).rejects.toBeInstanceOf(RpcException);

      expect(store.rows).toHaveLength(0);
      expect(linearApi.graphql).not.toHaveBeenCalled();
    });

    describe('when another install commits at the same time', () => {
      const install = () =>
        service.callbackInstall({
          organizationId: 'org-b',
          userId: 'user-b',
          code: 'the-code',
          redirectUri: REDIRECT_URI,
        });

      it('retries once after a duplicate entry and sees the committed row', async () => {
        store.failNextSaves({
          error: mysqlError(
            'ER_DUP_ENTRY',
            1062,
            "Duplicate entry 'lin-org-1' for key 'UQ_linear_integrations_linearOrganizationId'",
          ),
          // Organisation A's install of the same workspace commits first.
          before: () =>
            store.rows.push(
              integrationRow({
                id: 'int-a',
                organizationId: 'org-a',
                installedByUserId: 'user-a',
              }),
            ),
        });

        await expect(install()).rejects.toMatchObject(
          refusal(status.ALREADY_EXISTS, 'LINEAR_WORKSPACE_TAKEN'),
        );

        expect(store.repo.manager.transaction).toHaveBeenCalledTimes(2);
        expect(store.rows).toHaveLength(1);
        expect(store.rows[0]).toMatchObject({
          id: 'int-a',
          organizationId: 'org-a',
          accessToken: 'enc(access-2)',
        });
        // The new token is stored on A: it is not revoked.
        expect(linearApi.revoke).not.toHaveBeenCalled();
      });

      it('retries once after a deadlock', async () => {
        store.failNextSaves({
          error: mysqlError(
            'ER_LOCK_DEADLOCK',
            1213,
            'Deadlock found when trying to get lock; try restarting transaction',
          ),
        });

        await expect(install()).resolves.toEqual({ returnUri: REDIRECT_URI });

        expect(store.repo.manager.transaction).toHaveBeenCalledTimes(2);
        expect(store.rows).toHaveLength(1);
        expect(store.rows[0]).toMatchObject({
          organizationId: 'org-b',
          linearOrganizationId: 'lin-org-1',
        });
      });

      // The Community Edition runs on PostgreSQL: its codes are races too.
      it.each([
        ['23505', 'duplicate key value violates unique constraint'],
        ['40P01', 'deadlock detected'],
      ])('retries once after PostgreSQL error %s', async (code, text) => {
        store.failNextSaves({ error: mysqlError(code, 0, text) });

        await expect(install()).resolves.toEqual({ returnUri: REDIRECT_URI });

        expect(store.repo.manager.transaction).toHaveBeenCalledTimes(2);
      });

      it('revokes the new token and answers a fixed error when the retry fails too', async () => {
        const deadlock = () => ({
          error: mysqlError(
            'ER_LOCK_DEADLOCK',
            1213,
            'Deadlock found when trying to get lock; try restarting transaction',
          ),
        });
        store.failNextSaves(deadlock(), deadlock());

        const error = await install().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(RpcException);
        expect((error as RpcException).getError()).toEqual({
          code: status.INTERNAL,
          message: 'Linear request failed',
        });
        expect(store.repo.manager.transaction).toHaveBeenCalledTimes(2);
        expect(store.rows).toHaveLength(0);
        expect(
          linearApi.revoke.mock.calls.map(([token]) => token).sort(),
        ).toEqual(['access-2', 'refresh-2']);
      });

      it('does not retry another database failure', async () => {
        store.failNextSaves({
          error: mysqlError('ER_DATA_TOO_LONG', 1406, 'Data too long'),
        });

        await expect(install()).rejects.toMatchObject(
          refusal(status.INTERNAL, 'Linear request failed'),
        );

        expect(store.repo.manager.transaction).toHaveBeenCalledTimes(1);
        expect(linearApi.revoke).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('getInstallationForOrga', () => {
    it('returns is_configured false without a row', async () => {
      const result = await service.getInstallationForOrga({
        organizationId: 'org-1',
      });

      expect(result).toMatchObject({
        isConfigured: false,
        id: '',
        linearOrganizationId: '',
        needsReconnect: false,
      });
    });

    it('exposes needs_reconnect', async () => {
      // MySQL hands a tinyint back as a number.
      store.rows.push(
        integrationRow({ needsReconnect: 1 as unknown as boolean }),
      );

      const result = await service.getInstallationForOrga({
        organizationId: 'org-1',
      });

      expect(result).toEqual({
        isConfigured: true,
        id: 'int-1',
        linearOrganizationId: 'lin-org-1',
        workspaceName: 'Acme',
        workspaceUrlKey: 'acme',
        organizationId: 'org-1',
        installedByUserId: 'user-1',
        needsReconnect: true,
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: '2026-10-02T09:00:00.000Z',
      });
    });
  });

  describe('getIntegrationForOrga', () => {
    it('refuses with LINEAR_NOT_CONNECTED without a row', async () => {
      await expect(
        service.getIntegrationForOrga('org-1'),
      ).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NOT_CONNECTED'),
      );
    });

    it('refuses with LINEAR_NEEDS_RECONNECT when the workspace must be connected again', async () => {
      store.rows.push(
        integrationRow({ needsReconnect: 1 as unknown as boolean }),
      );

      await expect(
        service.getIntegrationForOrga('org-1'),
      ).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NEEDS_RECONNECT'),
      );
    });

    it('returns the integration of the organisation', async () => {
      store.rows.push(integrationRow());

      await expect(
        service.getIntegrationForOrga('org-1'),
      ).resolves.toMatchObject({
        id: 'int-1',
        linearOrganizationId: 'lin-org-1',
      });
    });
  });

  describe('linearCall', () => {
    it('calls Linear with the stored token while it is valid', async () => {
      store.rows.push(integrationRow());
      linearApi.graphql.mockResolvedValue({ viewer: { id: 'app-user' } });

      const data = await service.linearCall(
        store.load('int-1'),
        QUERY,
        { first: 1 },
        { retryOnServerError: false },
      );

      expect(data).toEqual({ viewer: { id: 'app-user' } });
      expect(linearApi.graphql).toHaveBeenCalledWith(
        'access-1',
        QUERY,
        { first: 1 },
        { retryOnServerError: false },
      );
      expect(store.repo.manager.transaction).not.toHaveBeenCalled();
      expect(linearApi.refresh).not.toHaveBeenCalled();
    });

    it('linearCall refreshes an expiring token under a pessimistic_write lock', async () => {
      store.rows.push(
        integrationRow({ tokenExpiresAt: new Date(NOW + 200_000) }),
      );
      linearApi.refresh.mockResolvedValue(NEW_TOKENS);
      linearApi.graphql.mockResolvedValue({ ok: true });
      const integration = store.load('int-1');

      await expect(service.linearCall(integration, QUERY)).resolves.toEqual({
        ok: true,
      });

      expect(store.transactionReads).toEqual([
        {
          entity: LinearIntegration,
          options: expect.objectContaining({
            where: { id: 'int-1' },
            lock: { mode: 'pessimistic_write' },
          }),
        },
      ]);
      expect(linearApi.refresh).toHaveBeenCalledWith('refresh-1');
      expect(linearApi.graphql).toHaveBeenCalledWith(
        'access-2',
        QUERY,
        undefined,
        undefined,
      );
      // Saved by the transaction that holds the lock.
      expect(store.transactionWrites).toHaveLength(1);
      expect(store.repo.update).not.toHaveBeenCalled();
      expect(store.rows[0]).toMatchObject({
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        tokenExpiresAt: new Date(NOW + ONE_DAY_S * 1000),
      });

      // The caller's integration now carries the new token: the next call
      // takes the fast path.
      await service.linearCall(integration, QUERY);
      expect(store.repo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(linearApi.graphql).toHaveBeenLastCalledWith(
        'access-2',
        QUERY,
        undefined,
        undefined,
      );
    });

    // Linear rotates the refresh token, a second refresh with
    // the consumed one would fail.
    it('two concurrent calls with an expired token refresh once', async () => {
      store.rows.push(integrationRow({ tokenExpiresAt: new Date(NOW - 1000) }));
      linearApi.refresh.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return NEW_TOKENS;
      });
      linearApi.graphql.mockImplementation(async (token: string) => ({
        token,
      }));

      const results = await Promise.all([
        service.linearCall(store.load('int-1'), QUERY),
        service.linearCall(store.load('int-1'), QUERY),
      ]);

      expect(linearApi.refresh).toHaveBeenCalledTimes(1);
      expect(results).toEqual([{ token: 'access-2' }, { token: 'access-2' }]);
      expect(store.rows[0].refreshToken).toBe('enc(refresh-2)');
    });

    it('linearCall retries once after an unauthorized answer', async () => {
      store.rows.push(integrationRow());
      linearApi.refresh.mockResolvedValue(NEW_TOKENS);
      linearApi.graphql
        .mockRejectedValueOnce(
          new LinearApiError('unauthorized', 'Linear graphql failed'),
        )
        .mockResolvedValueOnce({ ok: true });

      await expect(
        service.linearCall(store.load('int-1'), QUERY),
      ).resolves.toEqual({ ok: true });

      expect(linearApi.graphql).toHaveBeenCalledTimes(2);
      expect(linearApi.graphql.mock.calls.map(([token]) => token)).toEqual([
        'access-1',
        'access-2',
      ]);
      expect(linearApi.refresh).toHaveBeenCalledTimes(1);
      // The refresh after the refusal goes through the same lock.
      expect(store.transactionReads).toEqual([
        {
          entity: LinearIntegration,
          options: expect.objectContaining({
            lock: { mode: 'pessimistic_write' },
          }),
        },
      ]);
      expect(store.rows[0]).toMatchObject({
        accessToken: 'enc(access-2)',
        refreshToken: 'enc(refresh-2)',
        needsReconnect: false,
      });
    });

    it('two calls refused with the same token refresh once', async () => {
      store.rows.push(integrationRow());
      linearApi.refresh.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return NEW_TOKENS;
      });
      linearApi.graphql.mockImplementation(async (token: string) => {
        if (token === 'access-1') {
          throw new LinearApiError('unauthorized', 'Linear graphql failed');
        }
        return { token };
      });

      const results = await Promise.all([
        service.linearCall(store.load('int-1'), QUERY),
        service.linearCall(store.load('int-1'), QUERY),
      ]);

      expect(linearApi.refresh).toHaveBeenCalledTimes(1);
      expect(results).toEqual([{ token: 'access-2' }, { token: 'access-2' }]);
    });

    it('an invalid_grant marks the integration needsReconnect and refuses with LINEAR_NEEDS_RECONNECT', async () => {
      store.rows.push(integrationRow({ tokenExpiresAt: new Date(NOW - 1000) }));
      linearApi.refresh.mockRejectedValue(
        new LinearApiError('invalid_grant', 'Linear token failed'),
      );

      await expect(
        service.linearCall(store.load('int-1'), QUERY),
      ).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NEEDS_RECONNECT'),
      );

      expect(store.rows[0].needsReconnect).toBe(true);
      // Nothing else of the row changed.
      expect(store.rows[0].refreshToken).toBe('enc(refresh-1)');
      expect(linearApi.graphql).not.toHaveBeenCalled();
    });

    it('an expired token without a refresh token marks the integration needsReconnect', async () => {
      store.rows.push(
        integrationRow({
          tokenExpiresAt: new Date(NOW - 1000),
          refreshToken: null,
        }),
      );

      await expect(
        service.linearCall(store.load('int-1'), QUERY),
      ).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NEEDS_RECONNECT'),
      );

      expect(linearApi.refresh).not.toHaveBeenCalled();
      expect(store.rows[0].needsReconnect).toBe(true);
    });

    it('a token still refused after the refresh marks the integration needsReconnect', async () => {
      store.rows.push(integrationRow());
      linearApi.refresh.mockResolvedValue(NEW_TOKENS);
      linearApi.graphql.mockRejectedValue(
        new LinearApiError('unauthorized', 'Linear graphql failed'),
      );

      await expect(
        service.linearCall(store.load('int-1'), QUERY),
      ).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NEEDS_RECONNECT'),
      );

      expect(linearApi.graphql).toHaveBeenCalledTimes(2);
      expect(linearApi.refresh).toHaveBeenCalledTimes(1);
      expect(store.rows[0].needsReconnect).toBe(true);
    });

    it('maps any other Linear failure without refreshing', async () => {
      store.rows.push(integrationRow());
      linearApi.graphql.mockRejectedValue(
        new LinearApiError('rate_limited', 'Linear graphql failed'),
      );

      await expect(
        service.linearCall(store.load('int-1'), QUERY),
      ).rejects.toMatchObject(
        refusal(status.RESOURCE_EXHAUSTED, 'Linear rate limit reached'),
      );

      expect(linearApi.refresh).not.toHaveBeenCalled();
      expect(store.rows[0].needsReconnect).toBe(false);
    });

    it('refuses with LINEAR_NOT_CONNECTED when the integration was removed meanwhile', async () => {
      const gone = integrationRow({ tokenExpiresAt: new Date(NOW - 1000) });

      await expect(service.linearCall(gone, QUERY)).rejects.toMatchObject(
        refusal(status.FAILED_PRECONDITION, 'LINEAR_NOT_CONNECTED'),
      );

      expect(linearApi.refresh).not.toHaveBeenCalled();
    });
  });

  describe('markNeedsReconnect', () => {
    it('flags the integration of the workspace', async () => {
      store.rows.push(integrationRow());
      store.rows.push(
        integrationRow({
          id: 'int-2',
          organizationId: 'org-2',
          linearOrganizationId: 'lin-org-2',
        }),
      );

      await service.markNeedsReconnect('lin-org-1');

      expect(store.rows.map((row) => row.needsReconnect)).toEqual([
        true,
        false,
      ]);
    });
  });

  describe('disconnect', () => {
    it('disconnect revokes, then deletes the integration, its project settings and its Linear issue links', async () => {
      store.rows.push(integrationRow());

      const result = await service.disconnect({ organizationId: 'org-1' });

      expect(result).toEqual({
        success: true,
        message: 'Linear integration disconnected',
      });
      // Both stored tokens are revoked.
      expect(
        linearApi.revoke.mock.calls.map(([token]) => token).sort(),
      ).toEqual(['access-1', 'refresh-1']);
      expect(issueMappingRepo.delete).toHaveBeenCalledWith({
        platform: IssuePlatform.LINEAR,
        linearOrganizationId: 'lin-org-1',
      });
      expect(projectMappingRepo.delete).toHaveBeenCalledWith({
        integrationId: 'int-1',
      });
      expect(store.rows).toHaveLength(0);

      const lastRevocation = Math.max(
        ...linearApi.revoke.mock.invocationCallOrder,
      );
      expect(lastRevocation).toBeLessThan(
        issueMappingRepo.delete.mock.invocationCallOrder[0],
      );
      expect(lastRevocation).toBeLessThan(
        projectMappingRepo.delete.mock.invocationCallOrder[0],
      );
      expect(lastRevocation).toBeLessThan(
        store.repo.remove.mock.invocationCallOrder[0],
      );
    });

    it('revokes the access token alone when no refresh token is stored', async () => {
      store.rows.push(integrationRow({ refreshToken: null }));

      await service.disconnect({ organizationId: 'org-1' });

      expect(linearApi.revoke.mock.calls).toEqual([['access-1']]);
    });

    it('disconnect still deletes when the revocation fails', async () => {
      store.rows.push(integrationRow());
      linearApi.revoke.mockImplementation(async (token: string) => {
        if (token === 'refresh-1') {
          throw new LinearApiError('invalid', 'Linear revoke failed', 400);
        }
      });

      const result = await service.disconnect({ organizationId: 'org-1' });

      expect(result.success).toBe(true);
      // The other token is still revoked.
      expect(linearApi.revoke).toHaveBeenCalledWith('access-1');
      expect(issueMappingRepo.delete).toHaveBeenCalled();
      expect(projectMappingRepo.delete).toHaveBeenCalled();
      expect(store.rows).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', reason: 'invalid' }),
        expect.any(String),
      );
      const logged = JSON.stringify((logger.warn as jest.Mock).mock.calls);
      expect(logged).not.toContain('refresh-1');
      expect(logged).not.toContain('access-1');
    });

    it('disconnect is idempotent without a row', async () => {
      const result = await service.disconnect({ organizationId: 'org-1' });

      expect(result).toEqual({
        success: true,
        message: 'Linear integration disconnected',
      });
      expect(linearApi.revoke).not.toHaveBeenCalled();
      expect(issueMappingRepo.delete).not.toHaveBeenCalled();
      expect(projectMappingRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('Linear teams and project settings', () => {
    let workspace: FakeWorkspace;

    beforeEach(() => {
      workspace = fakeWorkspace();
      installFakeLinear(linearApi.graphql, workspace);
      store.rows.push(integrationRow());
    });

    const queriesSent = () =>
      linearApi.graphql.mock.calls.map(([, query]) => query as string);

    describe('listTeams', () => {
      it('listTeams returns id, key and name of every team, following the pages', async () => {
        workspace.teams = manyTeams(120);

        const result = await service.listTeams({ organizationId: 'org-1' });

        expect(result.teams).toHaveLength(120);
        expect(result.teams[0]).toEqual({
          id: 'team-1',
          key: 'T1',
          name: 'Team 1',
        });
        expect(result.teams[119]).toEqual({
          id: 'team-120',
          key: 'T120',
          name: 'Team 120',
        });
        const calls = linearApi.graphql.mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls.map(([token]) => token)).toEqual([
          'access-1',
          'access-1',
          'access-1',
        ]);
        expect(calls.map(([, , variables]) => variables?.after)).toEqual([
          undefined,
          '50',
          '100',
        ]);
      });

      it('listTeams stops at 250 teams', async () => {
        workspace.teams = manyTeams(400);

        const result = await service.listTeams({ organizationId: 'org-1' });

        expect(result.teams).toHaveLength(250);
        expect(result.teams[249].id).toBe('team-250');
        expect(linearApi.graphql).toHaveBeenCalledTimes(5);
      });

      it('listTeams refuses with LINEAR_NOT_CONNECTED without an integration', async () => {
        store.rows.length = 0;

        await expect(
          service.listTeams({ organizationId: 'org-1' }),
        ).rejects.toMatchObject(
          refusal(status.FAILED_PRECONDITION, 'LINEAR_NOT_CONNECTED'),
        );
        expect(linearApi.graphql).not.toHaveBeenCalled();
      });
    });

    describe('getTeamOptions', () => {
      it("getTeamOptions returns the team's projects, the team and workspace labels, and active human members", async () => {
        const result = await service.getTeamOptions({
          organizationId: 'org-1',
          teamId: 'team-eng',
        });

        expect(result.projects).toEqual([
          { id: 'lp-1', name: 'Q4 hardening' },
          { id: 'lp-2', name: 'Platform' },
        ]);
        expect(result.labels).toEqual([
          { id: 'lbl-sec', name: 'Security' },
          { id: 'lbl-bug', name: 'Bug' },
          { id: 'lbl-ws', name: 'Customer' },
        ]);
        // The app user and the deactivated member are not assignable.
        expect(result.members).toEqual([
          { id: 'u-1', name: 'Ada Lovelace', displayName: 'ada' },
        ]);
        const workspaceQuery = queriesSent().find((q) =>
          q.includes('issueLabels'),
        );
        expect(workspaceQuery.replace(/\s+/g, ' ')).toContain(
          'filter: { team: { null: true } }',
        );
      });

      it('lists a label once when the team and the workspace both return it', async () => {
        workspace.workspaceLabels.push({ id: 'lbl-sec', name: 'Security' });

        const result = await service.getTeamOptions({
          organizationId: 'org-1',
          teamId: 'team-eng',
        });

        expect(result.labels.map((label) => label.id)).toEqual([
          'lbl-sec',
          'lbl-bug',
          'lbl-ws',
        ]);
      });

      it('follows the pages of projects, labels and members', async () => {
        workspace.teams['team-eng'].projects = manyItems(120, 'proj');
        workspace.teams['team-eng'].labels = manyItems(60, 'lbl');
        workspace.workspaceLabels = manyItems(55, 'ws');
        workspace.teams['team-eng'].members = manyItems(70, 'user').map(
          ({ id, name }) => ({
            id,
            name,
            displayName: name,
            active: true,
            app: false,
          }),
        );

        const result = await service.getTeamOptions({
          organizationId: 'org-1',
          teamId: 'team-eng',
        });

        expect(result.projects).toHaveLength(120);
        expect(result.labels).toHaveLength(115);
        expect(result.members).toHaveLength(70);
      });

      it('refuses a team of another workspace with LINEAR_TEAM_NOT_FOUND', async () => {
        await expect(
          service.getTeamOptions({
            organizationId: 'org-1',
            teamId: 'team-elsewhere',
          }),
        ).rejects.toMatchObject(
          refusal(status.NOT_FOUND, 'LINEAR_TEAM_NOT_FOUND'),
        );
      });

      it('refuses with LINEAR_NEEDS_RECONNECT when the workspace must be connected again', async () => {
        store.rows[0].needsReconnect = true;

        await expect(
          service.getTeamOptions({
            organizationId: 'org-1',
            teamId: 'team-eng',
          }),
        ).rejects.toMatchObject(
          refusal(status.FAILED_PRECONDITION, 'LINEAR_NEEDS_RECONNECT'),
        );
        expect(linearApi.graphql).not.toHaveBeenCalled();
      });

      it('refuses a request without a team', async () => {
        await expect(
          service.getTeamOptions({ organizationId: 'org-1', teamId: '' }),
        ).rejects.toMatchObject(
          refusal(status.INVALID_ARGUMENT, 'teamId is required'),
        );
        expect(linearApi.graphql).not.toHaveBeenCalled();
      });
    });

    describe('setProjectLinearConfig', () => {
      it('setProjectLinearConfig resolves names from Linear, not from the request', async () => {
        const result = await service.setProjectLinearConfig({
          ...setRequest({
            linearProjectId: 'lp-1',
            labelIds: ['lbl-sec', 'lbl-ws', 'lbl-sec'],
            allowedBranches: ['main'],
            autoCreateEnabled: true,
          }),
          // Names a caller makes up must never be stored.
          teamKey: 'EVIL',
          teamName: 'Evil team',
          linearProjectName: 'Evil project',
          labels: [{ id: 'lbl-sec', name: 'Evil label' }],
        } as SetProjectLinearConfigRequest);

        expect(result).toEqual({
          success: true,
          message: expect.any(String),
        });
        expect(store.projectMappings).toEqual([
          expect.objectContaining({
            integrationId: 'int-1',
            projectId: 'p-1',
            teamId: 'team-eng',
            teamKey: 'ENG',
            teamName: 'Engineering',
            linearProjectId: 'lp-1',
            linearProjectName: 'Q4 hardening',
            labels: JSON.stringify([
              { id: 'lbl-sec', name: 'Security' },
              { id: 'lbl-ws', name: 'Customer' },
            ]),
            allowedBranches: JSON.stringify(['main']),
            autoCreateEnabled: true,
          }),
        ]);
      });

      it('setProjectLinearConfig refuses a team of another workspace with LINEAR_TEAM_NOT_FOUND', async () => {
        await expect(
          service.setProjectLinearConfig(
            setRequest({ teamId: 'team-elsewhere' }),
          ),
        ).rejects.toMatchObject(
          refusal(status.NOT_FOUND, 'LINEAR_TEAM_NOT_FOUND'),
        );
        expect(store.projectMappings).toHaveLength(0);
      });

      it('setProjectLinearConfig refuses a project outside the team', async () => {
        await expect(
          service.setProjectLinearConfig(
            setRequest({ teamId: 'team-eng', linearProjectId: 'lp-ops' }),
          ),
        ).rejects.toMatchObject(
          refusal(
            status.INVALID_ARGUMENT,
            'Linear project does not belong to the team',
          ),
        );
        expect(store.projectMappings).toHaveLength(0);
      });

      it('setProjectLinearConfig refuses an unknown label', async () => {
        await expect(
          service.setProjectLinearConfig(
            setRequest({ labelIds: ['lbl-sec', 'lbl-nope'] }),
          ),
        ).rejects.toMatchObject(
          refusal(status.INVALID_ARGUMENT, 'Unknown Linear label'),
        );
        expect(store.projectMappings).toHaveLength(0);
      });

      it("refuses a label of another team's", async () => {
        await expect(
          service.setProjectLinearConfig(setRequest({ labelIds: ['lbl-ops'] })),
        ).rejects.toMatchObject(
          refusal(status.INVALID_ARGUMENT, 'Unknown Linear label'),
        );
        expect(store.projectMappings).toHaveLength(0);
      });

      it('setProjectLinearConfig stores allowed branches as JSON, null when empty, upserting on projectId', async () => {
        await service.setProjectLinearConfig(
          setRequest({ allowedBranches: ['main', 'release/1.x'] }),
        );
        expect(store.projectMappings).toHaveLength(1);
        expect(store.projectMappings[0].allowedBranches).toBe(
          '["main","release/1.x"]',
        );
        const { id } = store.projectMappings[0];

        await service.setProjectLinearConfig(setRequest());

        expect(store.projectMappings).toHaveLength(1);
        expect(store.projectMappings[0].id).toBe(id);
        expect(store.projectMappings[0].allowedBranches).toBeNull();
      });

      // The dashboard re-sends the whole config on every change.
      it('replaces the whole configuration: an empty project, labels and branches clear what was stored', async () => {
        await service.setProjectLinearConfig(
          setRequest({
            linearProjectId: 'lp-1',
            labelIds: ['lbl-sec'],
            allowedBranches: ['main'],
            autoCreateEnabled: true,
          }),
        );

        await service.setProjectLinearConfig(
          setRequest({ teamId: 'team-ops', autoCreateEnabled: false }),
        );

        expect(store.projectMappings).toHaveLength(1);
        expect(store.projectMappings[0]).toMatchObject({
          teamId: 'team-ops',
          teamKey: 'OPS',
          teamName: 'Operations',
          linearProjectId: null,
          linearProjectName: null,
          labels: null,
          allowedBranches: null,
          autoCreateEnabled: false,
        });
      });

      it('asks Linear for the team alone when no project and no label is chosen', async () => {
        await service.setProjectLinearConfig(setRequest());

        const queries = queriesSent();
        expect(queries).toHaveLength(1);
        expect(queries[0]).toContain('team(id:');
        expect(queries[0]).not.toContain('projects(');
        expect(queries[0]).not.toContain('labels(');
      });

      it('leaves the settings of a project of another organisation alone', async () => {
        store.rows.push(
          integrationRow({
            id: 'int-2',
            organizationId: 'org-2',
            linearOrganizationId: 'lin-org-2',
          }),
        );
        store.projectMappings.push(
          mappingRow({ integrationId: 'int-2', teamKey: 'OTHER' }),
        );

        await expect(
          service.setProjectLinearConfig(setRequest()),
        ).rejects.toMatchObject(
          refusal(status.PERMISSION_DENIED, 'Permission denied'),
        );
        expect(store.projectMappings).toEqual([
          expect.objectContaining({ integrationId: 'int-2', teamKey: 'OTHER' }),
        ]);
      });

      it('saves again when another save inserted the same project first', async () => {
        store.beforeNextMappingSave(() => {
          store.projectMappings.push(
            mappingRow({ id: 'map-raced', teamKey: 'OLD' }),
          );
        });

        await service.setProjectLinearConfig(setRequest());

        expect(store.projectMappings).toHaveLength(1);
        expect(store.projectMappings[0]).toMatchObject({
          id: 'map-raced',
          teamKey: 'ENG',
        });
      });

      it('refuses with LINEAR_NOT_CONNECTED before asking Linear anything', async () => {
        store.rows.length = 0;

        await expect(
          service.setProjectLinearConfig(setRequest()),
        ).rejects.toMatchObject(
          refusal(status.FAILED_PRECONDITION, 'LINEAR_NOT_CONNECTED'),
        );
        expect(linearApi.graphql).not.toHaveBeenCalled();
        expect(store.projectMappings).toHaveLength(0);
      });

      it.each([
        ['project', { projectId: '' }, 'projectId is required'],
        ['team', { teamId: '' }, 'teamId is required'],
      ])(
        'refuses a request without a %s',
        async (_name, overrides, message) => {
          await expect(
            service.setProjectLinearConfig(setRequest(overrides)),
          ).rejects.toMatchObject(refusal(status.INVALID_ARGUMENT, message));
          expect(linearApi.graphql).not.toHaveBeenCalled();
          expect(store.projectMappings).toHaveLength(0);
        },
      );
    });

    describe('getProjectLinearConfig', () => {
      it('returns the settings of the project', async () => {
        store.projectMappings.push(
          mappingRow({
            linearProjectId: 'lp-1',
            linearProjectName: 'Q4 hardening',
            labels: '[{"id":"lbl-sec","name":"Security"}]',
            allowedBranches: '["main","dev"]',
            // MySQL hands a tinyint back as a number.
            autoCreateEnabled: 1,
          }),
        );

        const result = await service.getProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(result).toEqual({
          isConfigured: true,
          teamId: 'team-eng',
          teamKey: 'ENG',
          teamName: 'Engineering',
          linearProjectId: 'lp-1',
          linearProjectName: 'Q4 hardening',
          labels: [{ id: 'lbl-sec', name: 'Security' }],
          allowedBranches: ['main', 'dev'],
          autoCreateEnabled: true,
        });
      });

      it('is configured as soon as the project has a row, empty options included', async () => {
        store.projectMappings.push(mappingRow());

        const result = await service.getProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(result).toEqual({
          ...NOT_CONFIGURED,
          isConfigured: true,
          teamId: 'team-eng',
          teamKey: 'ENG',
          teamName: 'Engineering',
        });
      });

      it('answers while the workspace must be connected again', async () => {
        store.rows[0].needsReconnect = true;
        store.projectMappings.push(mappingRow());

        const result = await service.getProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(result.isConfigured).toBe(true);
      });

      it('returns is_configured false for a project without settings', async () => {
        await expect(
          service.getProjectLinearConfig({
            organizationId: 'org-1',
            projectId: 'p-1',
          }),
        ).resolves.toEqual(NOT_CONFIGURED);
      });

      it("getProjectLinearConfig returns is_configured false for another organisation's project", async () => {
        store.rows.push(
          integrationRow({
            id: 'int-2',
            organizationId: 'org-2',
            linearOrganizationId: 'lin-org-2',
          }),
        );
        store.projectMappings.push(
          mappingRow({ integrationId: 'int-2', teamKey: 'OTHER' }),
        );

        await expect(
          service.getProjectLinearConfig({
            organizationId: 'org-1',
            projectId: 'p-1',
          }),
        ).resolves.toEqual(NOT_CONFIGURED);
      });

      it('returns is_configured false when the caller names no organisation', async () => {
        store.projectMappings.push(mappingRow());

        await expect(
          service.getProjectLinearConfig({
            organizationId: '',
            projectId: 'p-1',
          }),
        ).resolves.toEqual(NOT_CONFIGURED);
      });

      it('reads labels and branches it cannot parse as empty', async () => {
        store.projectMappings.push(
          mappingRow({ labels: '{"not":"a list"', allowedBranches: '"main"' }),
        );

        const result = await service.getProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(result.isConfigured).toBe(true);
        expect(result.labels).toEqual([]);
        expect(result.allowedBranches).toEqual([]);
      });
    });

    describe('removeProjectLinearConfig', () => {
      it('removeProjectLinearConfig deletes only the project mapping', async () => {
        store.projectMappings.push(
          mappingRow(),
          mappingRow({ id: 'map-2', projectId: 'p-2' }),
        );
        store.issueLinks.push({
          platform: IssuePlatform.LINEAR,
          linearOrganizationId: 'lin-org-1',
          vulnerabilityId: 'v-1',
        });

        const result = await service.removeProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(result).toEqual({ success: true, message: expect.any(String) });
        expect(store.projectMappings).toEqual([
          expect.objectContaining({ id: 'map-2', projectId: 'p-2' }),
        ]);
        expect(store.issueLinks).toHaveLength(1);
        expect(store.rows).toHaveLength(1);
        expect(linearApi.revoke).not.toHaveBeenCalled();
      });

      it('removes the settings while the workspace must be connected again', async () => {
        store.rows[0].needsReconnect = true;
        store.projectMappings.push(mappingRow());

        await service.removeProjectLinearConfig({
          organizationId: 'org-1',
          projectId: 'p-1',
        });

        expect(store.projectMappings).toHaveLength(0);
      });

      it('refuses a project without settings', async () => {
        await expect(
          service.removeProjectLinearConfig({
            organizationId: 'org-1',
            projectId: 'p-1',
          }),
        ).rejects.toMatchObject(
          refusal(status.NOT_FOUND, 'No Linear config found for this project'),
        );
      });

      it("keeps the settings of another organisation's project", async () => {
        store.rows.push(
          integrationRow({
            id: 'int-2',
            organizationId: 'org-2',
            linearOrganizationId: 'lin-org-2',
          }),
        );
        store.projectMappings.push(mappingRow({ integrationId: 'int-2' }));

        await expect(
          service.removeProjectLinearConfig({
            organizationId: 'org-1',
            projectId: 'p-1',
          }),
        ).rejects.toMatchObject(
          refusal(status.PERMISSION_DENIED, 'Permission denied'),
        );
        expect(store.projectMappings).toHaveLength(1);
      });
    });

    describe('findProjectConfig', () => {
      it('returns the settings of the project with their integration', async () => {
        store.projectMappings.push(mappingRow());

        const mapping = await service.findProjectConfig('p-1');

        expect(mapping).toMatchObject({
          projectId: 'p-1',
          teamId: 'team-eng',
          integration: { id: 'int-1', organizationId: 'org-1' },
        });
      });

      it('returns null for a project without settings', async () => {
        await expect(service.findProjectConfig('p-1')).resolves.toBeNull();
      });

      it('never matches a row for a missing project id', async () => {
        store.projectMappings.push(mappingRow());

        await expect(service.findProjectConfig('')).resolves.toBeNull();
        await expect(
          service.findProjectConfig(undefined as unknown as string),
        ).resolves.toBeNull();
      });
    });
  });
});
