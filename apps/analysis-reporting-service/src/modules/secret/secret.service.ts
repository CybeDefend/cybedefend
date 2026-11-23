import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import { applyAgentAuditFields } from '../result/agent-audit.helper';
import { applyTriageToDetection } from '../findings-export/lifecycle.util';
import { SecretEncryptionService } from 'src/core/crypto/secret-encryption.service';
import { vulnerabilityUpdatedEvent } from 'src/core/realtime/vulnerability-updated.event';

@Injectable()
export class SecretService {
  constructor(
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretRepo: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(HistoryItem)
    private readonly historyRepo: Repository<HistoryItem>,
    private readonly encryption: SecretEncryptionService,
    private readonly dataSource: DataSource,
    @Optional() private readonly realtime?: RealtimeEventPublisher | null,
  ) {}

  /**
   * Reveal and rotate write a History row: tell the issue detail page, which
   * refetches only on VULNERABILITY_UPDATED.
   */
  private publishVulnerabilityUpdated(
    projectId: string,
    vulnerabilityId: string,
  ): void {
    if (!this.realtime) return;
    void this.realtime.publish(
      vulnerabilityUpdatedEvent(projectId, vulnerabilityId, 'secret'),
    );
  }

  async revealSecret(
    projectId: string,
    vulnerabilityId: string,
    userId: string,
  ): Promise<{ secret: string; revealedAt: Date }> {
    const detection = await this.secretRepo.findOne({
      where: { id: vulnerabilityId, projectId },
    });

    if (!detection || !detection.encryptedSecret) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: 'Secret detection not found or secret value not stored',
      });
    }

    const envelope = detection.encryptedSecret.toString('utf8');
    const plaintext = this.encryption.decrypt(envelope);

    const revealedAt = new Date();

    const history = new HistoryItem();
    history.type = 'SECRET_REVEALED';
    history.value = 'secret revealed';
    history.date = revealedAt;
    history.userId = userId;
    history.secretVulnerabilityDetection = detection;
    applyAgentAuditFields(history, { userId });
    await this.historyRepo.save(history);
    this.publishVulnerabilityUpdated(projectId, vulnerabilityId);

    return { secret: plaintext, revealedAt };
  }

  async rotateSecret(
    projectId: string,
    vulnerabilityId: string,
    userId: string,
  ): Promise<{ state: string }> {
    const detection = await this.secretRepo.findOne({
      where: { id: vulnerabilityId, projectId },
    });

    if (!detection) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: 'Secret detection not found',
      });
    }

    if (detection.currentState === 'resolved') {
      return { state: 'resolved' };
    }

    await this.dataSource.transaction(async (manager) => {
      const txSecretRepo = manager.getRepository(SecretVulnerabilityDetections);
      const txHistoryRepo = manager.getRepository(HistoryItem);

      // One clock for the detection stamp and the history row:
      // backfill-lifecycle.ts joins the two on equality to the second, and
      // history_item.date is datetime(0) — two `new Date()` calls either side of
      // a save can straddle a second boundary and break that join.
      const rotatedAt = new Date();

      detection.encryptedSecret = null;
      detection.currentState = 'resolved';
      // A rotation is a USER action, NOT the scan's auto-resolve: it carries the
      // authenticated userId, so it files as 'user'. Stamping it 'system' would
      // credit the scanner for something a person did — exactly the attribution
      // the GRC export exists to get right.
      applyTriageToDetection(
        detection,
        { status: 'resolved', userId },
        rotatedAt,
      );
      await txSecretRepo.save(detection);

      const history = new HistoryItem();
      history.type = 'SECRET_ROTATED';
      history.value = 'secret rotated';
      history.date = rotatedAt;
      history.userId = userId;
      history.secretVulnerabilityDetection = detection;
      applyAgentAuditFields(history, { userId });
      await txHistoryRepo.save(history);
    });
    this.publishVulnerabilityUpdated(projectId, vulnerabilityId);

    return { state: 'resolved' };
  }
}
