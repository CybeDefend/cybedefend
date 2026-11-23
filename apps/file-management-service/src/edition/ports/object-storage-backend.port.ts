import type { Readable } from 'node:stream';

/**
 * An object store other than the built-in S3-compatible one. FileService keeps
 * the S3-compatible store (any S3 API: AWS S3, MinIO, SeaweedFS…) as its
 * default backend; an edition may bind this token to another store, which then
 * serves every storage call (signed URLs, reads, uploads, deletes, purge).
 * The Community Edition binds `null`: the S3-compatible store.
 */
export const OBJECT_STORAGE_BACKEND = 'OBJECT_STORAGE_BACKEND';

export interface ObjectStorageStat {
  size: number;
  updated: Date;
  contentType?: string;
}

export interface SignedObjectPut {
  url: string;
  /** Headers the signature covers: the uploader must send them verbatim. */
  signedHeaders: Record<string, string>;
}

export interface ObjectStorageBackend {
  /** The store's name in logs and messages. */
  readonly label: string;

  /** Builds the client; called once from FileService.onModuleInit. */
  init(): Promise<void>;

  signPut(
    key: string,
    opts: {
      contentType: string;
      expiresAtMs: number;
      /** The upload fails when the object already exists. */
      createOnly?: boolean;
      /** Inclusive bounds of the uploaded size, in bytes. */
      sizeRange?: { min: number; max: number };
    },
  ): Promise<SignedObjectPut>;

  signGet(
    key: string,
    opts: {
      expiresAtMs: number;
      responseDisposition?: string;
      /** The store's default signature when absent. */
      signatureVersion?: 'v2' | 'v4';
    },
  ): Promise<string>;

  exists(key: string): Promise<boolean>;

  /** Throws the store's error, `isNotFound` true, when the object is absent. */
  stat(key: string): Promise<ObjectStorageStat>;

  isNotFound(err: unknown): boolean;

  createReadStream(key: string): Readable;

  uploadFile(filePath: string, key: string, contentType: string): Promise<void>;

  /** Throws the store's error, `isNotFound` true, when the object is absent. */
  delete(key: string): Promise<void>;

  /**
   * One page (at most `pageSize`) of the object versions under `prefix`, every
   * version and delete marker included; `more` is true when versions may
   * remain. `version` is undefined when the store listed none.
   */
  listVersions(
    prefix: string,
    pageSize: number,
  ): Promise<{
    versions: Array<{ key: string; version: string | undefined }>;
    more: boolean;
  }>;

  /** Throws the store's error, `isNotFound` true, when the version is gone. */
  deleteVersion(key: string, version: string): Promise<void>;
}
