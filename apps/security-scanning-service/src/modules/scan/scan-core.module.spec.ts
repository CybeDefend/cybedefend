import { PROJECT_SCAN_SETTINGS_PORT } from 'src/edition/ports/project-scan-settings.port';
import { GIT_HISTORY_MODE_COMMUNITY_BINDINGS } from 'src/edition/community/git-history-mode.binding';
import { GIT_HISTORY_MODE_PORT } from 'src/edition/ports/git-history-mode.port';
import { GitHistoryCursor } from '../../entities/git-history-cursor.entity';
import { PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-scan-settings.binding';
import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { ScanCoreModule } from './scan-core.module';
import { ProjectAppsecMarker } from './core/projectAppsecMarker';
import { ScanPipelineEvents } from './core/scanPipelineEvents';
import { ScanStateStore } from './core/scanStateStore';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';
import { Scan } from '../../entities/scan.entity';
import { Container } from '../../entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import SecretsService from 'src/core/secrets/secrets.service';

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(async (entity: unknown) => entity),
  create: jest.fn((x: unknown) => x),
  createQueryBuilder: jest.fn(),
});

const grpcClientMock = () => ({ getService: jest.fn(() => ({})) });

// The app provides these globally (LoggerModule, RealtimePublisherModule.forRoot,
// SecretsModule, EditionModule); a module compiled alone needs them next to
// it. EditionModule is what provides SCAN_LIFECYCLE_HOOKS and
// PROJECT_SCAN_SETTINGS_PORT in the app; here the spec supplies the ports.
@Global()
@Module({
  providers: [
    {
      provide: Logger,
      useValue: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    },
    { provide: RealtimeEventPublisher, useValue: { publish: jest.fn() } },
    { provide: SecretsService, useValue: {} },
    { provide: SCAN_LIFECYCLE_HOOKS, useValue: { onScanClosed: jest.fn() } },
    ...PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS,
    ...GIT_HISTORY_MODE_COMMUNITY_BINDINGS,
  ],
  exports: [
    Logger,
    RealtimeEventPublisher,
    SecretsService,
    SCAN_LIFECYCLE_HOOKS,
    PROJECT_SCAN_SETTINGS_PORT,
    GIT_HISTORY_MODE_PORT,
  ],
})
class TestGlobalsModule {}

describe('ScanCoreModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ScanCoreModule, TestGlobalsModule],
    })
      .overrideProvider(getRepositoryToken(Scan))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(Container))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(Scanner))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(SupportedLanguage))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(GitHistoryCursor))
      .useValue(repoMock())
      .overrideProvider('BILLING_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('ANALYSIS_REPORTING_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('SECURITY_SCANNING_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('EXTERNAL_INTEGRATIONS_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('GLOBAL_MANAGEMENT_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('MARKETING_LEAD_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('FILE_MANAGEMENT_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('AGENT_SERVICE')
      .useValue(grpcClientMock())
      .overrideProvider('POLICY_MANAGEMENT_SERVICE')
      .useValue(grpcClientMock())
      .compile();
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('exports the primitives the edition implementations inject', () => {
    expect(moduleRef.get(ScanStateStore)).toBeDefined();
    expect(moduleRef.get(ScanPipelineEvents)).toBeDefined();
    expect(moduleRef.get(ProjectAppsecMarker)).toBeDefined();
  });
});
