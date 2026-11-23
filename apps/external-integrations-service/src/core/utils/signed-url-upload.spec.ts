import axios from 'axios';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReadStream } from 'node:fs';
import {
  signedUploadHeaders,
  uploadFileToSignedUrl,
} from './signed-url-upload';

/**
 * The rewritten repository archive is PUT to a signed storage URL. With axios'
 * default `maxRedirects`, the request goes through follow-redirects, which
 * keeps every chunk of the body until the response arrives so it can replay it
 * on a redirect: the whole archive ends up in memory, outside any heap limit,
 * and a multi-GB repository OOM-kills the repo-scan worker. A signed upload URL
 * never redirects, so the body goes through Node's http client directly.
 */
describe('uploadFileToSignedUrl', () => {
  let dir: string;
  let file: string;
  const content = Buffer.alloc(3 * 1024 * 1024 + 17, 'r');

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'signed-upload-'));
    file = path.join(dir, 'cleaned.zip');
    await fs.promises.writeFile(file, content);
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  afterEach(() => jest.restoreAllMocks());

  it('streams the file without the redirect-following client', async () => {
    const put = jest
      .spyOn(axios, 'put')
      .mockResolvedValue({ status: 200, data: '' });

    await uploadFileToSignedUrl('https://storage.example/upload', file, {
      'x-goog-content-length-range': '0,5368709120',
    });

    expect(put).toHaveBeenCalledTimes(1);
    const [url, body, options] = put.mock.calls[0];
    expect(url).toBe('https://storage.example/upload');
    expect(body).toBeInstanceOf(ReadStream);
    (body as ReadStream).destroy();
    expect(options).toMatchObject({
      maxRedirects: 0,
      headers: {
        'x-goog-content-length-range': '0,5368709120',
        'Content-Length': String(content.length),
      },
    });
  });

  it('delivers the whole file to the storage server', async () => {
    let received = Buffer.alloc(0);
    let length: string | undefined;
    const server = http.createServer((req, res) => {
      length = req.headers['content-length'];
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = Buffer.concat(chunks);
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      await uploadFileToSignedUrl(`http://127.0.0.1:${port}/upload`, file, {});
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(length).toBe(String(content.length));
    expect(received.equals(content)).toBe(true);
  });
});

describe('signedUploadHeaders', () => {
  it('sends the content type the URL was signed for', () => {
    expect(
      signedUploadHeaders('https://s3.example/b/k?sig=1', 'application/x-tar'),
    ).toEqual({ 'Content-Type': 'application/x-tar' });
  });

  it('adds the create-only and size conditions a GCS URL is signed with', () => {
    expect(
      signedUploadHeaders(
        'https://storage.googleapis.com/b/k?X-Goog-Signature=1',
        'application/zip',
      ),
    ).toEqual({
      'Content-Type': 'application/zip',
      'x-goog-if-generation-match': '0',
      'x-goog-content-length-range': '0,5368709120',
    });
  });
});
