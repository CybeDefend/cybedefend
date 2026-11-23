const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { FindOperator } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { status } from '@grpc/grpc-js';
import { JiraService } from './jira.service';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import SecretsService from '../../core/secrets/secrets.service';
import * as crypto from 'crypto';

class FakeSecrets extends (SecretsService as any) {
  private cache = new Map<string, string>();
  getSecret(key: string) {
    return this.cache.get(key) ?? '';
  }
  setSecret(key: string, val: string) {
    this.cache.set(key, val);
  }
}

function makeFakeIntegration(
  overrides?: Partial<JiraIntegration>,
): JiraIntegration {
  return {
    id: 'int-1',
    organizationId: 'org-1',
    cloudId: 'cloud-123',
    siteName: 'test.atlassian.net',
    siteUrl: 'https://test.atlassian.net',
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    webhookSecret: null,
    webhookId: null,
    installedByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    projectMappings: [],
    ...overrides,
  } as JiraIntegration;
}

describe('JiraService', () => {
  let service: JiraService;
  let integrationRepo: ReturnType<typeof createMockRepository>;
  let projectMappingRepo: ReturnType<typeof createMockRepository>;
  let logger: Logger;

  beforeEach(async () => {
    mockFetch.mockReset();

    const configMap = new Map<string, string>();
    configMap.set('GATEWAY_URL', 'https://gw.example.com');
    configMap.set('NODE_ENV', 'development');
    configMap.set('JIRA_CLIENT_ID', 'test-client-id');
    configMap.set('JIRA_CLIENT_SECRET', 'test-client-secret');

    const secrets = new FakeSecrets();
    logger = createLoggerMock();

    integrationRepo = createMockRepository();
    integrationRepo.save.mockResolvedValue(undefined);
    integrationRepo.find.mockResolvedValue([]);

    projectMappingRepo = createMockRepository();
    // By default, the resolved integration owns one CybeDefend project.
    projectMappingRepo.find.mockResolvedValue([{ projectId: 'proj-default' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraService,
        {
          provide: getRepositoryToken(JiraIntegration),
          useValue: integrationRepo,
        },
        {
          provide: getRepositoryToken(JiraProjectMapping),
          useValue: projectMappingRepo,
        },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => configMap.get(k) },
        },
        { provide: SecretsService, useValue: secrets },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    service = module.get<JiraService>(JiraService);

    // Mock getValidAccessToken to avoid encryption/decryption
    jest
      .spyOn(service, 'getValidAccessToken')
      .mockResolvedValue('test-access-token');

    // Mock jiraApiCall to return project keys for JQL filter building
    jest.spyOn(service, 'jiraApiCall').mockResolvedValue({
      values: [{ key: 'PROJ' }, { key: 'TEST' }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateOAuthUrl', () => {
    it('should return an Atlassian authorize URL with correct client_id and scopes', () => {
      const result = service.generateOAuthUrl({
        redirectUri: 'https://app.example.com/integrations/jira/callback',
        state: 'test-state-token',
      });

      expect(result.installUrl).toContain(
        'https://auth.atlassian.com/authorize',
      );
      expect(result.installUrl).toContain('client_id=test-client-id');
      expect(result.installUrl).toContain('state=test-state-token');
      expect(result.installUrl).toContain(
        encodeURIComponent(
          'https://app.example.com/integrations/jira/callback',
        ),
      );
      expect(result.installUrl).toContain('read%3Ajira-work');
      expect(result.installUrl).toContain('offline_access');
    });
  });

  describe('registerWebhook', () => {
    it('should call the dynamic webhooks API at /rest/api/3/webhook', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            '{"webhookRegistrationResult":[{"createdWebhookId":1}]}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      const postCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const [postUrl] = postCall;
      expect(postUrl).toBe(
        'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/webhook',
      );
    });

    it('should NOT use the admin webhooks API (/rest/webhooks/1.0/webhook)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      const allUrls = mockFetch.mock.calls.map(([url]: [string]) => url);
      for (const url of allUrls) {
        expect(url).not.toContain('/rest/webhooks/1.0/');
      }
    });

    it('should build jqlFilter from fetched project keys', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      expect(service.jiraApiCall).toHaveBeenCalledWith(
        integration,
        'GET',
        '/project/search?maxResults=100',
      );

      const postCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body as string);
      expect(body.webhooks[0].jqlFilter).toBe('project IN (PROJ, TEST)');
    });

    it('should send webhooks array with events and top-level url', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      const postCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body as string);

      expect(body.url).toMatch(
        /^https:\/\/gw\.example\.com\/webhooks\/jira\/[a-f0-9]{64}$/,
      );
      expect(body.webhooks).toHaveLength(1);
      expect(body.webhooks[0].events).toEqual(
        expect.arrayContaining(['jira:issue_updated', 'jira:issue_deleted']),
      );
    });

    it('should delete existing webhooks using batch DELETE with webhookIds', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            values: [{ id: 100 }, { id: 200 }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      const deleteCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
      const deleteBody = JSON.parse(deleteCall[1].body as string);
      expect(deleteBody.webhookIds).toEqual([100, 200]);
    });

    it('should store HMAC-SHA256 hash of webhook secret in integration', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      expect(integrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookSecret: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
    });

    it('should store webhook ID from registration response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ values: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            '{"webhookRegistrationResult":[{"createdWebhookId":42}]}',
        });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      // Second save call should include the webhookId
      const saveCalls = integrationRepo.save.mock.calls;
      const lastSaved = saveCalls[saveCalls.length - 1][0] as JiraIntegration;
      expect(lastSaved.webhookId).toBe(42);
    });

    it('should abort if no Jira projects are found', async () => {
      jest.spyOn(service, 'jiraApiCall').mockResolvedValue({ values: [] });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [] }),
      });

      const integration = makeFakeIntegration();
      await (service as any).registerWebhook(integration);

      const postCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'POST',
      );
      expect(postCall).toBeUndefined();
    });

    it('should generate webhook URL with path-based token (not query param)', async () => {
      integrationRepo.save.mockResolvedValue(undefined);
      const integration = makeFakeIntegration();

      // Mock: list existing webhooks (empty), then register
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ values: [] }) })
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            JSON.stringify({
              webhookRegistrationResult: [{ createdWebhookId: 42 }],
            }),
        });

      await (service as any).registerWebhook(integration);

      const registerCall = mockFetch.mock.calls.find(
        (c) => c[1]?.method === 'POST',
      );
      const body = JSON.parse(registerCall[1].body);
      expect(body.url).toMatch(/\/webhooks\/jira\/[a-f0-9]{64}$/);
      expect(body.url).not.toContain('?secret=');
    });
  });

  describe('handleWebhook', () => {
    it('should accept valid HMAC-hashed webhook token', async () => {
      const testToken = 'test-webhook-token-hex';
      const hmacKey = 'test-client-secret'; // matches JIRA_CLIENT_SECRET from beforeEach config
      // cybedefend-ignore[CD-SAST-0303]: test fixture: hmacKey is the fake JIRA_CLIENT_SECRET of the test config, not a real key
      const expectedHash = crypto
        .createHmac('sha256', hmacKey)
        .update(testToken)
        .digest('hex');

      const integration = makeFakeIntegration({ webhookSecret: expectedHash });
      integrationRepo.findOne.mockResolvedValue(integration);
      (integrationRepo as any).manager = {
        ...(integrationRepo.manager || {}),
        transaction: jest.fn().mockImplementation(async (cb) =>
          cb({
            getRepository: () => ({
              update: jest.fn().mockResolvedValue({ affected: 0 }),
            }),
          }),
        ),
      };

      const result = await service.handleWebhook({
        rawBody: JSON.stringify({
          webhookEvent: 'jira:issue_updated',
          issue: {
            key: 'TEST-1',
            fields: {
              status: { name: 'Done' },
              priority: null,
              assignee: null,
              project: { key: 'TEST' },
            },
          },
        }),
        secret: testToken,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid webhook token', async () => {
      integrationRepo.findOne.mockResolvedValue(null);

      const result = await service.handleWebhook({
        rawBody: '{}',
        secret: 'invalid-token',
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Unauthorized');
    });

    it('should reject empty webhook token', async () => {
      const result = await service.handleWebhook({
        rawBody: '{}',
        secret: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('processIssueWebhook', () => {
    it('should execute key move and status update in a single transaction', async () => {
      const mockUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const mockTransaction = jest
        .fn()
        .mockImplementation(async (cb) =>
          cb({ getRepository: () => ({ update: mockUpdate }) }),
        );
      (integrationRepo as any).manager = {
        ...integrationRepo.manager,
        transaction: mockTransaction,
      };

      const integration = makeFakeIntegration();
      const event = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'NEW-1',
          fields: {
            status: { name: 'Done' },
            priority: { name: 'High' },
            assignee: null,
            project: { key: 'NEW' },
          },
        },
        changelog: {
          items: [{ field: 'Key', fromString: 'OLD-1', toString: 'NEW-1' }],
        },
      };

      await (service as any).processIssueWebhook(
        event,
        'jira:issue_updated',
        integration,
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Two updates: key move + status
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should only execute status update when no key change', async () => {
      const mockUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const mockTransaction = jest
        .fn()
        .mockImplementation(async (cb) =>
          cb({ getRepository: () => ({ update: mockUpdate }) }),
        );
      (integrationRepo as any).manager = {
        ...integrationRepo.manager,
        transaction: mockTransaction,
      };

      const integration = makeFakeIntegration();
      const event = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'TEST-1',
          fields: {
            status: { name: 'In Progress' },
            priority: null,
            assignee: { displayName: 'John' },
            project: { key: 'TEST' },
          },
        },
      };

      await (service as any).processIssueWebhook(
        event,
        'jira:issue_updated',
        integration,
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should scope BOTH updates to the projects owned by the resolved integration (tenant isolation)', async () => {
      // The resolved integration owns exactly one CybeDefend project.
      projectMappingRepo.find.mockResolvedValue([{ projectId: 'proj-owned' }]);

      const capturedWhere: Array<Record<string, unknown>> = [];
      const mockUpdate = jest.fn().mockImplementation((where) => {
        capturedWhere.push(where);
        return Promise.resolve({ affected: 1 });
      });
      const mockTransaction = jest
        .fn()
        .mockImplementation(async (cb) =>
          cb({ getRepository: () => ({ update: mockUpdate }) }),
        );
      (integrationRepo as any).manager = {
        ...integrationRepo.manager,
        transaction: mockTransaction,
      };

      const integration = makeFakeIntegration({ id: 'int-owner' });
      // A collision on a common Jira key ("SEC-123") across tenants, plus a key move.
      const event = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'SEC-123',
          fields: {
            status: { name: 'Done' },
            priority: { name: 'High' },
            assignee: null,
            project: { key: 'SEC' },
          },
        },
        changelog: {
          items: [{ field: 'Key', fromString: 'SEC-1', toString: 'SEC-123' }],
        },
      };

      await (service as any).processIssueWebhook(
        event,
        'jira:issue_updated',
        integration,
      );

      // Project scope was resolved from the integration's own mappings only.
      expect(projectMappingRepo.find).toHaveBeenCalledWith({
        where: { integrationId: 'int-owner' },
        select: ['projectId'],
      });

      // Both the key-move update and the status update must be scoped by projectId
      // so a foreign tenant's "SEC-123" mapping can never be touched.
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      for (const where of capturedWhere) {
        expect(where.projectId).toBeInstanceOf(FindOperator);
        expect((where.projectId as FindOperator<unknown>).value).toEqual([
          'proj-owned',
        ]);
        expect(where.platform).toBe('jira');
      }
    });

    it('should NOT touch any mapping when the integration owns no projects', async () => {
      projectMappingRepo.find.mockResolvedValue([]);

      const mockUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const mockTransaction = jest
        .fn()
        .mockImplementation(async (cb) =>
          cb({ getRepository: () => ({ update: mockUpdate }) }),
        );
      (integrationRepo as any).manager = {
        ...integrationRepo.manager,
        transaction: mockTransaction,
      };

      const integration = makeFakeIntegration({ id: 'int-empty' });
      const event = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'SEC-123',
          fields: {
            status: { name: 'Done' },
            priority: null,
            assignee: null,
            project: { key: 'SEC' },
          },
        },
      };

      await (service as any).processIssueWebhook(
        event,
        'jira:issue_updated',
        integration,
      );

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getValidAccessToken', () => {
    beforeEach(() => {
      // Restore the real method (outer beforeEach mocks it)
      jest.spyOn(service, 'getValidAccessToken').mockRestore();
    });

    it('should return cached token when not expired (> 5 min buffer)', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 600_000), // 10 min
        accessToken: 'encrypted-token',
      });
      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('decrypted-token');

      const result = await service.getValidAccessToken(integration);
      expect(result).toBe('decrypted-token');
    });

    it('should refresh token when expiring within 5 minutes', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000), // 3.3 min
        refreshToken: 'encrypted-refresh',
      });

      const mockManager = {
        findOne: jest.fn().mockResolvedValue({
          ...integration,
          tokenExpiresAt: new Date(Date.now() + 200_000),
        }),
        getRepository: jest.fn().mockReturnValue({
          save: jest.fn().mockResolvedValue(undefined),
        }),
      };
      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) => cb(mockManager)),
      };

      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('old-refresh');
      jest
        .spyOn(service as any, 'encryptToken')
        .mockResolvedValue('encrypted-new');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      });

      const result = await service.getValidAccessToken(integration);
      expect(result).toBe('new-access');
      expect(mockManager.findOne).toHaveBeenCalledWith(
        JiraIntegration,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('should return UNAUTHENTICATED without an error log when Jira rejects the refresh token', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000),
        refreshToken: 'encrypted-refresh',
      });
      const lockedIntegration = { ...integration };
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(lockedIntegration),
      };
      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) => cb(mockManager)),
      };
      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('expired-refresh-token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      });

      await expect(
        service.getValidAccessToken(integration),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.UNAUTHENTICATED }),
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return UNAVAILABLE and log an error when Jira token refresh is unavailable', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000),
        refreshToken: 'encrypted-refresh',
      });
      const mockManager = {
        findOne: jest.fn().mockResolvedValue({ ...integration }),
      };
      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) => cb(mockManager)),
      };
      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('refresh-token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      });

      await expect(
        service.getValidAccessToken(integration),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.UNAVAILABLE }),
      });
      expect(logger.error).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should return RESOURCE_EXHAUSTED and warn when Jira token refresh is rate limited', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000),
        refreshToken: 'encrypted-refresh',
      });
      const mockManager = {
        findOne: jest.fn().mockResolvedValue({ ...integration }),
      };
      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) => cb(mockManager)),
      };
      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('refresh-token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'rate_limited' }),
      });

      await expect(
        service.getValidAccessToken(integration),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.RESOURCE_EXHAUSTED }),
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should skip refresh if another thread already refreshed', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000), // within buffer
      });

      const freshIntegration = {
        ...integration,
        tokenExpiresAt: new Date(Date.now() + 3_600_000), // already refreshed
        accessToken: 'encrypted-fresh',
      };

      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) =>
            cb({ findOne: jest.fn().mockResolvedValue(freshIntegration) }),
          ),
      };

      jest
        .spyOn(service as any, 'decryptToken')
        .mockResolvedValue('fresh-token');

      const result = await service.getValidAccessToken(integration);
      expect(result).toBe('fresh-token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if locked integration is null', async () => {
      const integration = makeFakeIntegration({
        tokenExpiresAt: new Date(Date.now() + 200_000), // within buffer
      });

      (integrationRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb) =>
            cb({ findOne: jest.fn().mockResolvedValue(null) }),
          ),
      };

      await expect(
        service.getValidAccessToken(integration),
      ).rejects.toMatchObject({
        message: 'Jira integration not found',
      });
    });
  });

  describe('refreshAllWebhooks', () => {
    it('should refresh webhooks for integrations with a webhookId', async () => {
      const integration = makeFakeIntegration({ webhookId: 42 });
      integrationRepo.find.mockResolvedValue([integration]);

      mockFetch.mockResolvedValueOnce({ ok: true });

      await service.refreshAllWebhooks();

      const putCall = mockFetch.mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      const [putUrl, putOpts] = putCall;
      expect(putUrl).toBe(
        'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/webhook/refresh',
      );
      expect(JSON.parse(putOpts.body as string)).toEqual({
        webhookIds: [42],
      });
    });

    it('should skip integrations without a webhookId', async () => {
      const withId = makeFakeIntegration({
        id: 'int-1',
        webhookId: 10,
      });
      const withoutId = makeFakeIntegration({
        id: 'int-2',
        webhookId: null,
      });
      integrationRepo.find.mockResolvedValue([withId, withoutId]);

      mockFetch.mockResolvedValueOnce({ ok: true });

      await service.refreshAllWebhooks();

      // Only one PUT call for the integration with webhookId
      const putCalls = mockFetch.mock.calls.filter(
        ([, opts]: [string, RequestInit]) => opts?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(1);
    });

    it('should not call fetch when no integrations have webhookId', async () => {
      integrationRepo.find.mockResolvedValue([
        makeFakeIntegration({ webhookId: null }),
      ]);

      await service.refreshAllWebhooks();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getProjectJiraConfig — organization ownership', () => {
    it('should return config when organization matches', async () => {
      projectMappingRepo.findOne.mockResolvedValue({
        projectId: 'proj-1',
        jiraProjectId: 'jira-10001',
        jiraProjectKey: 'TRI',
        jiraProjectName: 'Triage',
        allowedBranches: '["main","develop"]',
        autoCreateEnabled: true,
        integration: makeFakeIntegration({ organizationId: 'org-1' }),
      });

      const result = await service.getProjectJiraConfig({
        projectId: 'proj-1',
        organizationId: 'org-1',
      });

      expect(result.isConfigured).toBe(true);
      expect(result.jiraProjectKey).toBe('TRI');
      expect(result.allowedBranches).toEqual(['main', 'develop']);
    });

    it('should return unconfigured when organization does NOT match', async () => {
      projectMappingRepo.findOne.mockResolvedValue({
        projectId: 'proj-1',
        jiraProjectId: 'jira-10001',
        jiraProjectKey: 'TRI',
        jiraProjectName: 'Triage',
        allowedBranches: null,
        autoCreateEnabled: false,
        integration: makeFakeIntegration({ organizationId: 'org-1' }),
      });

      const result = await service.getProjectJiraConfig({
        projectId: 'proj-1',
        organizationId: 'org-attacker',
      });

      expect(result.isConfigured).toBe(false);
      expect(result.jiraProjectKey).toBe('');
    });

    it('should return unconfigured when no mapping exists', async () => {
      projectMappingRepo.findOne.mockResolvedValue(null);

      const result = await service.getProjectJiraConfig({
        projectId: 'proj-nonexistent',
        organizationId: 'org-1',
      });

      expect(result.isConfigured).toBe(false);
    });
  });

  describe('removeProjectJiraConfig — organization ownership', () => {
    it('should remove config when organization matches', async () => {
      const mapping = {
        projectId: 'proj-1',
        integration: makeFakeIntegration({ organizationId: 'org-1' }),
      };
      projectMappingRepo.findOne.mockResolvedValue(mapping);
      projectMappingRepo.remove = jest.fn().mockResolvedValue(undefined);

      const result = await service.removeProjectJiraConfig({
        projectId: 'proj-1',
        organizationId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(projectMappingRepo.remove).toHaveBeenCalledWith(mapping);
    });

    it('should throw PERMISSION_DENIED when organization does NOT match', async () => {
      projectMappingRepo.findOne.mockResolvedValue({
        projectId: 'proj-1',
        integration: makeFakeIntegration({ organizationId: 'org-1' }),
      });

      await expect(
        service.removeProjectJiraConfig({
          projectId: 'proj-1',
          organizationId: 'org-attacker',
        }),
      ).rejects.toMatchObject({
        message: 'Permission denied',
      });
    });

    it('should throw NOT_FOUND when no mapping exists', async () => {
      projectMappingRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeProjectJiraConfig({
          projectId: 'proj-nonexistent',
          organizationId: 'org-1',
        }),
      ).rejects.toMatchObject({
        message: 'No Jira config found for this project',
      });
    });
  });

  describe('sanitizeErrorForLog', () => {
    it('should extract only safe fields from error objects', () => {
      const result = (service as any).sanitizeErrorForLog({
        error: 'invalid_grant',
        error_description: 'Token expired',
        secret_token: 'abc123',
        internal_url: 'http://internal.jira.corp/api',
      });
      expect(result).toContain('invalid_grant');
      expect(result).toContain('Token expired');
      expect(result).not.toContain('abc123');
      expect(result).not.toContain('internal.jira.corp');
    });

    it('should truncate long error strings', () => {
      const result = (service as any).sanitizeErrorForLog('a'.repeat(1000));
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('should handle non-object non-string input', () => {
      const result = (service as any).sanitizeErrorForLog(42);
      expect(result).toBe('42');
    });

    it('should handle null input', () => {
      const result = (service as any).sanitizeErrorForLog(null);
      expect(result).toBe('null');
    });
  });

  describe('jiraApiCall retries', () => {
    beforeEach(() => {
      // Restore real jiraApiCall (it's mocked in outer beforeEach)
      jest.spyOn(service, 'jiraApiCall').mockRestore();
      jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry on 500 with exponential backoff', async () => {
      const integration = makeFakeIntegration();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'ok' }),
        });

      const result = await service.jiraApiCall(integration, 'GET', '/test');
      expect(result).toEqual({ data: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should respect 429 Retry-After header', async () => {
      const integration = makeFakeIntegration();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) },
          text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'ok' }),
        });

      const result = await service.jiraApiCall(integration, 'GET', '/test');
      expect(result).toEqual({ data: 'ok' });
    });

    it('should not retry on 400 client error', async () => {
      const integration = makeFakeIntegration();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () => 'Bad Request',
      });

      await expect(
        service.jiraApiCall(integration, 'GET', '/test'),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it.each([
      [403, status.PERMISSION_DENIED],
      [404, status.NOT_FOUND],
      [409, status.ALREADY_EXISTS],
    ])(
      'should map Jira HTTP %i to gRPC %i without logging an expected client error',
      async (httpStatus, grpcStatus) => {
        const integration = makeFakeIntegration();
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: httpStatus,
          headers: { get: () => null },
          text: async () => 'Client error',
        });

        await expect(
          service.jiraApiCall(integration, 'GET', '/test'),
        ).rejects.toMatchObject({
          error: expect.objectContaining({ code: grpcStatus }),
        });
        expect(logger.error).not.toHaveBeenCalled();
      },
    );

    it('should map Jira Dev Status 403 to PERMISSION_DENIED without an error log', async () => {
      const integration = makeFakeIntegration();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: async () => 'Forbidden',
      });

      await expect(
        service.jiraDevStatusCall(integration, 'GET', '/issue/detail'),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.PERMISSION_DENIED }),
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should give up after max retries on persistent 503', async () => {
      const integration = makeFakeIntegration();
      const mockResponse = {
        ok: false,
        status: 503,
        headers: { get: () => null },
        text: async () => 'Unavailable',
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        service.jiraApiCall(integration, 'GET', '/test'),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.UNAVAILABLE }),
      });
      // 1 initial + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(logger.error).toHaveBeenCalled();
    }, 15_000);
  });

  describe('Jira OAuth errors', () => {
    it('maps an inaccessible resources response instead of crashing on its body', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ error: 'forbidden' }),
        });

      await expect(
        service.callbackInstall({
          organizationId: 'org-1',
          userId: 'user-1',
          code: 'oauth-code',
          redirectUri: 'https://app.example.com/callback',
        }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.PERMISSION_DENIED }),
      });
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('removes the integration and its project mappings', async () => {
      const integration = makeFakeIntegration();
      integrationRepo.findOne.mockResolvedValue(integration);
      projectMappingRepo.find.mockResolvedValue([]);

      const result = await service.disconnect({ organizationId: 'org-1' });

      expect(result.success).toBe(true);
      expect(projectMappingRepo.delete).toHaveBeenCalledWith({
        integrationId: 'int-1',
      });
      expect(integrationRepo.remove).toHaveBeenCalledWith(integration);
    });

    // Disconnecting is the user's only way out, so it must never
    // fail on an already-disconnected organization (double click, retry, or a
    // row already swept by the org-deletion teardown).
    it('succeeds when there is nothing left to disconnect', async () => {
      integrationRepo.findOne.mockResolvedValue(null);

      const result = await service.disconnect({ organizationId: 'org-1' });

      expect(result.success).toBe(true);
      expect(integrationRepo.remove).not.toHaveBeenCalled();
    });
  });
});
