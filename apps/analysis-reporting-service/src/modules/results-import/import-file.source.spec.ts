import { Readable } from 'stream';
import { of, throwError, NEVER } from 'rxjs';
import { ClientGrpc } from '@nestjs/microservices';
import { HttpService } from '@nestjs/axios';
import { ImportFileSource } from './import-file.source';
import { ImportError, SARIF_IMPORT_LIMITS } from './sarif/import-limits';

const PROJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SCAN = '0193b6a8-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
const KEY = `import/${PROJECT}/${SCAN}.sarif`;
const SIGNED = 'https://storage.internal/bucket/import/p/s.sarif?X-Sig=secret';

const readAll = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const codeOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    return (err as ImportError).code;
  }
};

describe('ImportFileSource', () => {
  let getImportDownloadUrl: jest.Mock;
  let getDownloadUrl: jest.Mock;
  let get: jest.Mock;
  let source: ImportFileSource;

  beforeEach(() => {
    getImportDownloadUrl = jest
      .fn()
      .mockReturnValue(of({ url: SIGNED, sizeBytes: '42' }));
    getDownloadUrl = jest.fn();
    get = jest.fn().mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from('{"runs":[]}')]),
    });
    const client = {
      getService: () => ({ getImportDownloadUrl, getDownloadUrl }),
    } as unknown as ClientGrpc;
    const http = { axiosRef: { get } } as unknown as HttpService;
    source = new ImportFileSource(client, http);
    source.onModuleInit();
  });

  it('streams the signed URL of the import object', async () => {
    const open = source.open(PROJECT, KEY);
    const stream = await open();
    expect(await readAll(stream)).toBe('{"runs":[]}');

    expect(getImportDownloadUrl).toHaveBeenCalledWith({
      projectId: PROJECT,
      objectKey: KEY,
    });
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(
      SIGNED,
      expect.objectContaining({
        responseType: 'stream',
        timeout: 60_000,
        maxRedirects: 0,
      }),
    );
  });

  it('asks for a fresh signed URL at each read of the object', async () => {
    const open = source.open(PROJECT, KEY);
    await readAll(await open());
    await readAll(await open());
    expect(getImportDownloadUrl).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('refuses an object larger than 50 MiB with IMPORT_TOO_LARGE before reading it', async () => {
    getImportDownloadUrl.mockReturnValue(
      of({
        url: SIGNED,
        sizeBytes: String(SARIF_IMPORT_LIMITS.maxUploadedBytes + 1),
      }),
    );
    expect(await codeOf(source.open(PROJECT, KEY)())).toBe('IMPORT_TOO_LARGE');
    expect(get).not.toHaveBeenCalled();
  });

  it('accepts an object of exactly 50 MiB', async () => {
    getImportDownloadUrl.mockReturnValue(
      of({ url: SIGNED, sizeBytes: SARIF_IMPORT_LIMITS.maxUploadedBytes }),
    );
    await expect(source.open(PROJECT, KEY)()).resolves.toBeInstanceOf(Readable);
  });

  it('maps a GetImportDownloadUrl failure and a 403 to IMPORT_STORAGE_UNAVAILABLE', async () => {
    getImportDownloadUrl.mockReturnValueOnce(
      throwError(() => Object.assign(new Error('5 NOT_FOUND'), { code: 5 })),
    );
    expect(await codeOf(source.open(PROJECT, KEY)())).toBe(
      'IMPORT_STORAGE_UNAVAILABLE',
    );

    get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        response: { status: 403 },
        config: { url: SIGNED },
      }),
    );
    const err = await source
      .open(PROJECT, KEY)()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    // the signed URL never travels in the error
    expect((err as ImportError).message).not.toContain('X-Sig');
    expect((err as ImportError).message).not.toContain('storage.internal');
  });

  it('maps a non-2xx answer and an empty url to IMPORT_STORAGE_UNAVAILABLE', async () => {
    get.mockResolvedValueOnce({ status: 302, data: Readable.from([]) });
    expect(await codeOf(source.open(PROJECT, KEY)())).toBe(
      'IMPORT_STORAGE_UNAVAILABLE',
    );
    getImportDownloadUrl.mockReturnValueOnce(of({ url: '', sizeBytes: '1' }));
    expect(await codeOf(source.open(PROJECT, KEY)())).toBe(
      'IMPORT_STORAGE_UNAVAILABLE',
    );
  });

  it('times GetImportDownloadUrl out at 20 s', async () => {
    jest.useFakeTimers();
    try {
      getImportDownloadUrl.mockReturnValue(NEVER);
      const pending = codeOf(source.open(PROJECT, KEY)());
      await jest.advanceTimersByTimeAsync(20_000);
      expect(await pending).toBe('IMPORT_STORAGE_UNAVAILABLE');
    } finally {
      jest.useRealTimers();
    }
  });

  it('turns a read error of the object into IMPORT_STORAGE_UNAVAILABLE', async () => {
    const body = new Readable({ read() {} });
    get.mockResolvedValueOnce({ status: 200, data: body });
    const stream = await source.open(PROJECT, KEY)();
    const done = readAll(stream).catch((e: unknown) => e);
    body.destroy(new Error(`socket hang up ${SIGNED}`));
    const err = await done;
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    expect((err as ImportError).message).not.toContain('X-Sig');
  });
});
