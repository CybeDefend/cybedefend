import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type { GetScanCapabilitiesResponse } from '@grpc/security-scanning/scan';
import { ClusterScanningState } from './cluster-scanning.state';

/**
 * `ClusterScanService.GetScanCapabilities`: whether
 * this instance runs scans on its connected cluster now. An unconfigured
 * instance, or one whose cluster refuses access, answers clusterScans:
 * false, never an error. Served only by the Community-only
 * ClusterScanningModule: the cloud serves no ClusterScanService.
 */
@Controller()
export class ScanCapabilitiesController {
  constructor(private readonly state: ClusterScanningState) {}

  @GrpcMethod('ClusterScanService', 'getScanCapabilities')
  getScanCapabilities(): GetScanCapabilitiesResponse {
    return { clusterScans: this.state.enabled };
  }
}
