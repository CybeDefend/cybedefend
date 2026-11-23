import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Logger } from 'nestjs-pino';
import { GitHistoryCursorService } from './git-history/git-history-cursor.service';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ImportScanService } from './import/import-scan.service';
import { SCANNER_CALL_BINDING } from '../../edition/ports/scanner-call-binding.port';
import { FileManagementService } from '../file/file-management.service';

/**
 * MarkHistoryIngestionFailed: analysis-reporting could not store every result
 * of a scan's secret scanner, so its history pass must count as failed.
 * Service-to-service only: no scanner token.
 */
describe('ScanController.markHistoryIngestionFailed', () => {
  let module: TestingModule;
  let controller: ScanController;
  const cursors = { markHistoryIngestionFailed: jest.fn() };
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        { provide: ScanService, useValue: {} },
        { provide: ImportScanService, useValue: {} },
        { provide: FileManagementService, useValue: {} },
        { provide: GitHistoryCursorService, useValue: cursors },
        { provide: Logger, useValue: logger },
        {
          provide: SCANNER_CALL_BINDING,
          useValue: { bind: jest.fn().mockResolvedValue('ok') },
        },
      ],
    }).compile();
    controller = module.get(ScanController);
  });

  afterEach(async () => {
    await module.close();
  });

  it.each([undefined, null, {}, { scanId: '' }])(
    'rejects %j with INVALID_ARGUMENT',
    async (request) => {
      const error = await controller
        .markHistoryIngestionFailed(request as never)
        .catch((e) => e);

      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual(
        expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      );
      expect(cursors.markHistoryIngestionFailed).not.toHaveBeenCalled();
    },
  );

  it('records the failure on the scan and answers success, every time', async () => {
    cursors.markHistoryIngestionFailed.mockResolvedValue(true);

    for (let i = 0; i < 2; i += 1) {
      await expect(
        controller.markHistoryIngestionFailed({
          scanId: 's1',
          scannerName: 'gitleaks',
        }),
      ).resolves.toEqual({ success: true });
    }
    expect(cursors.markHistoryIngestionFailed).toHaveBeenCalledWith('s1');
  });

  it('answers NOT_FOUND for an unknown scan', async () => {
    cursors.markHistoryIngestionFailed.mockResolvedValue(false);

    const error = await controller
      .markHistoryIngestionFailed({ scanId: 'nope', scannerName: 'gitleaks' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.NOT_FOUND }),
    );
  });

  it('is not behind the scanner guard: only services call it', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ScanController.prototype.markHistoryIngestionFailed,
      ),
    ).toBeUndefined();
  });
});
