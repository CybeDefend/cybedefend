import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';

import { FileManagementService } from './file-management.service';

/**
 * `deleteImportObject` deletes the SARIF import
 * object `import/<projectId>/<scanId>.sarif` through file-management
 * `DeleteImportObject`. Best effort: it never rejects, so a terminal state
 * move is never undone by a storage hiccup, and it logs the gRPC code name
 * only.
 */
describe('FileManagementService.deleteImportObject', () => {
  const build = async (
    deleteImportObject: jest.Mock,
    warn: jest.Mock,
  ): Promise<TestingModule> => {
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ deleteImportObject }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FileManagementService,
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn,
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();
    const service = module.get(FileManagementService);
    service.onModuleInit();
    return module;
  };

  it('deletes an import object and resolves', async () => {
    const deleteImportObject = jest.fn().mockReturnValue(of({ success: true }));
    const warn = jest.fn();
    const module = await build(deleteImportObject, warn);
    const service = module.get(FileManagementService);

    await expect(
      service.deleteImportObject('p1', 'import/p1/s1.sarif'),
    ).resolves.toBeUndefined();

    expect(deleteImportObject).toHaveBeenCalledWith({
      projectId: 'p1',
      objectKey: 'import/p1/s1.sarif',
    });
    expect(warn).not.toHaveBeenCalled();
    await module.close();
  });

  it('never rejects: a failed call logs one WARN with the gRPC code name only', async () => {
    const deleteImportObject = jest
      .fn()
      .mockReturnValue(throwError(() => ({ code: status.UNAVAILABLE })));
    const warn = jest.fn();
    const module = await build(deleteImportObject, warn);
    const service = module.get(FileManagementService);

    await expect(
      service.deleteImportObject('p1', 'import/p1/s1.sarif'),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('IMPORT_OBJECT_DELETE_FAILED');
    expect(warn.mock.calls[0][0]).toContain('code=UNAVAILABLE');
    await module.close();
  });
});

/**
 * A Community cluster pod fetches the archive from
 * outside the instance, so its URL is signed for S3_PUBLIC_ENDPOINT
 * (`audience: 'external'`).
 */
describe('FileManagementService.getExternalDownloadUrl', () => {
  const build = async (
    getDownloadUrl: jest.Mock,
    error: jest.Mock,
  ): Promise<FileManagementService> => {
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ getDownloadUrl }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FileManagementService,
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error,
            debug: jest.fn(),
          },
        },
      ],
    }).compile();
    const service = module.get(FileManagementService);
    service.onModuleInit();
    return service;
  };

  it('asks GetDownloadUrl with audience external and returns its url', async () => {
    const getDownloadUrl = jest
      .fn()
      .mockReturnValue(of({ url: 'https://storage.example.com/s1?sig=x' }));
    const service = await build(getDownloadUrl, jest.fn());
    await expect(service.getExternalDownloadUrl('s1')).resolves.toBe(
      'https://storage.example.com/s1?sig=x',
    );
    expect(getDownloadUrl).toHaveBeenCalledWith({
      scanId: 's1',
      audience: 'external',
    });
  });

  it('keeps the internal URL request unchanged (no audience)', async () => {
    const getDownloadUrl = jest.fn().mockReturnValue(of({ url: 'u' }));
    const service = await build(getDownloadUrl, jest.fn());
    await service.getDownloadUrl('s1');
    expect(getDownloadUrl).toHaveBeenCalledWith({ scanId: 's1' });
  });

  it('a failure rejects INTERNAL and logs the gRPC code name only', async () => {
    const getDownloadUrl = jest.fn().mockReturnValue(
      throwError(() => ({
        code: status.UNAVAILABLE,
        details: 'https://leak.example.com/?sig=secret',
      })),
    );
    const error = jest.fn();
    const service = await build(getDownloadUrl, error);
    await expect(service.getExternalDownloadUrl('s1')).rejects.toMatchObject({
      error: { code: status.INTERNAL },
    });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('UNAVAILABLE');
    expect(logged).not.toContain('sig=');
  });
});
