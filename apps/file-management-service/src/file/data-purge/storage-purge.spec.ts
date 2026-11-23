import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import {
  PURGE_PAGE_SIZE,
  StoragePurge,
  StorageTarget,
  assertPurgePrefix,
} from './storage-purge';

const PID = '0b6f3c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const PREFIX = `scan/${PID}/`;
const FUTURE = () => Date.now() + 60_000;

function s3Target(send: jest.Mock): StorageTarget {
  return { provider: 's3', client: { send } as never, bucket: 'b' };
}

/** An edition backend listing `versions`, in pages of PURGE_PAGE_SIZE. */
function fakeBackend(
  versions: Array<{ key: string; version: string | undefined }>,
  deleteVersion: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  const remaining = [...versions];
  const backend = {
    label: 'Fake',
    listVersions: jest.fn(async (_prefix: string, pageSize: number) => {
      const page = remaining.slice(0, pageSize);
      return { versions: page, more: remaining.length > pageSize };
    }),
    deleteVersion: jest.fn(async (key: string, version: string) => {
      await deleteVersion(key, version);
      const i = remaining.findIndex(
        (v) => v.key === key && v.version === version,
      );
      if (i >= 0) remaining.splice(i, 1);
    }),
    isNotFound: (err: unknown) =>
      (err as { code?: unknown } | undefined)?.code === 404,
  };
  return backend;
}

function backendTarget(backend: ReturnType<typeof fakeBackend>): StorageTarget {
  return { provider: 'backend', backend: backend as never };
}

describe('StoragePurge', () => {
  it('deletes every version and delete marker under the prefix (S3)', async () => {
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: `${PREFIX}a.zip`, VersionId: 'v1' },
            { Key: `${PREFIX}a.zip`, VersionId: 'v2' },
          ],
          DeleteMarkers: [{ Key: `${PREFIX}b.zip`, VersionId: 'm1' }],
          IsTruncated: false,
        };
      }
      return {};
    });

    const res = await new StoragePurge(() => s3Target(send)).purgePrefix(
      PREFIX,
      FUTURE(),
    );

    const list = send.mock.calls[0][0] as ListObjectVersionsCommand;
    expect(list).toBeInstanceOf(ListObjectVersionsCommand);
    expect(list.input).toEqual({
      Bucket: 'b',
      Prefix: PREFIX,
      MaxKeys: PURGE_PAGE_SIZE,
    });
    const commands = send.mock.calls.map((c) => c[0] as unknown);
    // An S3-compatible store may refuse DeleteObjects' CRC32 checksum: one DeleteObject per
    // version and per marker, which needs no request checksum.
    expect(commands.some((c) => c instanceof DeleteObjectsCommand)).toBe(false);
    const deletes = commands.filter(
      (c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand,
    );
    expect(deletes.map((d) => d.input)).toEqual([
      { Bucket: 'b', Key: `${PREFIX}a.zip`, VersionId: 'v1' },
      { Bucket: 'b', Key: `${PREFIX}a.zip`, VersionId: 'v2' },
      { Bucket: 'b', Key: `${PREFIX}b.zip`, VersionId: 'm1' },
    ]);
    expect(res).toEqual({ deleted: 3, complete: true });
  });

  it.each([
    '',
    'reports/',
    'scan//',
    'reports/../',
    'scan/abc/',
    'scan/',
    `scan/${PID}`,
    `scan/${PID}/x/`,
    `other/${PID}/`,
    `/scan/${PID}/`,
    `scan/${PID.toUpperCase()}/`,
    `reports/${PID}/../`,
    `scan/${PID}/\n`,
    `scan/${PID}\n/`,
    'import/',
    `import/${PID}/../`,
  ])('refuses a prefix that is not one project folder: %j', async (prefix) => {
    const send = jest.fn();
    const backend = fakeBackend([]);
    expect(() => assertPurgePrefix(prefix)).toThrow();
    await expect(
      new StoragePurge(() => s3Target(send)).purgePrefix(prefix, FUTURE()),
    ).rejects.toThrow();
    await expect(
      new StoragePurge(() => backendTarget(backend)).purgePrefix(
        prefix,
        FUTURE(),
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(backend.listVersions).not.toHaveBeenCalled();
  });

  it('refuses a prefix that is not a string', async () => {
    const send = jest.fn();
    await expect(
      new StoragePurge(() => s3Target(send)).purgePrefix(
        undefined as unknown as string,
        FUTURE(),
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['scan', 'filtered', 'reports', 'import'])(
    'accepts the %s folder of one id',
    (root) => {
      expect(() => assertPurgePrefix(`${root}/${PID}/`)).not.toThrow();
    },
  );

  it('a rejected S3 delete fails the purge', async () => {
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: `${PREFIX}a.zip`, VersionId: 'v1' },
            { Key: `${PREFIX}a.zip`, VersionId: 'v2' },
          ],
          IsTruncated: false,
        };
      }
      const input = (cmd as DeleteObjectCommand).input;
      if (input.VersionId === 'v2') {
        throw Object.assign(new Error('Access Denied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        });
      }
      return {};
    });

    await expect(
      new StoragePurge(() => s3Target(send)).purgePrefix(PREFIX, FUTURE()),
    ).rejects.toThrow();
  });

  it('refuses an S3 entry listed without a version id', async () => {
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [{ Key: `${PREFIX}a.zip` }],
          IsTruncated: false,
        };
      }
      return {};
    });

    await expect(
      new StoragePurge(() => s3Target(send)).purgePrefix(PREFIX, FUTURE()),
    ).rejects.toThrow();
    expect(
      send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand),
    ).toBe(false);
  });

  it('an empty S3 folder is complete without a delete', async () => {
    const send = jest.fn().mockResolvedValue({ IsTruncated: false });

    const res = await new StoragePurge(() => s3Target(send)).purgePrefix(
      PREFIX,
      FUTURE(),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ deleted: 0, complete: true });
  });

  it('stops at the deadline and resumes (S3)', async () => {
    const page = Array.from({ length: PURGE_PAGE_SIZE }, (_, i) => ({
      Key: `${PREFIX}${i}.zip`,
      VersionId: `v${i}`,
    }));
    let remaining = 2;
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        remaining -= 1;
        return { Versions: page, IsTruncated: remaining > 0 };
      }
      return {};
    });
    const purge = new StoragePurge(() => s3Target(send));

    const first = await purge.purgePrefix(PREFIX, Date.now() - 1);
    expect(first).toEqual({ deleted: PURGE_PAGE_SIZE, complete: false });
    // One page only: one listing, then one delete per listed version.
    const lists = send.mock.calls.filter(
      (c) => c[0] instanceof ListObjectVersionsCommand,
    );
    expect(lists).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1 + PURGE_PAGE_SIZE);

    const second = await purge.purgePrefix(PREFIX, Date.now() - 1);
    expect(second).toEqual({ deleted: PURGE_PAGE_SIZE, complete: true });
  });

  it('keeps listing while pages are full and time is left', async () => {
    let calls = 0;
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        calls += 1;
        return {
          Versions: [{ Key: `${PREFIX}${calls}.zip`, VersionId: 'v' }],
          IsTruncated: calls < 3,
        };
      }
      return {};
    });

    const res = await new StoragePurge(() => s3Target(send)).purgePrefix(
      PREFIX,
      FUTURE(),
    );

    expect(res).toEqual({ deleted: 3, complete: true });
  });

  it('never deletes a listed key outside the prefix', async () => {
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [{ Key: 'scan/other/a.zip', VersionId: 'v1' }],
          IsTruncated: false,
        };
      }
      return {};
    });

    await expect(
      new StoragePurge(() => s3Target(send)).purgePrefix(PREFIX, FUTURE()),
    ).rejects.toThrow();
    expect(
      send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand),
    ).toBe(false);
  });

  it('deletes every version an edition backend lists under the prefix', async () => {
    const backend = fakeBackend([
      { key: `${PREFIX}a.zip`, version: '11' },
      { key: `${PREFIX}a.zip`, version: '12' },
    ]);

    const res = await new StoragePurge(() =>
      backendTarget(backend),
    ).purgePrefix(PREFIX, FUTURE());

    expect(backend.listVersions).toHaveBeenCalledWith(PREFIX, PURGE_PAGE_SIZE);
    expect(backend.deleteVersion.mock.calls).toEqual([
      [`${PREFIX}a.zip`, '11'],
      [`${PREFIX}a.zip`, '12'],
    ]);
    expect(res).toEqual({ deleted: 2, complete: true });
  });

  it('a backend version already gone counts as done; any other error fails the purge', async () => {
    const gone = fakeBackend(
      [{ key: `${PREFIX}a.zip`, version: '11' }],
      jest.fn().mockRejectedValue({ code: 404 }),
    );
    await expect(
      new StoragePurge(() => backendTarget(gone)).purgePrefix(PREFIX, FUTURE()),
    ).resolves.toEqual({ deleted: 0, complete: true });

    const denied = fakeBackend(
      [{ key: `${PREFIX}a.zip`, version: '11' }],
      jest.fn().mockRejectedValue({ code: 403 }),
    );
    await expect(
      new StoragePurge(() => backendTarget(denied)).purgePrefix(
        PREFIX,
        FUTURE(),
      ),
    ).rejects.toEqual({ code: 403 });
  });

  it('refuses a backend entry listed without a version, and one outside the prefix', async () => {
    const unversioned = fakeBackend([
      { key: `${PREFIX}a.zip`, version: undefined },
    ]);
    await expect(
      new StoragePurge(() => backendTarget(unversioned)).purgePrefix(
        PREFIX,
        FUTURE(),
      ),
    ).rejects.toThrow('Fake object listed without a version');
    expect(unversioned.deleteVersion).not.toHaveBeenCalled();

    const outside = fakeBackend([{ key: 'scan/other/a.zip', version: '1' }]);
    await expect(
      new StoragePurge(() => backendTarget(outside)).purgePrefix(
        PREFIX,
        FUTURE(),
      ),
    ).rejects.toThrow('Storage listed an object outside the purged prefix');
    expect(outside.deleteVersion).not.toHaveBeenCalled();
  });

  it('stops at the deadline and resumes (edition backend)', async () => {
    const backend = fakeBackend(
      Array.from({ length: PURGE_PAGE_SIZE + 5 }, (_, i) => ({
        key: `${PREFIX}${i}.zip`,
        version: String(i + 1),
      })),
    );
    const purge = new StoragePurge(() => backendTarget(backend));

    const first = await purge.purgePrefix(PREFIX, Date.now() - 1);
    expect(first).toEqual({ deleted: PURGE_PAGE_SIZE, complete: false });
    expect(backend.listVersions).toHaveBeenCalledTimes(1);

    const second = await purge.purgePrefix(PREFIX, Date.now() - 1);
    expect(second).toEqual({ deleted: 5, complete: true });
  });
});
