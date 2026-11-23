/* eslint-disable @typescript-eslint/no-unused-vars -- the Community
   implementations ignore their port's arguments on purpose */
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Scan } from 'src/entities/scan.entity';
import type {
  ProjectScanSettings,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';
import type {
  AgentCloseOutcome,
  AgentQueueTickResult,
  AiAnalysisPort,
} from '../ports/ai-analysis.port';
import { SCANNERS_NOT_AVAILABLE } from '../ports/scanner-orchestrator.port';

/**
 * The Community Edition runs no agent containers and no AI queue: ingestion
 * is a no-op, the queue tick reports nothing, no agent container can be
 * closed, and a graph-only scan is refused like any other non-import scan.
 */
export class CommunityAiAnalysis implements AiAnalysisPort {
  async triggerAgentIngestion(
    _scan: Scan,
    _fileUrl: string,
    _project: ProjectScanSettings,
  ): Promise<void> {
    // No agent row is created.
  }

  async startGraphOnlyScan(
    _scan: Scan,
    _request: StartScanRequest,
  ): Promise<StartScanResponse> {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: SCANNERS_NOT_AVAILABLE,
    });
  }

  async runAgentAnalysisQueue(): Promise<AgentQueueTickResult> {
    return { closed: 0, queued: 0, started: 0 };
  }

  async closeAgentContainer(
    _scanId: string,
    _containerId: string,
    _outcome: AgentCloseOutcome,
  ): Promise<boolean> {
    return false;
  }
}
