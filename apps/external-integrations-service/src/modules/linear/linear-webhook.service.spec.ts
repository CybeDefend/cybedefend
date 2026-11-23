import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { LinearWebhookService } from './linear-webhook.service';
import { LinearService } from './linear.service';
import SecretsService from '../../core/secrets/secrets.service';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';

const SECRET = 'whsec-linear-test';
const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const WORKSPACE = 'lin-workspace-1';
const ISSUE_ID = '2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9';

type Payload = Record<string, unknown>;

function sign(rawBody: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function issueData(overrides: Payload = {}): Payload {
  return {
    id: ISSUE_ID,
    identifier: 'ENG-42',
    url: 'https://linear.app/acme/issue/ENG-42/fix-sql-injection',
    title: 'Fix SQL injection',
    priority: 2,
    priorityLabel: 'High',
    state: {
      id: 'st-1',
      name: 'In Progress',
      type: 'started',
      color: '#f2c94c',
    },
    team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
    assignee: { id: 'user-1', name: 'Ada Lovelace' },
    ...overrides,
  };
}

function issueEvent(
  action: 'create' | 'update' | 'remove',
  data: Payload,
  overrides: Payload = {},
): Payload {
  return {
    action,
    type: 'Issue',
    data,
    organizationId: WORKSPACE,
    webhookTimestamp: NOW,
    webhookId: 'wh-1',
    createdAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('LinearWebhookService', () => {
  let service: LinearWebhookService;
  let integrationRepo: ReturnType<
    typeof createMockRepository<LinearIntegration>
  >;
  let issueMappingRepo: ReturnType<
    typeof createMockRepository<VulnerabilityIssueMapping>
  >;
  let linearService: { markNeedsReconnect: jest.Mock };
  let secrets: { getSecret: jest.Mock; ensureCacheLoaded: jest.Mock };
  let config: Map<string, string>;
  let logger: Logger;

  const deliver = (payload: Payload, now = NOW) => {
    const rawBody = JSON.stringify(payload);
    return service.handleWebhook({ rawBody, signature: sign(rawBody) }, now);
  };

  /** Nothing was read or written: the delivery stopped before the database. */
  const expectDatabaseUntouched = () => {
    expect(integrationRepo.findOne).not.toHaveBeenCalled();
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
    expect(linearService.markNeedsReconnect).not.toHaveBeenCalled();
  };

  /** A write of any kind on either repository, or a reconnect mark. */
  const expectNoWrite = () => {
    expect(issueMappingRepo.update).not.toHaveBeenCalled();
    expect(issueMappingRepo.save).not.toHaveBeenCalled();
    expect(issueMappingRepo.delete).not.toHaveBeenCalled();
    expect(issueMappingRepo.remove).not.toHaveBeenCalled();
    expect(integrationRepo.update).not.toHaveBeenCalled();
    expect(integrationRepo.save).not.toHaveBeenCalled();
    expect(integrationRepo.delete).not.toHaveBeenCalled();
    expect(integrationRepo.remove).not.toHaveBeenCalled();
    expect(linearService.markNeedsReconnect).not.toHaveBeenCalled();
  };

  beforeEach(async () => {
    integrationRepo = createMockRepository<LinearIntegration>();
    issueMappingRepo = createMockRepository<VulnerabilityIssueMapping>();
    issueMappingRepo.update.mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    });
    integrationRepo.findOne.mockImplementation(
      async (options) =>
        ((options.where as Partial<LinearIntegration>)?.linearOrganizationId ===
        WORKSPACE
          ? { id: 'integration-1', linearOrganizationId: WORKSPACE }
          : null) as LinearIntegration | null,
    );
    linearService = {
      markNeedsReconnect: jest.fn().mockResolvedValue(undefined),
    };
    config = new Map();
    secrets = {
      getSecret: jest.fn((key: string) =>
        key === 'LINEAR_WEBHOOK_SECRET' ? SECRET : undefined,
      ),
      ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinearWebhookService,
        {
          provide: getRepositoryToken(LinearIntegration),
          useValue: integrationRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityIssueMapping),
          useValue: issueMappingRepo,
        },
        { provide: LinearService, useValue: linearService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config.get(key) },
        },
        { provide: SecretsService, useValue: secrets },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    service = module.get(LinearWebhookService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('signature', () => {
    it('rejects a missing or wrong signature without touching the database', async () => {
      const rawBody = JSON.stringify(issueEvent('update', issueData()));
      const wrongSecret = sign(rawBody, 'another-secret');
      const tampered = sign(rawBody.replace('ENG-42', 'ENG-43'));
      const unprefixed = `sha256=${sign(rawBody)}`;

      for (const signature of [
        '',
        'deadbeef',
        wrongSecret,
        tampered,
        unprefixed,
        sign(rawBody).toUpperCase().slice(0, 10),
      ]) {
        await expect(
          service.handleWebhook({ rawBody, signature }, NOW),
        ).resolves.toEqual({ success: false, message: 'Unauthorized' });
      }
      await expect(
        service.handleWebhook(
          { rawBody, signature: undefined as unknown as string },
          NOW,
        ),
      ).resolves.toEqual({ success: false, message: 'Unauthorized' });

      expectDatabaseUntouched();
    });

    it('checks the signature against the raw bytes, not the parsed body', async () => {
      const compact = JSON.stringify(issueEvent('update', issueData()));
      const reformatted = JSON.stringify(JSON.parse(compact), null, 2);

      await expect(
        service.handleWebhook(
          { rawBody: reformatted, signature: sign(compact) },
          NOW,
        ),
      ).resolves.toEqual({ success: false, message: 'Unauthorized' });
      expectDatabaseUntouched();
    });

    it('refuses every delivery while the signing secret is not configured', async () => {
      secrets.getSecret.mockReturnValue(undefined);
      const rawBody = JSON.stringify(issueEvent('update', issueData()));

      // Not even a signature made with an empty secret is accepted.
      for (const signature of [sign(rawBody), sign(rawBody, ''), '']) {
        await expect(
          service.handleWebhook({ rawBody, signature }, NOW),
        ).resolves.toEqual({ success: false, message: 'Unauthorized' });
      }
      expectDatabaseUntouched();
    });

    it('reads the secret from the environment in development, else from the secrets cache after loading it', async () => {
      config.set('NODE_ENV', 'development');
      config.set('LINEAR_WEBHOOK_SECRET', 'dev-secret');
      secrets.getSecret.mockReturnValue(undefined);
      const rawBody = JSON.stringify(issueEvent('update', issueData()));

      await expect(
        service.handleWebhook(
          { rawBody, signature: sign(rawBody, 'dev-secret') },
          NOW,
        ),
      ).resolves.toMatchObject({ success: true });
      expect(secrets.getSecret).not.toHaveBeenCalled();

      config.delete('NODE_ENV');
      secrets.getSecret.mockReturnValue(SECRET);
      await expect(
        deliver(issueEvent('update', issueData())),
      ).resolves.toMatchObject({ success: true });
      expect(secrets.ensureCacheLoaded).toHaveBeenCalled();
      expect(secrets.getSecret).toHaveBeenCalledWith('LINEAR_WEBHOOK_SECRET');
    });

    it('rejects a body that is not JSON once the signature is right', async () => {
      const rawBody = 'not json';

      await expect(
        service.handleWebhook({ rawBody, signature: sign(rawBody) }, NOW),
      ).resolves.toEqual({ success: false, message: 'Invalid JSON' });
      expectNoWrite();
    });
  });

  describe('timestamp', () => {
    it('rejects a webhookTimestamp older than 60 s', async () => {
      const result = await deliver(
        issueEvent('update', issueData(), { webhookTimestamp: NOW - 60_001 }),
      );

      expect(result).toEqual({ success: false, message: 'Stale webhook' });
      expectDatabaseUntouched();
    });

    it('rejects a webhookTimestamp more than 60 s in the future', async () => {
      const result = await deliver(
        issueEvent('update', issueData(), { webhookTimestamp: NOW + 60_001 }),
      );

      expect(result).toEqual({ success: false, message: 'Stale webhook' });
      expectDatabaseUntouched();
    });

    it('accepts a webhookTimestamp exactly 60 s away, in either direction', async () => {
      for (const webhookTimestamp of [NOW - 60_000, NOW + 60_000]) {
        await expect(
          deliver(issueEvent('update', issueData(), { webhookTimestamp })),
        ).resolves.toMatchObject({ success: true });
      }
      expect(issueMappingRepo.update).toHaveBeenCalledTimes(2);
    });

    it('rejects a delivery whose webhookTimestamp is missing or not a number', async () => {
      for (const webhookTimestamp of [
        undefined,
        null,
        'now',
        NaN,
        '1798279200000',
      ]) {
        await expect(
          deliver(issueEvent('update', issueData(), { webhookTimestamp })),
        ).resolves.toEqual({ success: false, message: 'Stale webhook' });
      }
      expectDatabaseUntouched();
    });

    it('measures the age against the clock when no time is given', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      const rawBody = JSON.stringify(issueEvent('update', issueData()));

      await expect(
        service.handleWebhook({ rawBody, signature: sign(rawBody) }),
      ).resolves.toMatchObject({ success: true });

      jest.spyOn(Date, 'now').mockReturnValue(NOW + 61_000);
      await expect(
        service.handleWebhook({ rawBody, signature: sign(rawBody) }),
      ).resolves.toEqual({ success: false, message: 'Stale webhook' });
    });
  });

  describe('Issue events', () => {
    it('ignores an unknown workspace', async () => {
      const result = await deliver(
        issueEvent('update', issueData(), { organizationId: 'someone-else' }),
      );

      expect(result.success).toBe(true);
      expect(integrationRepo.findOne).toHaveBeenCalledWith({
        where: { linearOrganizationId: 'someone-else' },
      });
      expectNoWrite();
    });

    it('updates state, assignee, priority and team of the rows of this workspace only', async () => {
      const result = await deliver(issueEvent('update', issueData()));

      expect(result.success).toBe(true);
      expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        {
          platform: IssuePlatform.LINEAR,
          externalIssueId: ISSUE_ID,
          linearOrganizationId: WORKSPACE,
        },
        expect.objectContaining({
          issueState: 'In Progress',
          linearStateType: 'started',
          linearAssignee: 'Ada Lovelace',
          linearPriority: 'High',
          linearTeamKey: 'ENG',
        }),
      );
    });

    it('writes an empty assignee when the ticket was unassigned', async () => {
      await deliver(issueEvent('update', issueData({ assignee: null })));
      await deliver(
        issueEvent('update', {
          ...issueData(),
          assignee: undefined,
          assigneeId: null,
        }),
      );

      for (const [, set] of issueMappingRepo.update.mock.calls) {
        expect(set).toMatchObject({ linearAssignee: '' });
      }
      expect(issueMappingRepo.update).toHaveBeenCalledTimes(2);
    });

    it('leaves a field alone when the payload does not carry it', async () => {
      await deliver(
        issueEvent('update', {
          id: ISSUE_ID,
          state: { name: 'Done', type: 'completed' },
        }),
      );

      expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
      const [, set] = issueMappingRepo.update.mock.calls[0];
      expect(set).toEqual({ issueState: 'Done', linearStateType: 'completed' });
    });

    it('does not write empty values over what a partial payload omits', async () => {
      await deliver(
        issueEvent('update', {
          id: ISSUE_ID,
          state: { id: 'st-1' },
          team: {},
          assignee: { id: 'user-1' },
          priorityLabel: '',
          identifier: '',
          url: '',
        }),
      );

      // Nothing usable: no UPDATE at all.
      expect(issueMappingRepo.update).not.toHaveBeenCalled();
    });

    it('follows a ticket moved to another team', async () => {
      const result = await deliver(
        issueEvent(
          'update',
          issueData({
            identifier: 'SEC-7',
            url: 'https://linear.app/acme/issue/SEC-7/fix-sql-injection',
            team: { id: 'team-2', key: 'SEC', name: 'Security' },
          }),
          { updatedFrom: { teamId: 'team-1' } },
        ),
      );

      expect(result.success).toBe(true);
      expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        {
          platform: IssuePlatform.LINEAR,
          externalIssueId: ISSUE_ID,
          linearOrganizationId: WORKSPACE,
        },
        expect.objectContaining({
          linearIdentifier: 'SEC-7',
          issueUrl: 'https://linear.app/acme/issue/SEC-7/fix-sql-injection',
          linearTeamKey: 'SEC',
        }),
      );
      expect(issueMappingRepo.save).not.toHaveBeenCalled();
    });

    it('takes the ticket URL from the envelope when the data has none', async () => {
      await deliver(
        issueEvent('update', issueData({ url: undefined }), {
          url: 'https://linear.app/acme/issue/ENG-42/envelope',
        }),
      );

      expect(issueMappingRepo.update.mock.calls[0][1]).toMatchObject({
        issueUrl: 'https://linear.app/acme/issue/ENG-42/envelope',
      });
    });

    it('never stores a ticket URL that is not https', async () => {
      await deliver(
        issueEvent('update', issueData({ url: 'javascript:alert(1)' })),
      );
      await deliver(
        issueEvent('update', issueData({ url: 'http://linear.app/acme/x' })),
      );

      for (const [, set] of issueMappingRepo.update.mock.calls) {
        expect(set).not.toHaveProperty('issueUrl');
      }
    });

    it('never writes a value longer than its column', async () => {
      await deliver(
        issueEvent(
          'update',
          issueData({
            identifier: 'I'.repeat(60),
            priorityLabel: 'P'.repeat(60),
            state: { name: 'S'.repeat(400), type: 'T'.repeat(40) },
            team: { key: 'K'.repeat(40) },
            assignee: { name: 'A'.repeat(400) },
          }),
        ),
      );

      const [, set] = issueMappingRepo.update.mock.calls[0] as [
        unknown,
        Record<string, string>,
      ];
      expect(set.linearIdentifier).toHaveLength(32);
      expect(set.linearPriority).toHaveLength(32);
      expect(set.issueState).toHaveLength(255);
      expect(set.linearStateType).toHaveLength(16);
      expect(set.linearTeamKey).toHaveLength(16);
      expect(set.linearAssignee).toHaveLength(255);
    });

    it('marks the rows deleted on action remove', async () => {
      const result = await deliver(issueEvent('remove', issueData()));

      expect(result.success).toBe(true);
      expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        {
          platform: IssuePlatform.LINEAR,
          externalIssueId: ISSUE_ID,
          linearOrganizationId: WORKSPACE,
        },
        { issueState: 'deleted' },
      );
      expect(issueMappingRepo.delete).not.toHaveBeenCalled();
      expect(issueMappingRepo.remove).not.toHaveBeenCalled();
    });

    it('does not let a remove event overwrite anything else', async () => {
      await deliver(
        issueEvent('remove', issueData({ assignee: null, priorityLabel: 'x' })),
      );

      expect(issueMappingRepo.update.mock.calls[0][1]).toEqual({
        issueState: 'deleted',
      });
    });

    it("two workspaces never update each other's rows", async () => {
      integrationRepo.findOne.mockImplementation(
        async (options) =>
          ({
            id: 'integration',
            linearOrganizationId: (options.where as Partial<LinearIntegration>)
              .linearOrganizationId,
          }) as LinearIntegration,
      );

      await deliver(
        issueEvent('update', issueData(), { organizationId: 'workspace-a' }),
      );
      await deliver(
        issueEvent(
          'update',
          issueData({ state: { name: 'Done', type: 'completed' } }),
          { organizationId: 'workspace-b' },
        ),
      );

      const wheres = issueMappingRepo.update.mock.calls.map(([where]) => where);
      expect(wheres).toEqual([
        {
          platform: IssuePlatform.LINEAR,
          externalIssueId: ISSUE_ID,
          linearOrganizationId: 'workspace-a',
        },
        {
          platform: IssuePlatform.LINEAR,
          externalIssueId: ISSUE_ID,
          linearOrganizationId: 'workspace-b',
        },
      ]);
      // The first delivery's values went with the first workspace only.
      expect(issueMappingRepo.update.mock.calls[0][1]).toMatchObject({
        issueState: 'In Progress',
      });
      expect(issueMappingRepo.update.mock.calls[1][1]).toMatchObject({
        issueState: 'Done',
      });
    });

    it('does nothing for a payload without an issue id or a workspace', async () => {
      await expect(
        deliver(issueEvent('update', issueData({ id: undefined }))),
      ).resolves.toMatchObject({ success: true });
      await expect(
        deliver(
          issueEvent('update', issueData(), { organizationId: undefined }),
        ),
      ).resolves.toMatchObject({ success: true });
      await expect(
        deliver(issueEvent('update', issueData(), { data: undefined })),
      ).resolves.toMatchObject({ success: true });

      expectNoWrite();
    });

    it('ignores the creation of an issue: the rows are written by the creator', async () => {
      await expect(
        deliver(issueEvent('create', issueData())),
      ).resolves.toMatchObject({ success: true });

      expectNoWrite();
    });

    it('ignores the other Linear entities', async () => {
      for (const type of ['Comment', 'IssueLabel', 'Project', 'Cycle']) {
        await expect(
          deliver(issueEvent('update', issueData(), { type })),
        ).resolves.toMatchObject({ success: true });
      }

      expectNoWrite();
    });

    it('lets a database failure surface so Linear delivers again', async () => {
      issueMappingRepo.update.mockRejectedValue(new Error('db down'));

      await expect(deliver(issueEvent('update', issueData()))).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('OAuthApp revoked', () => {
    const revoked = (overrides: Payload = {}): Payload => ({
      action: 'revoked',
      type: 'OAuthApp',
      organizationId: WORKSPACE,
      oauthClientId: 'client-1',
      webhookTimestamp: NOW,
      webhookId: 'wh-2',
      createdAt: '2026-10-26T10:00:00.000Z',
      ...overrides,
    });

    it('an OAuthApp revoked event marks the integration needsReconnect and deletes nothing', async () => {
      const result = await deliver(revoked());

      expect(result.success).toBe(true);
      expect(linearService.markNeedsReconnect).toHaveBeenCalledTimes(1);
      expect(linearService.markNeedsReconnect).toHaveBeenCalledWith(WORKSPACE);
      expect(issueMappingRepo.update).not.toHaveBeenCalled();
      expect(issueMappingRepo.delete).not.toHaveBeenCalled();
      expect(issueMappingRepo.remove).not.toHaveBeenCalled();
      expect(integrationRepo.delete).not.toHaveBeenCalled();
      expect(integrationRepo.remove).not.toHaveBeenCalled();
    });

    it('ignores the revocation of an unknown workspace', async () => {
      const result = await deliver(revoked({ organizationId: 'someone-else' }));

      expect(result.success).toBe(true);
      expectNoWrite();
    });

    it('ignores another action on the app', async () => {
      await expect(
        deliver(revoked({ action: 'create' })),
      ).resolves.toMatchObject({ success: true });

      expectNoWrite();
    });

    it('is refused without a valid signature like any other delivery', async () => {
      const rawBody = JSON.stringify(revoked());

      await expect(
        service.handleWebhook({ rawBody, signature: 'forged' }, NOW),
      ).resolves.toEqual({ success: false, message: 'Unauthorized' });
      expectDatabaseUntouched();
    });
  });

  describe('logs', () => {
    it('never logs the body, the signature or the secret', async () => {
      const rawBody = JSON.stringify(issueEvent('update', issueData()));
      const signature = sign(rawBody);
      await service.handleWebhook({ rawBody, signature }, NOW);
      await service.handleWebhook({ rawBody, signature: 'forged' }, NOW);

      const logged = JSON.stringify(
        ['log', 'warn', 'error', 'debug'].flatMap(
          (level) => (logger[level as 'log'] as jest.Mock).mock.calls,
        ),
      );
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain(signature);
      expect(logged).not.toContain('Fix SQL injection');
      expect(logged).not.toContain('Ada Lovelace');
    });
  });
});
