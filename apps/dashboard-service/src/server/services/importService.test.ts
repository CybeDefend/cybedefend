import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/server/api/gatewayAPI', () => ({ default: { post } }));

import {
  IMPORT_EXTENSIONS,
  IMPORT_MAX_BYTES,
  IMPORT_TYPES,
  importFileProblem,
  importResults,
} from './importService';

const sarif = (name = 'results.sarif', size = 10) => new File(['x'.repeat(size)], name, { type: 'application/json' });

const sentForm = (): FormData => post.mock.calls[0][1] as FormData;
const sentConfig = () => post.mock.calls[0][2] as Record<string, any>;

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ status: 202, data: { scanId: 'scan-1' } });
});

describe('importService', () => {
  it('names the six import types in the dialog order, the limit and the extensions', () => {
    expect(IMPORT_TYPES).toEqual(['sast', 'iac', 'secret', 'cicd', 'sca', 'container']);
    expect(IMPORT_MAX_BYTES).toBe(52_428_800);
    expect(IMPORT_EXTENSIONS).toEqual(['.sarif', '.json', '.sarif.gz']);
  });

  it('posts the parts as multipart to the import route and answers the scan id', async () => {
    const file = sarif();
    await expect(
      importResults({ projectId: 'p-1', file, type: 'sast', branch: 'main', commit: 'abcdef1' }),
    ).resolves.toEqual({ scanId: 'scan-1' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/project/p-1/scan/import/start');
    const form = sentForm();
    expect(form.get('type')).toBe('sast');
    expect(form.get('branch')).toBe('main');
    expect(form.get('commit')).toBe('abcdef1');
    expect(form.get('format')).toBe('sarif');
    expect((form.get('file') as File).name).toBe('results.sarif');
    expect(form.has('image')).toBe(false);
    // A JSON content type would make axios turn the form into JSON.
    expect(sentConfig().headers['Content-Type']).toBe('multipart/form-data');
  });

  it('sends no commit part when none is given', async () => {
    await importResults({ projectId: 'p-1', file: sarif(), type: 'iac', branch: 'main' });
    expect(sentForm().has('commit')).toBe(false);
  });

  it('names a gzipped part results.sarif.gz', async () => {
    await importResults({ projectId: 'p-1', file: sarif('Scan.SARIF.GZ'), type: 'secret', branch: 'main' });
    expect((sentForm().get('file') as File).name).toBe('results.sarif.gz');
  });

  it('sends the image for a container import only', async () => {
    await importResults({ projectId: 'p-1', file: sarif(), type: 'container', branch: 'main', image: 'ghcr.io/acme/api:v2' });
    expect(sentForm().get('image')).toBe('ghcr.io/acme/api:v2');

    post.mockClear();
    await importResults({ projectId: 'p-1', file: sarif(), type: 'sca', branch: 'main', image: 'ghcr.io/acme/api:v2' });
    expect(sentForm().has('image')).toBe(false);
  });

  it('reports the upload progress as a fraction', async () => {
    const onProgress = vi.fn();
    await importResults({ projectId: 'p-1', file: sarif(), type: 'sast', branch: 'main' }, onProgress);
    sentConfig().onUploadProgress({ loaded: 5, total: 10 });
    sentConfig().onUploadProgress({ loaded: 5 });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it('refuses an answer without a scan id', async () => {
    post.mockResolvedValue({ status: 202, data: {} });
    await expect(importResults({ projectId: 'p-1', file: sarif(), type: 'sast', branch: 'main' })).rejects.toThrow();
  });

  it('passes a refusal through unchanged', async () => {
    const refusal = { response: { status: 400, data: { code: 'IMPORT_INVALID_SARIF' } } };
    post.mockRejectedValue(refusal);
    await expect(importResults({ projectId: 'p-1', file: sarif(), type: 'sast', branch: 'main' })).rejects.toBe(refusal);
  });
});

describe('importFileProblem', () => {
  it('accepts the three extensions, whatever their case', () => {
    for (const name of ['a.sarif', 'a.json', 'a.sarif.gz', 'A.SARIF']) expect(importFileProblem(sarif(name))).toBeNull();
  });

  it('refuses another extension, a file over 50 MiB and an empty file', () => {
    expect(importFileProblem(sarif('a.zip'))).toBe('extension');
    expect(importFileProblem(sarif('a.json.gz'))).toBe('extension');
    const big = sarif('a.sarif');
    Object.defineProperty(big, 'size', { value: IMPORT_MAX_BYTES + 1 });
    expect(importFileProblem(big)).toBe('size');
    expect(importFileProblem(sarif('a.sarif', 0))).toBe('empty');
  });
});
