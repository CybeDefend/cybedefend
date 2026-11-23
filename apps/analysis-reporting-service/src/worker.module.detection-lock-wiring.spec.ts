// Prevent ConfigModule.forRoot({ validationSchema }) from running Joi at
// decoration time (it throws in CI, where the env is not set). Mirrors
// cron.osv.module.spec.ts. Nothing here is booted: the checks read Nest
// metadata, plus one DI compile of a minimal graph.
jest.mock('@nestjs/config', () => ({
  ConfigModule: {
    forRoot: jest.fn().mockReturnValue({ module: class MockConfigModule {} }),
  },
  ConfigService: jest.fn(),
}));

import { Global, Module } from '@nestjs/common';
import { GLOBAL_MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';
import { AppModule } from './app.module';
import { ResultModule } from './modules/result/result.module';
import { ScanQueueModule } from './modules/scan-queue/scan-queue.module';
import { ScanQueueService } from './modules/scan-queue/scan-queue.service';
import { SastIacUtilsService } from './modules/sast-iac/sast-iac.utils';
import { SastIacService } from './modules/sast-iac/sast-iac.service';
import { ResultService } from './modules/result/result.service';
import { IssueIntegrationService } from './modules/vulnerability/issue-integration.service';
import { CvssCalculatorService } from './modules/cvss/cvss-calculator.service';
import { SecretEncryptionService } from './core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from './modules/cyber-risk/cyberisk-recompute.enqueuer';
import { CodeSnippet } from './entities/code-snippet.entity';
import { DataFlowItem } from './entities/data-flow-item.entity';
import { CorrespondanceTable } from './entities/vulnerability/correspondance-table.entity';
import { VulnerabilityDetectionHistory } from './entities/vulnerability-detection-history.entity';
import { SastVulnerabilityDetections } from './entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from './entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from './entities/secret-vulnerability-detections.entity';

/**
 * The per-position detection creation lock (SastIacUtilsService ->
 * ScanQueueService) is an OPTIONAL dependency, so the many legacy unit-test
 * modules keep compiling. The price: a runtime module that forgets to make
 * ScanQueueService visible to SastIacUtilsService compiles too, and silently
 * ingests without the lock forever — twin findings stored twice again. These
 * checks pin the wiring of the worker, where every scan ingestion runs
 * (SastIacQueueProcessor), and of the gRPC server, which provides the same
 * service through ResultModule.
 */
describe('detection creation lock wiring', () => {
  const importsOf = (module: unknown): unknown[] =>
    Reflect.getMetadata('imports', module) ?? [];
  const providersOf = (module: unknown): unknown[] =>
    Reflect.getMetadata('providers', module) ?? [];

  it('SastIacUtilsService asks Nest for ScanQueueService, by class', () => {
    expect(
      Reflect.getMetadata('design:paramtypes', SastIacUtilsService),
    ).toContain(ScanQueueService);
  });

  it('ScanQueueModule is @Global and exports ScanQueueService', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, ScanQueueModule)).toBe(
      true,
    );
    expect(Reflect.getMetadata('exports', ScanQueueModule)).toContain(
      ScanQueueService,
    );
  });

  it('the worker (which consumes the SAST/IaC queue) provides SastIacUtilsService next to ScanQueueModule', () => {
    expect(providersOf(WorkerModule)).toContain(SastIacUtilsService);
    expect(importsOf(WorkerModule)).toContain(ScanQueueModule);
  });

  it('the gRPC server provides it the same way, through ResultModule (it only enqueues today)', () => {
    expect(importsOf(AppModule)).toContain(ResultModule);
    expect(providersOf(ResultModule)).toContain(SastIacUtilsService);
    expect(importsOf(AppModule)).toContain(ScanQueueModule);
  });

  it('Nest hands a globally provided ScanQueueService to SastIacUtilsService', async () => {
    const lock = {
      acquireDetectionCreationLock: jest.fn(),
      releaseDetectionCreationLock: jest.fn(),
    };
    @Global()
    @Module({
      providers: [{ provide: ScanQueueService, useValue: lock }],
      exports: [ScanQueueService],
    })
    class GlobalLockModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [GlobalLockModule],
      providers: [
        SastIacUtilsService,
        // Every other dependency, as an inert stub.
        ...[
          CodeSnippet,
          DataFlowItem,
          CorrespondanceTable,
          VulnerabilityDetectionHistory,
          SastVulnerabilityDetections,
          IacVulnerabilityDetections,
          CicdVulnerabilityDetections,
          SecretVulnerabilityDetections,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: {},
        })),
        ...[
          SastIacService,
          ResultService,
          IssueIntegrationService,
          Logger,
          CvssCalculatorService,
          SecretEncryptionService,
          CyberiskRecomputeEnqueuer,
        ].map((token) => ({ provide: token, useValue: {} })),
      ],
    }).compile();

    // Bracket access reaches the private field without casting the type away.
    expect(moduleRef.get(SastIacUtilsService)['scanQueueService']).toBe(lock);
  });
});
