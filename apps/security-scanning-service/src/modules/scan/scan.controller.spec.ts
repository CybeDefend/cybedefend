import { Test, TestingModule } from '@nestjs/testing';
import { GitHistoryCursorService } from './git-history/git-history-cursor.service';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ImportScanService } from './import/import-scan.service';
import { FileManagementService } from '../file/file-management.service';
import { HandledScanStartError } from './core/handled-scan-start-error';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status } from '@grpc/grpc-js';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SCANNER_CALL_BINDING } from '../../edition/ports/scanner-call-binding.port';
import { ScannerCallGuard } from '../../core/scanner-auth/scanner-call.guard';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
} from '../../core/scanner-auth/scanner-auth.contract';
import { CompleteImportScanRequest } from '@grpc/security-scanning/scan';

describe('ScanController', () => {
  let module: TestingModule;
  let controller: ScanController;

  const mockScanService = {
    checkExistingScan: jest.fn(),
    getScan: jest.fn(),
    startScan: jest.fn(),
    updateScan: jest.fn(),
    updateScanData: jest.fn(),
  };

  const mockImportScanService = {
    complete: jest.fn(),
  };

  const mockFileManagementService = {
    // Add mock methods as needed
  };

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        {
          provide: ScanService,
          useValue: mockScanService,
        },
        {
          provide: ImportScanService,
          useValue: mockImportScanService,
        },
        {
          provide: FileManagementService,
          useValue: mockFileManagementService,
        },
        { provide: GitHistoryCursorService, useValue: {} },
        {
          provide: Logger,
          useValue: mockLogger,
        },
        {
          provide: SCANNER_CALL_BINDING,
          useValue: { bind: jest.fn().mockResolvedValue('ok') },
        },
      ],
    }).compile();

    controller = module.get<ScanController>(ScanController);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('scanner calls', () => {
    const scannerMetadata = () => {
      const metadata = new Metadata();
      metadata.set(SCANNER_AUTH_HEADER, 'ok');
      metadata.set(SCANNER_POD_HEADER, 'scan-pod-sast-token');
      metadata.set(SCANNER_POD_UID_HEADER, 'uid-1');
      metadata.set(SCANNER_NAMESPACE_HEADER, 'scanners-namespace');
      metadata.set(SCANNER_SCAN_ID_HEADER, 'scan-1');
      metadata.set(SCANNER_PROJECT_ID_HEADER, 'project-token');
      return metadata;
    };

    it.each(['getScan', 'updateScan', 'updateScanData'])(
      '%s is guarded by ScannerCallGuard',
      (handler) => {
        const guards = Reflect.getMetadata(
          GUARDS_METADATA,
          ScanController.prototype[handler as keyof ScanController],
        );
        expect(guards).toContain(ScannerCallGuard);
      },
    );

    it("a scanner UpdateScan uses the token's pod, never request.podName", async () => {
      mockScanService.updateScan.mockResolvedValueOnce({ success: true });

      await controller.updateScan(
        { scanId: 'scan-1', podName: 'scan-pod-other', state: 'running' },
        scannerMetadata(),
      );
      await controller.updateScan(
        { scanId: 'scan-1', state: 'completed' },
        scannerMetadata(),
      );

      expect(mockScanService.updateScan.mock.calls.map((c) => c[0])).toEqual([
        { scanId: 'scan-1', podName: 'scan-pod-sast-token', state: 'running' },
        {
          scanId: 'scan-1',
          podName: 'scan-pod-sast-token',
          state: 'completed',
        },
      ]);
    });

    it('a service UpdateScan keeps its request podName', async () => {
      await controller.updateScan(
        { scanId: 'scan-1', podName: 'scan-pod-x' },
        new Metadata(),
      );
      expect(mockScanService.updateScan).toHaveBeenLastCalledWith({
        scanId: 'scan-1',
        podName: 'scan-pod-x',
      });
    });

    it("a scanner GetScan is scoped by the token's project", async () => {
      await controller.getScan({ scanId: 'scan-1' }, scannerMetadata());
      expect(mockScanService.getScan).toHaveBeenLastCalledWith({
        scanId: 'scan-1',
        projectId: 'project-token',
      });
    });

    it('a service GetScan keeps its request as sent', async () => {
      await controller.getScan({ scanId: 'scan-1' });
      expect(mockScanService.getScan).toHaveBeenLastCalledWith({
        scanId: 'scan-1',
      });
    });
  });

  it('propagates an expected scan conflict without logging it as an error', async () => {
    const conflict = new RpcException({
      code: status.ALREADY_EXISTS,
      message: 'A scan is already in progress',
    });
    mockScanService.checkExistingScan.mockRejectedValueOnce(conflict);

    await expect(
      controller.checkExistingScan({ projectId: 'project-1', branch: 'main' }),
    ).rejects.toBe(conflict);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('forwards the scan kind and the image so a container scan is checked against its own pool', async () => {
    mockScanService.checkExistingScan.mockResolvedValueOnce({
      exists: true,
      message: 'ok',
    });

    await controller.checkExistingScan({
      projectId: 'project-1',
      scanType: 'container',
      imageToScan: 'registry.example/app:1',
    });

    expect(mockScanService.checkExistingScan).toHaveBeenCalledWith(
      'project-1',
      undefined,
      { scanType: 'container', imageToScan: 'registry.example/app:1' },
    );
  });

  it('propagates an expected getScan error without logging it twice', async () => {
    const notFound = new RpcException({
      code: status.NOT_FOUND,
      message: 'Scan not found',
    });
    mockScanService.getScan.mockRejectedValueOnce(notFound);

    await expect(controller.getScan({ scanId: 'scan-1' })).rejects.toBe(
      notFound,
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('marks a failed start while preserving the expected error without an error log', async () => {
    const conflict = new RpcException({
      code: status.ALREADY_EXISTS,
      message: 'Scan already started',
    });
    mockScanService.startScan.mockRejectedValueOnce(conflict);
    mockScanService.updateScanData.mockResolvedValueOnce({ success: true });

    await expect(
      controller.startScan({ scanId: 'scan-1' } as any),
    ).rejects.toBe(conflict);
    expect(mockScanService.updateScanData).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: 'scan-1', state: 'failed' }),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('never records a failure over an import the service already settled', async () => {
    // ImportScanService already moved the scan to its terminal
    // state (or refused it); updateScanData would overwrite IMPORT_* with
    // raw text and fail a running import on a retried StartScan.
    const handled = new HandledScanStartError({
      code: status.UNAVAILABLE,
      message: 'IMPORT_UNAVAILABLE',
    });
    mockScanService.startScan.mockRejectedValueOnce(handled);
    mockScanService.updateScanData.mockClear();

    await expect(
      controller.startScan({ scanId: 'scan-1' } as any),
    ).rejects.toBe(handled);
    expect(mockScanService.updateScanData).not.toHaveBeenCalled();
  });

  it('delegates CompleteImportScan and refuses one without scanId', async () => {
    // The controller validates
    // scanId, then hands the request to ImportScanService.complete.
    const request: CompleteImportScanRequest = {
      scanId: 'scan-1',
      status: 'completed',
      errorCode: '',
      findingsCount: 3,
      toolName: 'semgrep',
    };
    mockImportScanService.complete.mockResolvedValueOnce({
      success: true,
      message: 'Import scan completed',
    });

    await expect(controller.completeImportScan(request)).resolves.toEqual({
      success: true,
      message: 'Import scan completed',
    });
    expect(mockImportScanService.complete).toHaveBeenCalledWith(request);

    const error = await controller
      .completeImportScan({ ...request, scanId: '' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    expect(mockImportScanService.complete).toHaveBeenCalledTimes(1);
  });
});
