import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwaspReportService } from './owasp-report.service';
import { OwaspReport } from 'src/entities/owasp-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { ProjectNameResolverModule } from '../shared/project-name-resolver.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OwaspReport,
      ScaVulnerabilityDetections,
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
    ]),
    // Project name resolution for the report header.
    ProjectNameResolverModule,
  ],
  providers: [OwaspReportService],
  exports: [OwaspReportService],
})
export class OwaspReportModule {}
