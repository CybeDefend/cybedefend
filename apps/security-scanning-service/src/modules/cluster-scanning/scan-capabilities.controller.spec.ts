import { Test } from '@nestjs/testing';
import { ScanCapabilitiesController } from './scan-capabilities.controller';
import { ClusterScanningState } from './cluster-scanning.state';
import { CLUSTER_SCANNING_CONFIG } from './cluster-scanning.config';
import { COMMUNITY_KUBE_CLIENT } from './kube-client';

/**
 * GetScanCapabilities answers what the engine can do
 * now. An unconfigured instance answers clusterScans: false, never an error.
 * The cloud serves no ClusterScanService (the controller lives in a
 * Community-only module).
 */
describe('ScanCapabilitiesController', () => {
  it('answers { clusterScans: false } with no config', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ScanCapabilitiesController],
      providers: [
        ClusterScanningState,
        { provide: CLUSTER_SCANNING_CONFIG, useValue: null },
        { provide: COMMUNITY_KUBE_CLIENT, useValue: null },
      ],
    }).compile();
    await moduleRef.init();
    const controller = moduleRef.get(ScanCapabilitiesController);
    expect(controller.getScanCapabilities()).toEqual({ clusterScans: false });
    await moduleRef.close();
  });

  it('reads the state at each call', () => {
    const state = { enabled: false } as ClusterScanningState;
    const controller = new ScanCapabilitiesController(state);
    expect(controller.getScanCapabilities()).toEqual({ clusterScans: false });
    (state as { enabled: boolean }).enabled = true;
    expect(controller.getScanCapabilities()).toEqual({ clusterScans: true });
  });

  it('serves ClusterScanService.getScanCapabilities', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      ScanCapabilitiesController.prototype,
      'getScanCapabilities',
    );
    const pattern = Reflect.getMetadata(
      'microservices:pattern',
      descriptor?.value as object,
    ) as unknown[];
    expect(JSON.stringify(pattern)).toContain('ClusterScanService');
    expect(JSON.stringify(pattern)).toContain('getScanCapabilities');
  });
});
