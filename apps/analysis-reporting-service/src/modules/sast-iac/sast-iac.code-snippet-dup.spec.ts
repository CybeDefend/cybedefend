import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { SastIacService } from './sast-iac.service';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { Logger } from 'nestjs-pino';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';

/**
 * `addCodeSnippet` must be resilient to the duplicate-primary-key
 * race. A scan batch is processed by several concurrent workers
 * (`processVulnsWithConcurrency`), the BullMQ queue is multi-consumer, and the
 * driver/job can replay an INSERT whose ack was lost. When that happens MySQL
 * rejects the second INSERT with `ER_DUP_ENTRY`
 * (`Duplicate entry '<uuid>' for key 'code_snippet.PRIMARY'`). The snippet row
 * already exists, so this must NOT bubble up and fail the whole scan batch.
 */
describe('SastIacUtilsService – code_snippet duplicate-key resilience', () => {
  let service: SastIacUtilsService;
  let codeSnippetRepo: any;

  /** Build a MySQL duplicate-entry error shaped like the real driver error. */
  function makeDupEntryError(id: string): QueryFailedError {
    const err = new QueryFailedError(
      'INSERT INTO `code_snippet` ...',
      [],
      new Error(
        `Duplicate entry '${id}' for key 'code_snippet.PRIMARY'`,
      ) as any,
    );
    // mysql2 surfaces the SQLSTATE code both on the error and its driverError.
    (err as any).code = 'ER_DUP_ENTRY';
    (err as any).driverError = { code: 'ER_DUP_ENTRY', errno: 1062 };
    return err;
  }

  beforeEach(async () => {
    codeSnippetRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: codeSnippetRepo,
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: {} },
        { provide: ResultService, useValue: {} },
        { provide: IssueIntegrationService, useValue: {} },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn() },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(SastIacUtilsService);
  });

  function makeSnippet(): CodeSnippet {
    const snippet = new CodeSnippet();
    snippet.id = '9e5f159f-6fd5-47a0-bc3b-78b85785f751';
    snippet.startLine = 1;
    snippet.endLine = 2;
    snippet.vulnerableStartLine = 1;
    snippet.vulnerableEndLine = 1;
    snippet.code = '[]';
    snippet.language = 'javascript';
    return snippet;
  }

  it('swallows ER_DUP_ENTRY (concurrent/replayed INSERT) instead of failing the batch', async () => {
    const snippet = makeSnippet();
    codeSnippetRepo.save.mockRejectedValueOnce(makeDupEntryError(snippet.id));

    // Must not throw — the row already exists, so the insert is a no-op.
    await expect(service.addCodeSnippet(snippet)).resolves.toBe(snippet);
    expect(codeSnippetRepo.save).toHaveBeenCalledTimes(1);
  });

  it('still propagates non-duplicate database errors', async () => {
    const snippet = makeSnippet();
    const otherError = new QueryFailedError(
      'INSERT INTO `code_snippet` ...',
      [],
      new Error('ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded') as any,
    );
    (otherError as any).code = 'ER_LOCK_WAIT_TIMEOUT';
    codeSnippetRepo.save.mockRejectedValueOnce(otherError);

    await expect(service.addCodeSnippet(snippet)).rejects.toBe(otherError);
  });

  it('returns the saved snippet unchanged on the happy path', async () => {
    const snippet = makeSnippet();
    codeSnippetRepo.save.mockResolvedValueOnce(snippet);

    await expect(service.addCodeSnippet(snippet)).resolves.toBe(snippet);
  });
});
