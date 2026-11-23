import {
  AuthorizeScanUploadRequest,
  AuthorizeScanUploadResponse,
  SubmitScanResultsRequest,
  SubmitScanResultsResponse,
} from '@grpc/security-scanning/scan';
import {
  CLUSTER_SCAN_SERVICE_NAME,
  ClusterScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { withGrpcDeadline } from '@grpc/wrapper-grpc';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

/** AuthorizeScanUpload reads one token row and its container. */
export const SCAN_RUN_AUTHORIZE_DEADLINE_MS = 5_000;
/**
 * SubmitScanResults claims the token, then calls analysis-reporting's
 * ImportResults, which security-scanning bounds at 15 s: give it that and
 * a margin, or the gateway would give up on a submit that went through.
 */
export const SCAN_RUN_SUBMIT_DEADLINE_MS = 20_000;

/**
 * security-scanning's `ClusterScanService`, as the scanner results route
 * calls it. A failure rejects with the grpc-js ServiceError as is (`code`,
 * `details`): the caller maps it (`clusterScanRefusal`) and logs its status
 * name only. The token never reaches this client: only its SHA-256 hex.
 */
@Injectable()
export class ScanRunClient implements OnModuleInit {
  private clusterScan!: ClusterScanServiceClient;

  constructor(
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.clusterScan = wrapGrpcClientWithTracing(
      this.securityScanningClient.getService<ClusterScanServiceClient>(
        CLUSTER_SCAN_SERVICE_NAME,
      ),
    );
  }

  authorizeScanUpload(
    request: AuthorizeScanUploadRequest,
  ): Promise<AuthorizeScanUploadResponse> {
    return lastValueFrom(
      withGrpcDeadline(
        this.clusterScan.authorizeScanUpload(request),
        SCAN_RUN_AUTHORIZE_DEADLINE_MS,
      ),
    );
  }

  submitScanResults(
    request: SubmitScanResultsRequest,
  ): Promise<SubmitScanResultsResponse> {
    return lastValueFrom(
      withGrpcDeadline(
        this.clusterScan.submitScanResults(request),
        SCAN_RUN_SUBMIT_DEADLINE_MS,
      ),
    );
  }
}
