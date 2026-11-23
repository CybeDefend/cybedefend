import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { JiraCallbackInstallBodyDto } from './callback-install-body.dto';
import { CreateJiraIssuesBodyDto } from './create-jira-issues-body.dto';
import { SetJiraConfigBodyDto } from './set-jira-config-body.dto';
import { LinkJiraIssueBodyDto } from './link-jira-issue-body.dto';

describe('Jira DTO validation hardening', () => {
  // ---------- JiraCallbackInstallBodyDto ----------

  describe('JiraCallbackInstallBodyDto', () => {
    it('should reject code longer than 2048 characters', async () => {
      const dto = plainToInstance(JiraCallbackInstallBodyDto, {
        code: 'a'.repeat(2049),
        redirectUri: 'https://app.example.com/callback',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'code');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject non-HTTPS redirectUri', async () => {
      const dto = plainToInstance(JiraCallbackInstallBodyDto, {
        code: 'valid-code',
        redirectUri: 'http://app.example.com/callback',
      });
      const errors = await validate(dto);
      const uriErrors = errors.filter((e) => e.property === 'redirectUri');
      expect(uriErrors.length).toBeGreaterThan(0);
    });

    it('should reject redirectUri longer than 2048 characters', async () => {
      const dto = plainToInstance(JiraCallbackInstallBodyDto, {
        code: 'valid-code',
        redirectUri: 'https://app.example.com/' + 'a'.repeat(2048),
      });
      const errors = await validate(dto);
      const uriErrors = errors.filter((e) => e.property === 'redirectUri');
      expect(uriErrors.length).toBeGreaterThan(0);
    });

    it('should accept a valid callback DTO', async () => {
      const dto = plainToInstance(JiraCallbackInstallBodyDto, {
        code: 'abc123def456',
        redirectUri: 'https://app.example.com/integrations/jira/callback',
        state: 'a'.repeat(64),
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- CreateJiraIssuesBodyDto ----------

  describe('CreateJiraIssuesBodyDto', () => {
    const validPayload = {
      mode: 1,
      vulnerabilities: [
        {
          vulnerabilityId: 'vuln-1',
          scannerType: 'sast',
          severity: 'high',
          name: 'SQL Injection',
        },
      ],
      cybedefendBaseUrl: 'https://app.example.com',
    };

    it('should reject non-HTTPS cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'http://app.example.com',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject private IP 192.168.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://192.168.1.1/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject private IP 127.x.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://127.0.0.1/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject private IP 10.x.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://10.0.0.1/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject link-local IP 169.254.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://169.254.169.254/metadata',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject localhost in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://localhost:3000/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject cybedefendBaseUrl longer than 2048 characters', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://app.example.com/' + 'a'.repeat(2048),
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should accept a valid HTTPS cybedefendBaseUrl', async () => {
      const dto = plainToInstance(CreateJiraIssuesBodyDto, validPayload);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- SetJiraConfigBodyDto ----------

  describe('SetJiraConfigBodyDto', () => {
    const validPayload = {
      jiraProjectId: '10001',
      jiraProjectKey: 'TRI',
      jiraProjectName: 'Triage',
    };

    it('should reject allowedBranches with more than 50 items', async () => {
      const dto = plainToInstance(SetJiraConfigBodyDto, {
        ...validPayload,
        allowedBranches: Array.from({ length: 51 }, (_, i) => `branch-${i}`),
      });
      const errors = await validate(dto);
      const branchErrors = errors.filter(
        (e) => e.property === 'allowedBranches',
      );
      expect(branchErrors.length).toBeGreaterThan(0);
    });

    it('should reject branch names longer than 255 characters', async () => {
      const dto = plainToInstance(SetJiraConfigBodyDto, {
        ...validPayload,
        allowedBranches: ['a'.repeat(256)],
      });
      const errors = await validate(dto);
      const branchErrors = errors.filter(
        (e) => e.property === 'allowedBranches',
      );
      expect(branchErrors.length).toBeGreaterThan(0);
    });

    it('should accept valid allowedBranches', async () => {
      const dto = plainToInstance(SetJiraConfigBodyDto, {
        ...validPayload,
        allowedBranches: ['main', 'develop'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should accept empty allowedBranches (omitted)', async () => {
      const dto = plainToInstance(SetJiraConfigBodyDto, validPayload);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- LinkJiraIssueBodyDto ----------

  describe('LinkJiraIssueBodyDto', () => {
    const validPayload = {
      jiraIssueKey: 'TRI-142',
      vulnerabilityIds: ['vuln-1'],
      scannerType: 'sast',
    };

    it('should reject non-HTTPS cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'http://app.example.com',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject private IP 192.168.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://192.168.1.1/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject private IP 127.x.x.x in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://127.0.0.1/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject localhost in cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://localhost:3000/app',
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should reject cybedefendBaseUrl longer than 2048 characters', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://app.example.com/' + 'a'.repeat(2048),
      });
      const errors = await validate(dto);
      const urlErrors = errors.filter(
        (e) => e.property === 'cybedefendBaseUrl',
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should accept valid HTTPS cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, {
        ...validPayload,
        cybedefendBaseUrl: 'https://app.example.com',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should accept omitted cybedefendBaseUrl (optional)', async () => {
      const dto = plainToInstance(LinkJiraIssueBodyDto, validPayload);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
