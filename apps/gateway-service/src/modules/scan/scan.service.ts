import {
  DeleteFileResponse,
  UploadFileRequest,
  UploadFileResponse,
} from '@grpc/file-management/file';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import {
  CheckExistingScanRequest,
  CheckExistingScanResponse,
  CreateScanRequest,
  CreateScanResponse,
  GetScanRequest,
  ScanResponse,
  StartScanRequest,
  UpdateScanResponse,
} from '@grpc/security-scanning/scan';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import { StartScanResponseDto } from './dto/response/start-scan-response.dto';

@Injectable()
export class ScanService implements OnModuleInit {
  private scanServiceClient!: ScanServiceClient;
  private fileServiceClient!: FileServiceClient;

  constructor(
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly client: ClientGrpc,
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.scanServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<ScanServiceClient>(SCAN_SERVICE_NAME),
    );
    this.fileServiceClient = wrapGrpcClientWithTracing(
      this.fileClient.getService<FileServiceClient>(FILE_SERVICE_NAME),
    );
  }

  /**
   * Get a scan by ID
   *
   * @param request Scan ID to get
   * @param req Request HTTP
   * @returns Scan response or error
   */
  @Span()
  getScan(request: GetScanRequest): Promise<ScanResponse> {
    return safeGrpcCall(this.scanServiceClient.getScan(request));
  }

  /**
   * Start a scan
   *
   * @param data Data to start a scan
   * @param req Request HTTP
   * @returns Scan response or error
   */
  @Span()
  createScan(data: CreateScanRequest): Promise<CreateScanResponse> {
    return safeGrpcCall(this.scanServiceClient.createScan(data));
  }

  /**
   * Upload a file for scanning
   * @param request File upload request
   * @returns Observable of the upload file request
   */
  @Span()
  processUploadFile(data: UploadFileRequest): Promise<UploadFileResponse> {
    return safeGrpcCall(this.fileServiceClient.uploadFile(data));
  }

  /**
   * Remove the upload registered for a scan that was never created (its
   * pending record and any object already sent), so the upload processor
   * stops waiting for it.
   */
  @Span()
  discardPendingUpload(scanId: string): Promise<DeleteFileResponse> {
    return safeGrpcCall(this.fileServiceClient.deleteFile({ scanId }));
  }

  /**
   * Check if a scan already exists for a project
   *
   * @param request Request containing the project ID
   * @returns Response indicating if a scan exists
   */
  checkExistingScan(
    request: CheckExistingScanRequest,
  ): Promise<CheckExistingScanResponse> {
    return safeGrpcCall(this.scanServiceClient.checkExistingScan(request));
  }

  /**
   * Start a scan
   *
   * @param request Request to start a scan
   * @returns Response indicating the scan has started
   */
  startScan(request: StartScanRequest): Promise<StartScanResponseDto> {
    return safeGrpcCall(this.scanServiceClient.startScan(request));
  }

  /**
   * Cancel a scan in waiting_for_file or queued state
   */
  @Span()
  cancelScan(scanId: string, projectId: string): Promise<UpdateScanResponse> {
    return safeGrpcCall(
      this.scanServiceClient.cancelScan({ scanId, projectId }),
    );
  }
}
