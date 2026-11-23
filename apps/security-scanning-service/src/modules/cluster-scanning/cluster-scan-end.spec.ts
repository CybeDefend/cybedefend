import { Logger } from '@nestjs/common';
import type { Scan } from 'src/entities/scan.entity';
import type { FileManagementService } from '../file/file-management.service';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import type { ScanStateStore } from '../scan/core/scanStateStore';
import { ClusterScanEnd } from './cluster-scan-end';

/**
 * A refused launch ends its scan (handleCompletedScan); a
 * watchdog deadline only deletes the archive, as the cloud's
 * checkExpiredScan: no notifyScanEnded nor policy evaluation for a scan that
 * ran no scanner.
 */
function harness(moved = true) {
  const store = { moveScanState: jest.fn(async () => moved) };
  const stateManager = {
    publishStatusChanged: jest.fn(),
    handleCompletedScan: jest.fn(async () => undefined),
  };
  const files = { deleteFile: jest.fn(async () => ({ success: true })) };
  const end = new ClusterScanEnd(
    store as unknown as ScanStateStore,
    stateManager as unknown as ScanStateManager,
    files as unknown as FileManagementService,
  );
  return { end, store, stateManager, files };
}

const scan = () => ({ id: 's1', state: 'running' }) as Scan;

describe('ClusterScanEnd', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a refused launch: move, publish, then the scan end (handleCompletedScan)', async () => {
    const h = harness();
    await expect(h.end.fail(scan(), 'running', 83)).resolves.toBe(true);
    expect(h.store.moveScanState).toHaveBeenCalledWith(
      expect.anything(),
      ['running'],
      'failed',
      expect.objectContaining({ errorCode: 83, errorCategory: 'cluster' }),
    );
    expect(h.stateManager.publishStatusChanged).toHaveBeenCalled();
    expect(h.stateManager.handleCompletedScan).toHaveBeenCalledTimes(1);
    expect(h.files.deleteFile).not.toHaveBeenCalled();
  });

  it('a deadline: move, publish, archive delete, and no scan end', async () => {
    const h = harness();
    await h.end.fail(scan(), 'queued', 65, { endOfScan: false });
    expect(h.stateManager.publishStatusChanged).toHaveBeenCalled();
    expect(h.files.deleteFile).toHaveBeenCalledWith('s1');
    expect(h.stateManager.handleCompletedScan).not.toHaveBeenCalled();
  });

  it('a lost move does nothing else', async () => {
    const h = harness(false);
    await expect(
      h.end.fail(scan(), 'queued', 65, { endOfScan: false }),
    ).resolves.toBe(false);
    expect(h.stateManager.publishStatusChanged).not.toHaveBeenCalled();
    expect(h.files.deleteFile).not.toHaveBeenCalled();
  });

  it('an archive that cannot be deleted never fails the deadline', async () => {
    const h = harness();
    h.files.deleteFile.mockRejectedValueOnce(new Error('gone'));
    await expect(
      h.end.fail(scan(), 'waiting_for_file', undefined, { endOfScan: false }),
    ).resolves.toBe(true);
  });
});
