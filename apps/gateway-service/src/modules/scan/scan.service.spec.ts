import { Test, TestingModule } from '@nestjs/testing';
import { ScanService } from './scan.service';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import {
  CheckExistingScanRequest,
  CheckExistingScanResponse,
  CreateScanRequest,
  CreateScanResponse,
  GetScanRequest,
  ScanResponse,
  StartScanRequest,
} from '@grpc/security-scanning/scan';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import {
  UploadFileRequest,
  UploadFileResponse,
} from '@grpc/file-management/file';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';

describe('ScanService', () => {
  let service: ScanService;
  let scanGrpcClient: jest.Mocked<ClientGrpc>;
  let fileGrpcClient: jest.Mocked<ClientGrpc>;
  let scanStub: jest.Mocked<ScanServiceClient>;
  let fileStub: jest.Mocked<FileServiceClient>;

  beforeEach(async () => {
    scanStub = {
      getScan: jest.fn(),
      createScan: jest.fn(),
      checkExistingScan: jest.fn(),
      startScan: jest.fn(),
    } as any;

    fileStub = {
      uploadFile: jest.fn(),
    } as any;

    scanGrpcClient = { getService: jest.fn().mockReturnValue(scanStub) } as any;
    fileGrpcClient = { getService: jest.fn().mockReturnValue(fileStub) } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanService,
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: scanGrpcClient },
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fileGrpcClient },
      ],
    }).compile();

    service = module.get<ScanService>(ScanService);
    service.onModuleInit();
  });

  it('should init gRPC clients', () => {
    expect(scanGrpcClient.getService).toHaveBeenCalledWith(SCAN_SERVICE_NAME);
    expect(fileGrpcClient.getService).toHaveBeenCalledWith(FILE_SERVICE_NAME);
  });

  it(
    'getScan returns data',
    async () => {
      const req: GetScanRequest = { scanId: 'scan1' } as any;
      const res: ScanResponse = { id: 'scan1' } as any;
      scanStub.getScan.mockReturnValue(of(res) as any);
      await expect(service.getScan(req)).resolves.toEqual(res);
      expect(scanStub.getScan).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it('getScan propagates error', async () => {
    scanStub.getScan.mockReturnValue(
      throwError(() => new Error('boom')) as any,
    );
    await expect(service.getScan({ scanId: 'x' } as any)).rejects.toThrow(
      'boom',
    );
  });

  it('createScan returns response', async () => {
    const req: CreateScanRequest = { scanId: 's1', projectId: 'p1' } as any;
    const res: CreateScanResponse = { message: 'created' } as any;
    scanStub.createScan.mockReturnValue(of(res) as any);
    await expect(service.createScan(req)).resolves.toEqual(res);
  });

  it('createScan propagates error', async () => {
    scanStub.createScan.mockReturnValue(
      throwError(() => new Error('nope')) as any,
    );
    await expect(service.createScan({} as any)).rejects.toThrow('nope');
  });

  it(
    'processUploadFile returns UploadFileResponse',
    async () => {
      const req: UploadFileRequest = { scanId: 's1', projectId: 'p1' } as any;
      const res: UploadFileResponse = { url: 'https://upload' } as any;
      fileStub.uploadFile.mockReturnValue(of(res) as any);
      await expect(service.processUploadFile(req)).resolves.toEqual(res);
      expect(fileStub.uploadFile).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it('processUploadFile propagates error', async () => {
    fileStub.uploadFile.mockReturnValue(
      throwError(() => new Error('upload-fail')) as any,
    );
    await expect(service.processUploadFile({} as any)).rejects.toThrow(
      'upload-fail',
    );
  });

  it('checkExistingScan returns response', async () => {
    const req: CheckExistingScanRequest = { projectId: 'p1' } as any;
    const res: CheckExistingScanResponse = { exists: false } as any;
    scanStub.checkExistingScan.mockReturnValue(of(res) as any);
    await expect(service.checkExistingScan(req)).resolves.toEqual(res);
  });

  it('checkExistingScan propagates error', async () => {
    scanStub.checkExistingScan.mockReturnValue(
      throwError(() => new Error('exists-fail')) as any,
    );
    await expect(service.checkExistingScan({} as any)).rejects.toThrow(
      'exists-fail',
    );
  });

  it('startScan returns response', async () => {
    const req: StartScanRequest = { scanId: 's1', projectId: 'p1' } as any;
    const res = {
      success: true,
      message: 'started',
      detectedLanguages: ['ts'],
    } as any;
    scanStub.startScan.mockReturnValue(of(res) as any);
    await expect(service.startScan(req)).resolves.toEqual(res);
  });

  it('startScan propagates error', async () => {
    scanStub.startScan.mockReturnValue(
      throwError(() => new Error('start-fail')) as any,
    );
    await expect(service.startScan({} as any)).rejects.toThrow('start-fail');
  });
});
