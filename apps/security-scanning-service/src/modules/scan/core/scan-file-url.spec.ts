import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

import { getScanHistoryFileUrl } from './scan-file-url';

describe('getScanHistoryFileUrl', () => {
  const logger = { warn: jest.fn(), error: jest.fn() } as any;
  const filesWith = (getDownloadUrl: jest.Mock) => ({ getDownloadUrl }) as any;

  beforeEach(() => jest.clearAllMocks());

  const historyUrl =
    'https://storage.example/bucket/scan/p1/s1.history.tar?X-Goog-Signature=abc';

  it('asks for the history artifact and returns its URL', async () => {
    const get = jest.fn().mockResolvedValue(historyUrl);
    await expect(
      getScanHistoryFileUrl(filesWith(get), logger, 's1'),
    ).resolves.toBe(historyUrl);
    expect(get).toHaveBeenCalledWith('s1', 'history');
  });

  it.each([
    'https://storage.example/bucket/scan/p1/s1.zip?X-Goog-Signature=abc',
    'https://storage.example/bucket/scan/p1/s1?sig=.history.tar',
    'not a url',
  ])(
    'returns null for a URL that is not a history tar (%s): an older file-management signed the archive',
    async (url) => {
      const get = jest.fn().mockResolvedValue(url);
      await expect(
        getScanHistoryFileUrl(filesWith(get), logger, 's1'),
      ).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      // The signed URL is a credential: never logged.
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('Signature');
    },
  );

  it('getScanHistoryFileUrl returns null when the scan has no history', async () => {
    const get = jest
      .fn()
      .mockRejectedValue(
        new RpcException({ code: status.NOT_FOUND, message: 'none' }),
      );
    await expect(
      getScanHistoryFileUrl(filesWith(get), logger, 's1'),
    ).resolves.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('also returns null on any other error, after logging it', async () => {
    const get = jest
      .fn()
      .mockRejectedValue(
        new RpcException({ code: status.INTERNAL, message: 'boom' }),
      );
    await expect(
      getScanHistoryFileUrl(filesWith(get), logger, 's1'),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
