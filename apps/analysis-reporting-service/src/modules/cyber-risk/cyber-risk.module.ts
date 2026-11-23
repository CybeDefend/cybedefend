import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GrpcModule } from '@grpc/grpc.module';

import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { ProjectCyberRiskEntity } from 'src/entities/project-cyber-risk.entity';

import { CyberRiskService } from './cyber-risk.service';
import { ActiveVulnFetcher } from './active-vuln-fetcher.service';
import { ReferenceBranchResolver } from './reference-branch.resolver';
import { ProjectCyberRiskRepository } from './repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from './cyberisk-recompute.enqueuer';

/**
 * Owns the CybeRisk Score computation + persistence + recompute
 * enqueue. The CYBERISK_RECOMPUTE BullMQ queue is registered centrally in
 * the @Global ScanQueueModule (alongside the other queues), so the
 * @InjectQueue in CyberiskRecomputeEnqueuer resolves without a local
 * registerQueue here. ActiveVulnFetcher needs the 6 detection repositories,
 * so they stay in forFeature.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      ScaVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
      SecretVulnerabilityDetections,
      ProjectCyberRiskEntity,
    ]),
    GrpcModule.register(),
  ],
  providers: [
    CyberRiskService,
    ActiveVulnFetcher,
    ReferenceBranchResolver,
    ProjectCyberRiskRepository,
    CyberiskRecomputeEnqueuer,
  ],
  exports: [
    CyberRiskService,
    CyberiskRecomputeEnqueuer,
    ProjectCyberRiskRepository,
    ActiveVulnFetcher,
    ReferenceBranchResolver,
  ],
})
export class CyberRiskModule {}
