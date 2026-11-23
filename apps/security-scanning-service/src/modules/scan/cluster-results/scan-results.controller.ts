import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  AuthorizeScanUploadRequest,
  AuthorizeScanUploadResponse,
  SubmitScanResultsRequest,
  SubmitScanResultsResponse,
} from '@grpc/security-scanning/scan';
import { ScanResultsService } from './scan-results.service';

/**
 * `ClusterScanService.AuthorizeScanUpload` and `SubmitScanResults`, called
 * by the gateway's `POST /scan-runs/:scanId/results`. Registered only by the
 * Community-only ClusterScanningModule: the closed edition serves no ClusterScanService (UNIMPLEMENTED).
 */
@Controller()
export class ScanResultsController {
  constructor(private readonly results: ScanResultsService) {}

  @GrpcMethod('ClusterScanService', 'authorizeScanUpload')
  authorizeScanUpload(
    request: AuthorizeScanUploadRequest,
  ): Promise<AuthorizeScanUploadResponse> {
    return this.results.authorize(request);
  }

  @GrpcMethod('ClusterScanService', 'submitScanResults')
  submitScanResults(
    request: SubmitScanResultsRequest,
  ): Promise<SubmitScanResultsResponse> {
    return this.results.submit(request);
  }
}
