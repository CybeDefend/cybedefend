import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OwaspReportModule } from './owasp-report.module';
import { OwaspReportService } from './owasp-report.service';
import { ProjectNameResolver } from '../shared/project-name-resolver.service';
import { PdfGeneratorService } from 'src/core/utils/pdf-generator.service';
import { OwaspReport } from 'src/entities/owasp-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';

/**
 * Mirror UtilsModule's `@Global()` registration so PdfGeneratorService and the
 * pino Logger are visible across module boundaries inside the test (the real
 * UtilsModule is `@Global()` in src/core/utils/utils.module.ts).
 */
@Global()
@Module({
  providers: [
    { provide: PdfGeneratorService, useValue: { generatePDF: jest.fn() } },
    {
      provide: Logger,
      useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    },
    { provide: ConfigService, useValue: { get: jest.fn(() => 'staging') } },
  ],
  exports: [PdfGeneratorService, Logger, ConfigService],
})
class TestGlobalsModule {}

/**
 * Integration smoke: compile the real {@link OwaspReportModule} with mocked
 * TypeORM repositories. This catches dependency-injection mistakes — notably
 * that `OwaspReportService` must resolve its `ProjectNameResolver` dependency
 * through the module itself, so consumers only need to import
 * `OwaspReportModule` (never re-declare `OwaspReportService` as a bare provider).
 */
describe('OwaspReportModule', () => {
  it('resolves OwaspReportService with ProjectNameResolver wired in', async () => {
    const fakeRepo = () => ({
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [TestGlobalsModule, OwaspReportModule],
    })
      .overrideProvider(getRepositoryToken(OwaspReport))
      .useValue(fakeRepo())
      .overrideProvider(getRepositoryToken(ScaVulnerabilityDetections))
      .useValue(fakeRepo())
      .overrideProvider(getRepositoryToken(SastVulnerabilityDetections))
      .useValue(fakeRepo())
      .overrideProvider(getRepositoryToken(IacVulnerabilityDetections))
      .useValue(fakeRepo())
      .overrideProvider(getRepositoryToken(VulnerabilityDetectionsContainer))
      .useValue(fakeRepo())
      .compile();

    expect(moduleRef.get(OwaspReportService)).toBeDefined();

    expect(moduleRef.get(ProjectNameResolver)).toBeDefined();
  });
});
