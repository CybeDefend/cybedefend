import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CweReportService } from './cwe-report.service';
import { CweReport } from 'src/entities/cwe-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { ProjectNameResolverModule } from '../shared/project-name-resolver.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CweReport,
      ScaVulnerabilityDetections,
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
    ]),
    // Project name resolution for the report header.
    ProjectNameResolverModule,
  ],
  providers: [CweReportService],
  exports: [CweReportService],
})
export class CweReportModule {}
