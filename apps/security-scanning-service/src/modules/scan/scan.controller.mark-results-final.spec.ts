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
 * MarkScanResultsFinal: analysis-reporting tells security-scanning that the
 * results of a scan are final. Service-to-service only: no scanner token.
 */
describe('ScanController.markScanResultsFinal', () => {
  let module: TestingModule;
  let controller: ScanController;
  const scanService = { markScanResultsFinal: jest.fn() };
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
        { provide: ScanService, useValue: scanService },
        { provide: ImportScanService, useValue: {} },
        { provide: FileManagementService, useValue: {} },
        { provide: GitHistoryCursorService, useValue: {} },
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
        .markScanResultsFinal(request as never)
        .catch((e) => e);

      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual(
        expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      );
      expect(scanService.markScanResultsFinal).not.toHaveBeenCalled();
    },
  );

  it.each([
    'finalized',
    'already_final',
    'containers_open',
    'not_running',
    'not_found',
  ])('answers success with the outcome %s', async (outcome) => {
    scanService.markScanResultsFinal.mockResolvedValue(outcome);

    await expect(
      controller.markScanResultsFinal({ scanId: 's1' }),
    ).resolves.toEqual({ success: true, outcome });
    expect(scanService.markScanResultsFinal).toHaveBeenCalledWith('s1');
  });

  it('is not behind the scanner guard: only services call it', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ScanController.prototype.markScanResultsFinal,
      ),
    ).toBeUndefined();
  });
});
