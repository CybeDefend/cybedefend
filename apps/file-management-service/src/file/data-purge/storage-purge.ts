import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStorageBackend } from '../../edition/ports/object-storage-backend.port';

/**
 * The only prefixes a purge may delete: ONE id's folder under one of the
 * four roots (scan, filtered, reports, import — the last one holds the SARIF
 * import objects). A wrong prefix (`''`, `reports/`, `scan//`) would
 * delete every customer's objects, so this is checked before any storage
 * call, on every call, whatever the caller validated.
 */
export const PURGE_PREFIX_PATTERN =
  /^(scan|filtered|reports|import)\/[0-9a-f-]{36}\/$/;

/** Objects (versions, generations, delete markers) listed and deleted per page. */
export const PURGE_PAGE_SIZE = 1000;

/**
 * Every store deletes one version (generation, delete marker) per request:
 * this many run at once. S3 does not use DeleteObjects on purpose: it is a
 * checksum-required operation, the SDK sends a CRC32 flexible checksum
 * instead of Content-MD5, which not every S3-compatible store accepts. A single
 * DeleteObject needs no request checksum.
 */
const DELETE_CONCURRENCY = 50;

export type StorageTarget =
  | { provider: 'backend'; backend: ObjectStorageBackend }
  | { provider: 's3'; client: S3Client; bucket: string };

export interface PrefixPurgeResult {
  deleted: number;
  complete: boolean;
}

export class InvalidPurgePrefixError extends Error {
  constructor() {
    super('Refusing to purge a prefix that is not one id folder');
    this.name = 'InvalidPurgePrefixError';
  }
}

export function assertPurgePrefix(prefix: string): void {
  if (typeof prefix !== 'string' || !PURGE_PREFIX_PATTERN.test(prefix)) {
    throw new InvalidPurgePrefixError();
  }
}

/**
 * Deletes every object under a prefix, every version and delete marker
 * included, on a versioned bucket (S3 versions, or an edition backend's).
 *
 * Each pass lists the first page under the prefix again: what the previous
 * pass deleted no longer appears, so a call that stopped at its deadline (or
 * failed) is resumed by the next call with no cursor to keep.
 */
export class StoragePurge {
  constructor(private readonly target: () => StorageTarget) {}

  async purgePrefix(
    prefix: string,
    deadline: number,
  ): Promise<PrefixPurgeResult> {
    assertPurgePrefix(prefix);
    const target = this.target();
    let deleted = 0;
    // At least one page, then more only while a page was full and time is left.
    for (;;) {
      const page =
        target.provider === 'backend'
          ? await this.backendPage(target.backend, prefix)
          : await this.s3Page(target, prefix);
      deleted += page.deleted;
      if (!page.more) return { deleted, complete: true };
      if (Date.now() >= deadline) return { deleted, complete: false };
    }
  }

  private async s3Page(
    target: Extract<StorageTarget, { provider: 's3' }>,
    prefix: string,
  ): Promise<{ deleted: number; more: boolean }> {
    const listed = await target.client.send(
      new ListObjectVersionsCommand({
        Bucket: target.bucket,
        Prefix: prefix,
        MaxKeys: PURGE_PAGE_SIZE,
      }),
    );
    const objects = [
      ...(listed.Versions ?? []),
      ...(listed.DeleteMarkers ?? []),
    ].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
    assertUnderPrefix(
      objects.map((o) => o.Key),
      prefix,
    );
    if (objects.some((o) => typeof o.VersionId !== 'string' || !o.VersionId)) {
      // Without a VersionId, a delete on a versioned bucket only adds a
      // delete marker and keeps every version: refuse rather than half-purge.
      throw new Error('S3 object listed without a version id');
    }

    // Any rejected delete throws: the call fails closed, the next one resumes.
    for (let i = 0; i < objects.length; i += DELETE_CONCURRENCY) {
      const chunk = objects.slice(i, i + DELETE_CONCURRENCY);
      await Promise.all(
        chunk.map((o) =>
          target.client.send(
            new DeleteObjectCommand({
              Bucket: target.bucket,
              Key: o.Key,
              VersionId: o.VersionId,
            }),
          ),
        ),
      );
    }
    return { deleted: objects.length, more: listed.IsTruncated === true };
  }

  private async backendPage(
    backend: ObjectStorageBackend,
    prefix: string,
  ): Promise<{ deleted: number; more: boolean }> {
    const { versions, more } = await backend.listVersions(
      prefix,
      PURGE_PAGE_SIZE,
    );
    assertUnderPrefix(
      versions.map((v) => v.key),
      prefix,
    );

    let deleted = 0;
    for (let i = 0; i < versions.length; i += DELETE_CONCURRENCY) {
      const chunk = versions.slice(i, i + DELETE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (v) => {
          if (typeof v.version !== 'string' || !v.version) {
            // Without a version, a delete would remove only the live
            // version and leave the older ones: refuse rather than half-purge.
            throw new Error(`${backend.label} object listed without a version`);
          }
          try {
            await backend.deleteVersion(v.key, v.version);
            return 1;
          } catch (err) {
            if (backend.isNotFound(err)) return 0;
            throw err;
          }
        }),
      );
      deleted += results.reduce((a, b) => a + b, 0);
    }
    return { deleted, more };
  }
}

function assertUnderPrefix(keys: (string | undefined)[], prefix: string) {
  if (keys.some((k) => typeof k !== 'string' || !k.startsWith(prefix))) {
    throw new Error('Storage listed an object outside the purged prefix');
  }
}
