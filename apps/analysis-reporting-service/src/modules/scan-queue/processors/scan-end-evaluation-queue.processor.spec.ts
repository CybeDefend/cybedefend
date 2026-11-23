import { ScanEndEvaluationQueueProcessor } from './scan-end-evaluation-queue.processor';
import { ScanCompleteNotificationService } from '../scan-complete-notification.service';

/**
 * the delayed re-evaluation of a scan's end after a
 * scanner was given up. The job retries through BullMQ's backoff as long as
 * the end cannot be evaluated; any outcome (dispatched, waiting...) ends it.
 */
describe('ScanEndEvaluationQueueProcessor', () => {
  const data = {
    scanId: 's1',
    projectId: 'p1',
    scannerType: 'sast-iac' as const,
    scannerName: 'kics',
  };
  const job = (attemptsMade = 1) =>
    ({
      id: 'scan-end-s1-sast-iac-kics-x',
      data,
      attemptsMade,
      opts: { attempts: 7 },
    }) as any;

  let giveUpScanner: jest.Mock;
  let processor: ScanEndEvaluationQueueProcessor;

  beforeEach(() => {
    giveUpScanner = jest.fn().mockResolvedValue('dispatched');
    processor = new ScanEndEvaluationQueueProcessor({
      giveUpScanner,
    } as unknown as ScanCompleteNotificationService);
  });

  it('gives the scanner up and evaluates the end of its scan', async () => {
    await expect(processor.process(job())).resolves.toBe('dispatched');
    expect(giveUpScanner).toHaveBeenCalledWith(data);
  });

  it('ends on an outcome that is not a dispatch: waiting is not retried', async () => {
    giveUpScanner.mockResolvedValue('waiting');
    await expect(processor.process(job())).resolves.toBe('waiting');
  });

  it('fails the job when the end cannot be evaluated, so BullMQ retries it', async () => {
    giveUpScanner.mockRejectedValue(new Error('14 UNAVAILABLE'));
    await expect(processor.process(job())).rejects.toThrow('14 UNAVAILABLE');
  });

  // A job BullMQ will not replay any more is logged as an error,
  // whether its attempts are spent or it stalled past maxStalledCount (then
  // attemptsMade may still be below attempts; the job sits in "failed").
  describe('its last failure', () => {
    const failingJob = (attemptsMade: number, state: string) =>
      ({
        ...job(attemptsMade),
        getState: jest.fn().mockResolvedValue(state),
      }) as any;

    it('is an error once the attempts are spent', async () => {
      const error = jest
        .spyOn((processor as any).logger, 'error')
        .mockImplementation(() => undefined);

      await processor.onFailed(failingJob(7, 'failed'), new Error('down'));

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Giving up: the end of this scan is not dispatched',
        ),
      );
    });

    it('is an error when the job stalled past its limit, attempts left', async () => {
      const error = jest
        .spyOn((processor as any).logger, 'error')
        .mockImplementation(() => undefined);

      await processor.onFailed(
        failingJob(1, 'failed'),
        new Error('job stalled more than allowable limit'),
      );

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Giving up: the end of this scan is not dispatched',
        ),
      );
    });

    it('is a warning while BullMQ will replay the job', async () => {
      const error = jest
        .spyOn((processor as any).logger, 'error')
        .mockImplementation(() => undefined);
      const warn = jest
        .spyOn((processor as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await processor.onFailed(failingJob(1, 'delayed'), new Error('down'));

      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
