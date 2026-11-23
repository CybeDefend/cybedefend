import { Test } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { NEVER, of } from 'rxjs';

import {
  FILE_DELETE_TIMEOUT_MS,
  FileManagementService,
} from './file-management.service';

/**
 * `deleteFile` is awaited by terminal state moves and by the results
 * finalization sweeper: a file-management that never answers must not hold
 * them for good.
 */
describe('FileManagementService.deleteFile deadline', () => {
  const build = async (deleteFile: jest.Mock) => {
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ deleteFile }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FileManagementService,
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();
    const service = module.get(FileManagementService);
    service.onModuleInit();
    return service;
  };

  afterEach(() => jest.useRealTimers());

  it('rejects with DEADLINE_EXCEEDED when file-management never answers', async () => {
    jest.useFakeTimers();
    const service = await build(jest.fn().mockReturnValue(NEVER));
    const outcome = service.deleteFile('scan-1').then(
      () => 'resolved',
      (error) => error,
    );
    await jest.advanceTimersByTimeAsync(FILE_DELETE_TIMEOUT_MS + 1);
    const error = await outcome;
    expect(error).not.toBe('resolved');
    expect(error?.code ?? error?.error?.code).toBe(status.DEADLINE_EXCEEDED);
  });

  it('still resolves with the answer when file-management is prompt', async () => {
    const service = await build(
      jest.fn().mockReturnValue(of({ success: true })),
    );
    await expect(service.deleteFile('scan-1')).resolves.toEqual({
      success: true,
    });
  });
});
