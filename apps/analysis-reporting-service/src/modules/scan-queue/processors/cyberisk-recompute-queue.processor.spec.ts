import { Job } from 'bullmq';
import { CyberiskRecomputeQueueProcessor } from './cyberisk-recompute-queue.processor';
import type { CyberRiskService } from '../../cyber-risk/cyber-risk.service';
import type { CyberiskRecomputeEnqueuer } from '../../cyber-risk/cyberisk-recompute.enqueuer';
import type { ProjectScoreSyncService } from '../../cyber-risk/project-score-sync.service';
import type { CyberiskRecomputeJobData } from '../../cyber-risk/cyberisk-recompute.types';

describe('CyberiskRecomputeQueueProcessor', () => {
  let cyberRisk: jest.Mocked<CyberRiskService>;
  let enqueuer: jest.Mocked<CyberiskRecomputeEnqueuer>;
  let scoreSync: jest.Mocked<ProjectScoreSyncService>;
  let processor: CyberiskRecomputeQueueProcessor;

  beforeEach(() => {
    cyberRisk = {
      computeAndPersistProjectScore: jest.fn().mockResolvedValue({
        projectId: 'p1',
        score: 42,
        level: 'medium',
        vulnCount: 5,
        computedAt: new Date(),
      }),
    } as unknown as jest.Mocked<CyberRiskService>;
    enqueuer = {
      readDirty: jest.fn().mockResolvedValue(0),
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CyberiskRecomputeEnqueuer>;
    scoreSync = {
      pushScore: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProjectScoreSyncService>;
    const orgStats = {
      markDirtyForProject: jest.fn().mockResolvedValue(undefined),
    } as any;
    processor = new CyberiskRecomputeQueueProcessor(
      cyberRisk,
      enqueuer,
      scoreSync,
      orgStats,
    );
  });

  function jobOf(
    data: CyberiskRecomputeJobData,
    id = 'cyberisk-p1',
  ): Job<CyberiskRecomputeJobData> {
    return { data, id } as unknown as Job<CyberiskRecomputeJobData>;
  }

  describe('process', () => {
    it('delegates to CyberRiskService.computeAndPersistProjectScore', async () => {
      await processor.process(
        jobOf({ projectId: 'p1', trigger: 'scan_complete' }),
      );
      expect(cyberRisk.computeAndPersistProjectScore).toHaveBeenCalledWith(
        'p1',
      );
    });

    it('pushes the recomputed score to global-management as the sort key', async () => {
      await processor.process(
        jobOf({ projectId: 'p1', trigger: 'scan_complete' }),
      );
      expect(scoreSync.pushScore).toHaveBeenCalledWith('p1', 42);
    });

    it('does not push when the recompute itself fails', async () => {
      cyberRisk.computeAndPersistProjectScore.mockRejectedValueOnce(
        new Error('boom'),
      );
      await expect(
        processor.process(jobOf({ projectId: 'p2', trigger: 'vuln_update' })),
      ).rejects.toThrow('boom');
      expect(scoreSync.pushScore).not.toHaveBeenCalled();
    });

    it('re-throws when the service fails', async () => {
      cyberRisk.computeAndPersistProjectScore.mockRejectedValueOnce(
        new Error('boom'),
      );
      await expect(
        processor.process(jobOf({ projectId: 'p2', trigger: 'vuln_update' })),
      ).rejects.toThrow('boom');
    });
  });

  describe('onCompleted catch-up (lost-update guard)', () => {
    it('re-enqueues once when the dirty counter moved during processing', async () => {
      enqueuer.readDirty.mockResolvedValueOnce(1); // snapshot at job start
      const job = jobOf({ projectId: 'p1', trigger: 'vuln_update' });
      await processor.process(job);

      enqueuer.readDirty.mockResolvedValueOnce(2); // a mutation landed mid-run
      await processor.onCompleted(job);

      expect(enqueuer.enqueue).toHaveBeenCalledWith('p1', 'vuln_update');
    });

    it('does NOT re-enqueue when the dirty counter is unchanged', async () => {
      enqueuer.readDirty.mockResolvedValueOnce(5); // start
      const job = jobOf({ projectId: 'p1', trigger: 'scan_complete' });
      await processor.process(job);

      enqueuer.readDirty.mockResolvedValueOnce(5); // completion — unchanged
      await processor.onCompleted(job);

      expect(enqueuer.enqueue).not.toHaveBeenCalled();
    });

    it('does nothing when no start snapshot exists for the job', async () => {
      // 'completed' fires without this worker having run process() for the job.
      await processor.onCompleted(
        jobOf({ projectId: 'p9', trigger: 'manual' }, 'cyberisk-p9'),
      );
      expect(enqueuer.enqueue).not.toHaveBeenCalled();
      expect(enqueuer.readDirty).not.toHaveBeenCalled();
    });

    it('swallows catch-up errors instead of crashing the worker', async () => {
      enqueuer.readDirty.mockResolvedValueOnce(1);
      const job = jobOf({ projectId: 'p1', trigger: 'manual' });
      await processor.process(job);

      enqueuer.readDirty.mockRejectedValueOnce(new Error('redis down'));
      await expect(processor.onCompleted(job)).resolves.toBeUndefined();
    });
  });
});
