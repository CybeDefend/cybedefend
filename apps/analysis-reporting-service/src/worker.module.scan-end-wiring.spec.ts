// Same module-loading guards as worker.module.detection-lock-wiring.spec.ts:
// nothing is booted, the checks read Nest metadata only.
jest.mock('@nestjs/config', () => ({
  ConfigModule: {
    forRoot: jest.fn().mockReturnValue({ module: class MockConfigModule {} }),
  },
  ConfigService: jest.fn(),
}));

import { getQueueToken } from '@nestjs/bullmq';
import { WorkerModule } from './worker.module';
import { ScanQueueModule } from './modules/scan-queue/scan-queue.module';
import { QUEUE_NAMES } from './modules/scan-queue/queue-names';
import { ScanEndEvaluationQueueProcessor } from './modules/scan-queue/processors/scan-end-evaluation-queue.processor';

/**
 * the delayed re-evaluation of a scan's end after a
 * scanner was given up must have a consumer in the worker that runs, and its
 * queue must be registered where every producer can reach it.
 */
describe('scan end evaluation queue wiring', () => {
  it('consumes the queue in the worker', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', WorkerModule) ?? [];
    expect(providers).toContain(ScanEndEvaluationQueueProcessor);
  });

  it('registers the queue in the global scan queue module', () => {
    const imports: { exports?: unknown[] }[] =
      Reflect.getMetadata('imports', ScanQueueModule) ?? [];
    // registerQueue exports its queue providers ({ provide: token, ... }).
    const exportedTokens = imports
      .flatMap((module) => module?.exports ?? [])
      .map((entry) =>
        typeof entry === 'object' && entry !== null && 'provide' in entry
          ? (entry as { provide: unknown }).provide
          : entry,
      );
    expect(exportedTokens).toContain(
      getQueueToken(QUEUE_NAMES.SCAN_END_EVALUATION),
    );
  });
});
