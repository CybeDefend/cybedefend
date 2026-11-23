import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CweReportModule } from './cwe-report.module';
import { CweReportService } from './cwe-report.service';
import { ProjectNameResolver } from '../shared/project-name-resolver.service';
import { PdfGeneratorService } from 'src/core/utils/pdf-generator.service';
import { CweReport } from 'src/entities/cwe-report.entity';
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
 * Integration smoke: compile the real {@link CweReportModule} with mocked
 * TypeORM repositories. This catches dependency-injection mistakes — notably
 * that `CweReportService` must resolve its `ProjectNameResolver` dependency
 * through the module itself, so consumers only need to import `CweReportModule`
 * (never re-declare `CweReportService` as a bare provider).
 */
describe('CweReportModule', () => {
  it('resolves CweReportService with ProjectNameResolver wired in', async () => {
    const fakeRepo = () => ({
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [TestGlobalsModule, CweReportModule],
    })
      .overrideProvider(getRepositoryToken(CweReport))
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

    expect(moduleRef.get(CweReportService)).toBeDefined();

    expect(moduleRef.get(ProjectNameResolver)).toBeDefined();
  });
});
