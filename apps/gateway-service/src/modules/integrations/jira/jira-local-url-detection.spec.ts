import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { JiraController } from './jira.controller';
import { JiraService } from './jira.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('JiraController localhost detection (SSRF defense-in-depth)', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000';
  const projectId = '660e8400-e29b-41d4-a716-446655440001';
  const mockReq = { user: { sub: 'user-123' } };

  const baseDto = {
    scanId: 'scan-1',
    mode: 'single',
    vulnerabilities: [],
    jiraProjectKey: 'PROJ',
  };

  const baseLinkDto = {
    jiraIssueKey: 'PROJ-1',
    vulnerabilityIds: ['vuln-1'],
    scannerType: 'sca',
    vulnerabilities: [],
  };

  let jiraService: {
    createIssues: jest.Mock;
    linkExistingIssue: jest.Mock;
    generateOAuthUrl: jest.Mock;
  };

  function buildController(frontendUrl: string | undefined) {
    jiraService = {
      createIssues: jest.fn().mockResolvedValue({ success: true }),
      linkExistingIssue: jest.fn().mockResolvedValue({ success: true }),
      generateOAuthUrl: jest.fn().mockResolvedValue({
        installUrl:
          'https://auth.atlassian.com/authorize?client_id=test-client-id',
      }),
    };

    return Test.createTestingModule({
      controllers: [JiraController],
      providers: [
        { provide: JiraService, useValue: jiraService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string | undefined> = {
                FRONTEND_URL: frontendUrl,
              };
              return map[key];
            },
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
  }

  // ==================== isLocalUrl static method ====================

  describe('isLocalUrl', () => {
    it('should detect "localhost"', () => {
      expect(JiraController.isLocalUrl('http://localhost:3000')).toBe(true);
    });

    it('should detect "127.0.0.1"', () => {
      expect(JiraController.isLocalUrl('http://127.0.0.1:3000')).toBe(true);
    });

    it('should detect "127.0.1.1" (any 127.x.x.x)', () => {
      expect(JiraController.isLocalUrl('http://127.0.1.1')).toBe(true);
    });

    it('should detect "0.0.0.0"', () => {
      expect(JiraController.isLocalUrl('http://0.0.0.0:3000')).toBe(true);
    });

    it('should detect "[::1]" (IPv6 loopback)', () => {
      expect(JiraController.isLocalUrl('http://[::1]:3000')).toBe(true);
    });

    it('should detect ".local" suffix', () => {
      expect(JiraController.isLocalUrl('http://myhost.local')).toBe(true);
      expect(JiraController.isLocalUrl('http://myhost.local:8080')).toBe(true);
      expect(JiraController.isLocalUrl('http://myhost.local/path')).toBe(true);
    });

    it('should be case-insensitive for localhost', () => {
      expect(JiraController.isLocalUrl('http://LOCALHOST:3000')).toBe(true);
      expect(JiraController.isLocalUrl('http://LocalHost')).toBe(true);
    });

    it('should NOT flag production URLs', () => {
      expect(JiraController.isLocalUrl('https://app.example.com')).toBe(false);
      expect(JiraController.isLocalUrl('https://staging.example.com')).toBe(
        false,
      );
    });
  });

  // ==================== createIssues fallback ====================

  describe('createIssues — FRONTEND_URL fallback', () => {
    const clientBaseUrl = 'https://client-provided.example.com';

    const localUrls = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://0.0.0.0:3000',
      'http://[::1]:3000',
      'http://dev.local:3000',
    ];

    it.each(localUrls)(
      'should fall back to client-provided URL when FRONTEND_URL is "%s"',
      async (localUrl) => {
        const module = await buildController(localUrl);
        const ctrl = module.get<JiraController>(JiraController);

        await ctrl.createIssues(
          mockReq,
          { ...baseDto, cybedefendBaseUrl: clientBaseUrl } as any,
          orgId,
          projectId,
        );

        expect(jiraService.createIssues).toHaveBeenCalledWith(
          expect.objectContaining({ cybedefendBaseUrl: clientBaseUrl }),
        );
      },
    );

    it('should use FRONTEND_URL when it is a production URL', async () => {
      const module = await buildController('https://app.example.com');
      const ctrl = module.get<JiraController>(JiraController);

      await ctrl.createIssues(
        mockReq,
        { ...baseDto, cybedefendBaseUrl: clientBaseUrl } as any,
        orgId,
        projectId,
      );

      expect(jiraService.createIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          cybedefendBaseUrl: 'https://app.example.com',
        }),
      );
    });
  });

  // ==================== linkExistingIssue fallback ====================

  describe('linkExistingIssue — FRONTEND_URL fallback', () => {
    const clientBaseUrl = 'https://client-provided.example.com';

    const localUrls = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://0.0.0.0:3000',
      'http://[::1]:3000',
      'http://dev.local:3000',
    ];

    it.each(localUrls)(
      'should fall back to client-provided URL when FRONTEND_URL is "%s"',
      async (localUrl) => {
        const module = await buildController(localUrl);
        const ctrl = module.get<JiraController>(JiraController);

        await ctrl.linkExistingIssue(
          mockReq,
          { ...baseLinkDto, cybedefendBaseUrl: clientBaseUrl } as any,
          orgId,
          projectId,
        );

        expect(jiraService.linkExistingIssue).toHaveBeenCalledWith(
          expect.objectContaining({ cybedefendBaseUrl: clientBaseUrl }),
        );
      },
    );

    it('should use FRONTEND_URL when it is a production URL', async () => {
      const module = await buildController('https://app.example.com');
      const ctrl = module.get<JiraController>(JiraController);

      await ctrl.linkExistingIssue(
        mockReq,
        { ...baseLinkDto, cybedefendBaseUrl: clientBaseUrl } as any,
        orgId,
        projectId,
      );

      expect(jiraService.linkExistingIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          cybedefendBaseUrl: 'https://app.example.com',
        }),
      );
    });
  });
});
