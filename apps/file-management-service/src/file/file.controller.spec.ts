import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';

import { FileController } from './file.controller';
import { FileService } from './file.service';
import { createLoggerMock } from 'src/test-utils/mocks';

describe('FileController', () => {
  let controller: FileController;
  let fileService: {
    deleteFile: jest.Mock;
    getDownloadUrl: jest.Mock;
    uploadFile: jest.Mock;
  };
  let logger: ReturnType<typeof createLoggerMock>;

  beforeEach(async () => {
    fileService = {
      deleteFile: jest.fn(),
      getDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileController,
        { provide: FileService, useValue: fileService },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    controller = module.get(FileController);
  });

  describe('uploadFile (artifact validation)', () => {
    it('keeps INVALID_ARGUMENT for an unknown artifact kind', async () => {
      fileService.uploadFile.mockRejectedValue(
        new RpcException({ code: status.INVALID_ARGUMENT, message: 'bad' }),
      );
      await expect(
        controller.uploadFile({ artifact: 'bogus' } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });

  describe('deleteFile (idempotency)', () => {
    it('returns success when the file is already gone (NOT_FOUND from service)', async () => {
      // The service throws NOT_FOUND once the FileScan record has already been removed.
      fileService.deleteFile.mockRejectedValue(
        new RpcException({ code: status.NOT_FOUND, message: 'File not found' }),
      );

      const res = await controller.deleteFile({ scanId: 'scan-1' } as any);

      expect(res.success).toBe(true);
      // A benign, high-frequency "already deleted" belongs at debug — it must
      // not pollute prod logs at warn/error level on every cron tick.
      expect(logger.debug).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('treats a raw NOT_FOUND status code as already-deleted even without a "not found" message', async () => {
      fileService.deleteFile.mockRejectedValue({
        code: status.NOT_FOUND,
        message: 'gone',
      });

      const res = await controller.deleteFile({ scanId: 'scan-2' } as any);

      expect(res.success).toBe(true);
    });

    it('still throws for genuine deletion errors', async () => {
      fileService.deleteFile.mockRejectedValue(
        new RpcException({ code: status.INTERNAL, message: 'GCS exploded' }),
      );

      await expect(
        controller.deleteFile({ scanId: 'scan-3' } as any),
      ).rejects.toBeInstanceOf(RpcException);
      expect(logger.error).toHaveBeenCalled();
    });

    it('passes through the successful response from the service', async () => {
      fileService.deleteFile.mockResolvedValue({
        success: true,
        message: 'Deleted from GCS',
      });

      const res = await controller.deleteFile({ scanId: 'scan-4' } as any);

      expect(res).toEqual({ success: true, message: 'Deleted from GCS' });
    });
  });

  describe('getDownloadUrl (gRPC status propagation)', () => {
    const rejectionOf = async (
      promise: Promise<unknown>,
    ): Promise<RpcException> => {
      try {
        await promise;
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        return e as RpcException;
      }
      throw new Error('expected getDownloadUrl to reject');
    };

    it('keeps NOT_FOUND when the scan archive record is gone, and logs it at warn', async () => {
      // A stale ingestion parse task (redelivered after the scan
      // finished and its archive was deleted) asks for the URL. Wrapping the
      // service's NOT_FOUND made it reach ingestion as UNKNOWN (2).
      fileService.getDownloadUrl.mockRejectedValue(
        new RpcException({
          code: status.NOT_FOUND,
          message: 'File not found in DB',
        }),
      );

      const err = await rejectionOf(
        controller.getDownloadUrl({ scanId: 'scan-gone' }),
      );

      expect(err.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'File not found in DB',
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('scan-gone'),
      );
    });

    it('keeps the status of any other typed RpcException raised by the service', async () => {
      fileService.getDownloadUrl.mockRejectedValue(
        new RpcException({
          code: status.INTERNAL,
          message: 'Error checking S3 object',
        }),
      );

      const err = await rejectionOf(
        controller.getDownloadUrl({ scanId: 'scan-s3' }),
      );

      expect(err.getError()).toEqual({
        code: status.INTERNAL,
        message: 'Error checking S3 object',
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('still wraps an unexpected error as before', async () => {
      fileService.getDownloadUrl.mockRejectedValue(
        new Error('signBlob permission denied'),
      );

      const err = await rejectionOf(
        controller.getDownloadUrl({ scanId: 'scan-boom' }),
      );

      expect(err.getError()).toBe('Error while getting download URL');
      expect(logger.error).toHaveBeenCalled();
    });

    it('passes through the signed URL from the service', async () => {
      fileService.getDownloadUrl.mockResolvedValue({ url: 'https://signed' });

      await expect(
        controller.getDownloadUrl({ scanId: 'scan-ok' }),
      ).resolves.toEqual({ url: 'https://signed' });
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('forwards the audience to the service unchanged', async () => {
      fileService.getDownloadUrl.mockResolvedValue({ url: 'https://signed' });

      await controller.getDownloadUrl({
        scanId: 'scan-ok',
        audience: 'external',
      });

      expect(fileService.getDownloadUrl).toHaveBeenCalledWith({
        scanId: 'scan-ok',
        audience: 'external',
      });
    });
  });
});
