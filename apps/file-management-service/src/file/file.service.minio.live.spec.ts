import { randomBytes, randomUUID } from 'node:crypto';
import * as zlib from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { RequestImportUploadUrlResponse } from '@grpc/file-management/file';

import { FileService } from './file.service';
import { FileScan } from 'src/entities/file.entity';
import { StoragePurge } from './data-purge/storage-purge';
import { createLoggerMock } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';

/**
 * Live proof against a real MinIO (S3-compatible, path-style): the
 * import object round-trip, the exact signed upload size, the `import/` purge
 * prefix, and a report download URL signed on S3_PUBLIC_ENDPOINT.
 *
 * Skipped by default. Run it against a throwaway S3-compatible server reached
 * over HTTPS:
 *
 *   FM_S3_MINIO_LIVE=1 FM_S3_MINIO_ENDPOINT=https://127.0.0.1:<port> \
 *     NODE_EXTRA_CA_CERTS=<the server's certificate> \
 *     pnpm exec jest --ci --runInBand src/file/file.service.minio.live.spec.ts
 *
 * HTTPS, because under Jest the AWS SDK cannot reach a plain http:// endpoint:
 * its node http handler loads `node:http` with a dynamic import(), which Jest
 * refuses without --experimental-vm-modules (`node:https` is a static
 * require). A TLS proxy in front of the server is enough. The report URL test
 * signs on http://localhost:<same port>, so that name must reach the plain
 * server on that port.
 *
 * It also runs against SeaweedFS (`weed server -s3`) behind such a proxy,
 * for when the minio/minio and minio/mc images cannot be pulled.
 *
 * FM_S3_MINIO_ENDPOINT (default http://127.0.0.1:9000) and
 * FM_S3_MINIO_ACCESS_KEY / FM_S3_MINIO_SECRET_KEY (default minioadmin, MinIO's
 * own default test credentials) override the connection. The spec creates one
 * bucket `fm-live-<8 random hex>` in beforeAll and empties and removes it in
 * afterAll.
 */
const LIVE = process.env.FM_S3_MINIO_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ENDPOINT = process.env.FM_S3_MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
const ACCESS_KEY = process.env.FM_S3_MINIO_ACCESS_KEY ?? 'minioadmin';
const SECRET_KEY = process.env.FM_S3_MINIO_SECRET_KEY ?? 'minioadmin';

function makeService(bucket: string, publicEndpoint?: string): FileService {
  const config = new ConfigService({
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: ENDPOINT,
    S3_BUCKET_NAME: bucket,
    AWS_REGION: 'us-east-1',
    ...(publicEndpoint ? { S3_PUBLIC_ENDPOINT: publicEndpoint } : {}),
  } as Record<string, string>);
  const secrets = {
    getSecret: (key: string): string =>
      key === 'S3_ACCESS_KEY_ID' ? ACCESS_KEY : SECRET_KEY,
    ensureCacheLoaded: (): void => undefined,
  } as unknown as SecretsService;
  const repo = {
    create: <T>(entity: T): T => entity,
    save: async <T>(entity: T): Promise<T> => entity,
    findOne: async (): Promise<FileScan | null> => null,
  } as unknown as Repository<FileScan>;
  return new FileService(
    repo,
    createLoggerMock() as unknown as Logger,
    config,
    secrets,
    {} as ClientGrpc,
  );
}

/**
 * A valid multi-member gzip stream of exactly `totalBytes`: the SARIF payload
 * followed by small gzip members used as padding. Readers detect gzip from
 * the first bytes (`1f 8b`) and a gunzip concatenates every member.
 */
function gzipOfExactly(json: string, totalBytes: number): Buffer {
  const base = zlib.gzipSync(Buffer.from(json, 'utf8'));
  if (base.length === totalBytes) return base;
  if (base.length > totalBytes) {
    throw new Error('payload gzip is larger than the target size');
  }
  const members: Buffer[] = [];
  const sizes: number[] = [];
  for (let k = 0; k <= 512; k++) {
    const member = zlib.gzipSync(Buffer.alloc(k, 0x20));
    members.push(member);
    sizes.push(member.length);
  }
  const prevOf = new Map<number, { from: number; member: number }>();
  const seen = new Set<number>([base.length]);
  const queue: number[] = [base.length];
  let found = -1;
  while (queue.length > 0 && found === -1) {
    const sum = queue.shift() as number;
    for (let i = 0; i < sizes.length; i++) {
      const next = sum + sizes[i];
      if (next > totalBytes || seen.has(next)) continue;
      seen.add(next);
      prevOf.set(next, { from: sum, member: i });
      if (next === totalBytes) {
        found = next;
        break;
      }
      queue.push(next);
    }
  }
  if (found === -1) {
    throw new Error(`cannot pad a gzip stream to exactly ${totalBytes} bytes`);
  }
  const parts: Buffer[] = [base];
  let cur = found;
  while (prevOf.has(cur)) {
    const { from, member } = prevOf.get(cur) as {
      from: number;
      member: number;
    };
    parts.push(members[member]);
    cur = from;
  }
  return Buffer.concat(parts);
}

describeLive('FileService on a real MinIO', () => {
  const bucket = `fm-live-${randomBytes(4).toString('hex')}`;
  let admin: S3Client;
  let service: FileService;
  let importUpload: RequestImportUploadUrlResponse;

  beforeAll(async () => {
    admin = new S3Client({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      forcePathStyle: true,
    });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    service = makeService(bucket);
  }, 60_000);

  afterAll(async () => {
    let token: string | undefined;
    for (;;) {
      const page = await admin.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
      for (const obj of page.Contents ?? []) {
        if (obj.Key) {
          await admin.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }),
          );
        }
      }
      if (!page.IsTruncated) break;
      token = page.NextContinuationToken;
    }
    await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
  }, 60_000);

  it('round-trips an import object with path-style URLs', async () => {
    const projectId = randomUUID();
    const scanId = randomUUID();
    const body = gzipOfExactly('{"version":"2.1.0","runs":[]}', 1024);

    importUpload = await service.requestImportUploadUrl({
      scanId,
      projectId,
      contentEncoding: 'gzip',
      contentLength: body.length,
    });
    const uploadUrl = new URL(importUpload.uploadUrl);
    expect(uploadUrl.pathname.startsWith(`/${bucket}/import/`)).toBe(true);

    const put = await fetch(importUpload.uploadUrl, {
      method: 'PUT',
      headers: importUpload.uploadHeaders,
      // Buffer.concat is Buffer<ArrayBufferLike>, which TS 6 does not accept
      // as a fetch BodyInit.
      body: body as unknown as BodyInit,
    });
    expect(put.status).toBe(200);

    const dl = await service.getImportDownloadUrl({
      projectId,
      objectKey: importUpload.objectKey,
    });
    expect(dl.sizeBytes).toBe(1024);
    const got = await fetch(dl.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(body)).toBe(true);

    await service.deleteImportObject({
      projectId,
      objectKey: importUpload.objectKey,
    });
    const err = await service
      .getImportDownloadUrl({ projectId, objectKey: importUpload.objectKey })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcException);
    expect((err as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.NOT_FOUND }),
    );
  });

  it('refuses a PUT larger than the signed size', async () => {
    const oversized = Buffer.alloc(1025, 0x61);
    const put = await fetch(importUpload.uploadUrl, {
      method: 'PUT',
      headers: importUpload.uploadHeaders,
      body: oversized,
    });
    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  it('purges the project import folder', async () => {
    const projectId = randomUUID();
    await admin.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `import/${projectId}/a.sarif`,
        Body: 'a',
      }),
    );
    await admin.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `import/${projectId}/b.sarif`,
        Body: 'b',
      }),
    );

    const purge = new StoragePurge(() => service.storageTarget());
    const res = await purge.purgePrefix(
      `import/${projectId}/`,
      Date.now() + 60_000,
    );
    expect(res).toEqual({ deleted: 2, complete: true });
  });

  it('a report URL signed on the public endpoint is fetchable through it', async () => {
    const endpointUrl = new URL(ENDPOINT);
    const publicEndpoint = endpointUrl.port
      ? `http://localhost:${endpointUrl.port}`
      : 'http://localhost';
    const publicService = makeService(bucket, publicEndpoint);
    const projectId = randomUUID();

    const req = await publicService.requestReportUploadUrl({
      projectId,
      filename: 'report.pdf',
      contentType: 'application/pdf',
    });
    const bytes = Buffer.from('%PDF-1.4 cybedefend live proof');
    const put = await fetch(req.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    expect(put.status).toBe(200);

    const fin = await publicService.finalizeReportUpload({
      objectPath: req.objectPath,
      projectId,
      ttlSeconds: 600,
      filename: 'report.pdf',
    });
    const downloadUrl = new URL(fin.downloadUrl);
    expect(downloadUrl.origin).toBe(publicEndpoint);
    const got = await fetch(fin.downloadUrl);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
  });
});
