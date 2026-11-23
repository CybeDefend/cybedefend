import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { JiraIssueService } from './jira-issue.service';
import { JiraService } from './jira.service';
import { JiraDescriptionService } from './jira-description.service';
import {
  VulnerabilityIssueMapping,
  IssuePlatform,
} from '../../entities/vulnerability-issue-mapping.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import { In } from 'typeorm';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { IssueCreationMode } from '@grpc/external-integrations/issue';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';

function makeFakeVulnerability(overrides?: Record<string, unknown>) {
  return {
    vulnerabilityId: 'vuln-1',
    scannerType: 'sast',
    severity: 'high',
    name: 'SQL Injection',
    shortDescription: 'SQL injection vulnerability',
    description: 'Detailed description',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 15,
    cwe: ['CWE-89'],
    owaspTop10: [],
    cvssScore: 8.0,
    packageName: '',
    packageVersion: '',
    fixedVersion: '',
    externalId: 'CWE-89',
    cybedefendUrl: 'https://app.example.com/vuln/1',
    branch: 'main',
    ...overrides,
  };
}

describe('JiraIssueService', () => {
  let service: JiraIssueService;
  let issueMappingRepo: ReturnType<typeof createMockRepository>;
  let projectMappingRepo: ReturnType<typeof createMockRepository>;
  let jiraService: Partial<JiraService>;
  let descriptionService: Partial<JiraDescriptionService>;
  let billingWritable: { isWritable: jest.Mock; assertWritable: jest.Mock };

  beforeEach(async () => {
    issueMappingRepo = createMockRepository();
    projectMappingRepo = createMockRepository();
    billingWritable = {
      isWritable: jest.fn().mockResolvedValue(true),
      assertWritable: jest.fn().mockResolvedValue(undefined),
    };

    jiraService = {
      getIntegrationForOrga: jest.fn().mockResolvedValue({
        id: 'int-1',
        organizationId: 'org-1',
        siteUrl: 'https://test.atlassian.net',
      }),
      jiraApiCall: jest.fn().mockResolvedValue({
        key: 'PROJ-123',
        id: '10001',
        fields: {
          summary: 'Existing issue title',
          status: { name: 'Open' },
          description: null,
        },
      }),
    };

    descriptionService = {
      buildIssueSummary: jest.fn().mockImplementation((text) => text),
      mapSeverityToPriority: jest
        .fn()
        .mockReturnValue({ id: '2', name: 'High' }),
      buildSingleVulnerabilityDescription: jest
        .fn()
        .mockReturnValue({ type: 'doc' }),
      buildGroupedVulnerabilityDescription: jest
        .fn()
        .mockReturnValue({ type: 'doc' }),
      buildLinkedVulnerabilitiesSection: jest
        .fn()
        .mockReturnValue([{ type: 'paragraph' }]),
      appendToDescription: jest.fn().mockReturnValue({ type: 'doc' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraIssueService,
        {
          provide: getRepositoryToken(VulnerabilityIssueMapping),
          useValue: issueMappingRepo,
        },
        {
          provide: getRepositoryToken(JiraProjectMapping),
          useValue: projectMappingRepo,
        },
        { provide: JiraService, useValue: jiraService },
        { provide: JiraDescriptionService, useValue: descriptionService },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: entitlementsMock({
            assertWritable: billingWritable.assertWritable,
          }),
        },
      ],
    }).compile();

    service = module.get<JiraIssueService>(JiraIssueService);
  });

  describe('createIssues - duplicate handling (HIGH-3)', () => {
    it('should handle ER_DUP_ENTRY gracefully without throwing', async () => {
      // Setup: no existing mapping, no existing vuln mappings
      issueMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.find.mockResolvedValue([]);
      projectMappingRepo.findOne.mockResolvedValue(null);

      // The save call throws ER_DUP_ENTRY (duplicate key)
      const dupError = new Error('Duplicate entry') as any;
      dupError.code = 'ER_DUP_ENTRY';
      issueMappingRepo.save.mockRejectedValue(dupError);

      // Mock createIssueWithRetry via jiraApiCall
      (jiraService.jiraApiCall as jest.Mock).mockResolvedValue({
        key: 'PROJ-1',
        id: '10001',
      });

      const result = await service.createIssues({
        projectId: 'proj-1',
        organizationId: 'org-1',
        scanId: 'scan-1',
        mode: IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
        vulnerabilities: [makeFakeVulnerability()],
        cybedefendBaseUrl: 'https://app.example.com',
        jiraProjectKey: 'PROJ',
      });

      // Should not throw, and should still report the issue as created
      // because the Jira issue itself was created successfully
      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.failedVulnerabilityIds).toHaveLength(0);
    });

    it('should rethrow non-duplicate save errors', async () => {
      issueMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.find.mockResolvedValue([]);
      projectMappingRepo.findOne.mockResolvedValue(null);

      // A non-duplicate error (e.g. connection error)
      const connectionError = new Error('Connection refused') as any;
      connectionError.code = 'ECONNREFUSED';
      issueMappingRepo.save.mockRejectedValue(connectionError);

      (jiraService.jiraApiCall as jest.Mock).mockResolvedValue({
        key: 'PROJ-1',
        id: '10001',
      });

      const result = await service.createIssues({
        projectId: 'proj-1',
        organizationId: 'org-1',
        scanId: 'scan-1',
        mode: IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
        vulnerabilities: [makeFakeVulnerability()],
        cybedefendBaseUrl: 'https://app.example.com',
        jiraProjectKey: 'PROJ',
      });

      // Non-duplicate errors should still be caught by the outer try/catch
      // and result in failedVulnerabilityIds
      expect(result.failedVulnerabilityIds).toContain('vuln-1');
    });

    it('should skip duplicate mappings but save non-duplicate ones in a group', async () => {
      issueMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.find.mockResolvedValue([]);
      projectMappingRepo.findOne.mockResolvedValue(null);

      const dupError = new Error('Duplicate entry') as any;
      dupError.code = 'ER_DUP_ENTRY';

      // First save succeeds, second throws ER_DUP_ENTRY
      issueMappingRepo.save
        .mockResolvedValueOnce({ id: 'mapping-1' })
        .mockRejectedValueOnce(dupError);

      (jiraService.jiraApiCall as jest.Mock).mockResolvedValue({
        key: 'PROJ-1',
        id: '10001',
      });

      const vuln1 = makeFakeVulnerability({ vulnerabilityId: 'vuln-1' });
      const vuln2 = makeFakeVulnerability({
        vulnerabilityId: 'vuln-2',
        name: 'SQL Injection',
        externalId: 'CWE-89',
      });

      const result = await service.createIssues({
        projectId: 'proj-1',
        organizationId: 'org-1',
        scanId: 'scan-1',
        mode: IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
        vulnerabilities: [vuln1, vuln2],
        cybedefendBaseUrl: 'https://app.example.com',
        jiraProjectKey: 'PROJ',
      });

      // Should succeed even though one mapping was a duplicate
      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.failedVulnerabilityIds).toHaveLength(0);
      // Save was called twice (once for each vuln in the group)
      expect(issueMappingRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('linkExistingIssue - idempotency (MED-7)', () => {
    it('should update existing mapping instead of creating duplicate', async () => {
      const existingMapping = {
        id: 'mapping-1',
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-1',
        platform: IssuePlatform.JIRA,
        externalIssueId: 'PROJ-123',
        issueState: 'open',
        issueTitle: 'Old title',
      };

      // findOne returns existing mapping
      issueMappingRepo.findOne.mockResolvedValue(existingMapping);
      issueMappingRepo.save.mockResolvedValue(existingMapping);

      const result = await service.linkExistingIssue({
        projectId: 'proj-1',
        organizationId: 'org-1',
        jiraIssueKey: 'PROJ-123',
        vulnerabilityIds: ['vuln-1'],
        scannerType: 'sast',
        vulnerabilities: [makeFakeVulnerability()],
        cybedefendBaseUrl: 'https://app.example.com',
      });

      expect(result.success).toBe(true);

      // Should call findOne to check for existing mapping
      expect(issueMappingRepo.findOne).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          vulnerabilityId: 'vuln-1',
          platform: IssuePlatform.JIRA,
          externalIssueId: 'PROJ-123',
        },
      });

      // Should save the existing entity (update), preserving its id
      expect(issueMappingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mapping-1',
          issueState: 'open',
          issueTitle: 'Existing issue title',
        }),
      );
    });

    it('should create new mapping when none exists', async () => {
      // First findOne call is from jiraApiCall validation step (not our concern),
      // The findOne calls inside the loop return null (no existing mapping)
      issueMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.save.mockResolvedValue({ id: 'new-mapping-1' });

      const result = await service.linkExistingIssue({
        projectId: 'proj-1',
        organizationId: 'org-1',
        jiraIssueKey: 'PROJ-123',
        vulnerabilityIds: ['vuln-1'],
        scannerType: 'sast',
        vulnerabilities: [makeFakeVulnerability()],
        cybedefendBaseUrl: 'https://app.example.com',
      });

      expect(result.success).toBe(true);

      // Should call findOne to check for existing mapping
      expect(issueMappingRepo.findOne).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          vulnerabilityId: 'vuln-1',
          platform: IssuePlatform.JIRA,
          externalIssueId: 'PROJ-123',
        },
      });

      // Should save a new mapping (no id property)
      expect(issueMappingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          vulnerabilityId: 'vuln-1',
          platform: IssuePlatform.JIRA,
          externalIssueId: 'PROJ-123',
          creationMode: 'linked',
        }),
      );
      // The saved object should NOT have an 'id' key
      const saveArg = issueMappingRepo.save.mock.calls[0][0];
      expect(saveArg).not.toHaveProperty('id');
    });

    it('should handle multiple vulnerability IDs with mixed existing/new', async () => {
      const existingMapping = {
        id: 'mapping-1',
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-1',
        platform: IssuePlatform.JIRA,
        externalIssueId: 'PROJ-123',
        issueState: 'open',
        issueTitle: 'Old title',
      };

      // First vuln has existing mapping, second does not
      issueMappingRepo.findOne
        .mockResolvedValueOnce(existingMapping)
        .mockResolvedValueOnce(null);
      issueMappingRepo.save.mockResolvedValue({});

      const result = await service.linkExistingIssue({
        projectId: 'proj-1',
        organizationId: 'org-1',
        jiraIssueKey: 'PROJ-123',
        vulnerabilityIds: ['vuln-1', 'vuln-2'],
        scannerType: 'sast',
        vulnerabilities: [makeFakeVulnerability()],
        cybedefendBaseUrl: 'https://app.example.com',
      });

      expect(result.success).toBe(true);
      // findOne called once per vulnId
      expect(issueMappingRepo.findOne).toHaveBeenCalledTimes(2);
      // save called once per vulnId (update for first, create for second)
      expect(issueMappingRepo.save).toHaveBeenCalledTimes(2);

      // First call: update existing (has id)
      const firstSaveArg = issueMappingRepo.save.mock.calls[0][0];
      expect(firstSaveArg).toHaveProperty('id', 'mapping-1');

      // Second call: create new (no id)
      const secondSaveArg = issueMappingRepo.save.mock.calls[1][0];
      expect(secondSaveArg).not.toHaveProperty('id');
      expect(secondSaveArg).toHaveProperty('vulnerabilityId', 'vuln-2');
    });
  });

  // writes_blocked gate
  describe('createIssues (writes_blocked gate)', () => {
    const buildRequest = () => ({
      projectId: 'proj-1',
      organizationId: 'org-1',
      scanId: 'scan-1',
      mode: IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE,
      vulnerabilities: [makeFakeVulnerability()],
      cybedefendBaseUrl: 'https://app.example.com',
      jiraProjectKey: 'PROJ',
    });

    it('rejects with WRITES_BLOCKED when org is in read-only mode', async () => {
      billingWritable.assertWritable.mockRejectedValue(
        new RpcException({ code: 7, message: 'WRITES_BLOCKED' }),
      );

      await expect(
        service.createIssues(buildRequest() as any),
      ).rejects.toBeInstanceOf(RpcException);
      expect(jiraService.jiraApiCall).not.toHaveBeenCalled();
    });

    it('proceeds when writable', async () => {
      issueMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.find.mockResolvedValue([]);
      projectMappingRepo.findOne.mockResolvedValue(null);
      issueMappingRepo.save.mockResolvedValue({});
      (jiraService.jiraApiCall as jest.Mock).mockResolvedValue({
        key: 'PROJ-1',
        id: '10001',
      });

      const result = await service.createIssues(buildRequest() as any);
      expect(billingWritable.assertWritable).toHaveBeenCalledWith('org-1');
      expect(result.success).toBe(true);
    });
  });

  // A sync writes only the ticket mappings created on the Jira site of the
  // organization's integration: an issue key is unique only within one site,
  // so a row of another site is never re-keyed, re-pointed or re-stated.
  describe('getIssueStatus scoped by the organization Jira site', () => {
    const OWN = 'https://test.atlassian.net';
    const OTHER = 'https://other.atlassian.net';
    const row = (id: string, site: string, key = 'PROJ-1') => ({
      id,
      projectId: 'proj-1',
      externalIssueId: key,
      platform: IssuePlatform.JIRA,
      issueTitle: `Ticket ${id}`,
      issueUrl: `${site}/browse/${key}`,
      issueState: 'open',
      vulnerabilityId: `vuln-${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const jiraAnswers = (key: string) =>
      (jiraService.jiraApiCall as jest.Mock).mockResolvedValue({
        key,
        id: '10002',
        fields: { status: { name: 'Done', statusCategory: { key: 'done' } } },
      });
    const sync = () =>
      service.getIssueStatus({
        projectId: 'proj-1',
        organizationId: 'org-1',
        externalIssueKeys: ['PROJ-1'],
      } as any);

    beforeEach(() => {
      (jiraService as Record<string, unknown>).jiraDevStatusCall = jest
        .fn()
        .mockResolvedValue({ detail: [] });
      // No project config: a ticket linked without one is still synced.
      projectMappingRepo.findOne.mockResolvedValue(null);
      jiraAnswers('PROJ-1');
    });

    it('skips a key whose mappings are on another site: no Jira call, no update, no status', async () => {
      issueMappingRepo.find.mockResolvedValue([row('m1', OTHER)]);

      const result = await sync();

      expect(issueMappingRepo.find).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          externalIssueId: 'PROJ-1',
          platform: IssuePlatform.JIRA,
        },
      });
      expect(jiraService.jiraApiCall).not.toHaveBeenCalled();
      expect(issueMappingRepo.update).not.toHaveBeenCalled();
      expect(result.statuses).toEqual([]);
    });

    it('re-keys and re-states the tickets of a project without Jira config on the organization site', async () => {
      issueMappingRepo.find.mockResolvedValue([row('m1', OWN)]);
      jiraAnswers('PROJ-2');

      const result = await sync();

      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        { id: In(['m1']) },
        { externalIssueId: 'PROJ-2', issueUrl: `${OWN}/browse/PROJ-2` },
      );
      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        { id: In(['m1']) },
        { issueState: 'done' },
      );
      expect(result.statuses).toEqual([
        expect.objectContaining({ issueKey: 'PROJ-2', status: 'Done' }),
      ]);
    });

    it('updates only the rows of the organization site when a key has rows of two sites', async () => {
      issueMappingRepo.find.mockResolvedValue([
        row('m1', OWN),
        row('m2', OTHER),
        row('m3', OWN),
      ]);
      jiraAnswers('PROJ-2');

      await sync();

      expect(issueMappingRepo.update).toHaveBeenCalledTimes(2);
      for (const [where] of (issueMappingRepo.update as jest.Mock).mock.calls) {
        expect(where).toEqual({ id: In(['m1', 'm3']) });
      }
    });

    it('updates the state only when the key did not change', async () => {
      issueMappingRepo.find.mockResolvedValue([row('m1', OWN)]);

      const result = await sync();

      expect(issueMappingRepo.update).toHaveBeenCalledTimes(1);
      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        { id: In(['m1']) },
        { issueState: 'done' },
      );
      expect(result.statuses).toHaveLength(1);
    });

    it('matches a site stored with a trailing slash', async () => {
      (jiraService.getIntegrationForOrga as jest.Mock).mockResolvedValue({
        id: 'int-1',
        organizationId: 'org-1',
        siteUrl: `${OWN}/`,
      });
      issueMappingRepo.find.mockResolvedValue([row('m1', OWN)]);

      await sync();

      expect(issueMappingRepo.update).toHaveBeenCalledWith(
        { id: In(['m1']) },
        { issueState: 'done' },
      );
    });

    it('getProjectIssues still lists the tickets of a project without Jira config', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([row('m1', OWN)]),
      };
      issueMappingRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getProjectIssues({
        projectId: 'proj-1',
        organizationId: 'org-1',
      } as any);

      expect(result.issues).toEqual([
        expect.objectContaining({ title: 'Ticket m1' }),
      ]);
    });
  });
});
