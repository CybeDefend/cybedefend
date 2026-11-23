import { ScanModule } from '../scan.module';
import { ScanResultsController } from './scan-results.controller';
import type { ScanResultsService } from './scan-results.service';

/**
 * The two upload RPCs of ClusterScanService. They are served by the
 * Community-only ClusterScanningModule, never by ScanModule (which both
 * editions load): the closed edition answers UNIMPLEMENTED.
 */
describe('ScanResultsController', () => {
  const patternOf = (method: string): string =>
    JSON.stringify(
      Reflect.getMetadata(
        'microservices:pattern',
        Object.getOwnPropertyDescriptor(ScanResultsController.prototype, method)
          ?.value as object,
      ),
    );

  it('serves ClusterScanService.authorizeScanUpload and submitScanResults', () => {
    expect(patternOf('authorizeScanUpload')).toContain('ClusterScanService');
    expect(patternOf('authorizeScanUpload')).toContain('authorizeScanUpload');
    expect(patternOf('submitScanResults')).toContain('ClusterScanService');
    expect(patternOf('submitScanResults')).toContain('submitScanResults');
  });

  it('delegates to ScanResultsService', async () => {
    const results = {
      authorize: jest.fn(async () => ({ containerId: 'c' })),
      submit: jest.fn(async () => ({ accepted: true })),
    };
    const controller = new ScanResultsController(
      results as unknown as ScanResultsService,
    );
    const a = { scanId: 's', tokenHash: 'h', protocolVersion: 1 };
    const s = { scanId: 's', tokenHash: 'h', objectKey: 'k' };
    await expect(controller.authorizeScanUpload(a)).resolves.toEqual({
      containerId: 'c',
    });
    await expect(controller.submitScanResults(s)).resolves.toEqual({
      accepted: true,
    });
    expect(results.authorize).toHaveBeenCalledWith(a);
    expect(results.submit).toHaveBeenCalledWith(s);
  });

  it('ScanModule, loaded by both editions, serves no ClusterScanService controller', () => {
    const controllers = (Reflect.getMetadata('controllers', ScanModule) ??
      []) as Array<{ name: string }>;
    expect(controllers.map((c) => c.name)).toEqual(['ScanController']);
  });
});
