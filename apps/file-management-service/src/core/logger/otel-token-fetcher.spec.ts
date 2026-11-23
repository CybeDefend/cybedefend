import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Both edition files are mocked: the spec runs unchanged in a tree whose
// edition layer is the Community one (fixed edition, no closed source).
const mockClosedSource = jest.fn<Promise<string | undefined>, []>();
let mockHasClosedSource = true;
let mockCommunity = false;

jest.mock('../../edition/ee-observability', () => ({
  get EE_OTEL_INGEST_TOKEN_SOURCE() {
    return mockHasClosedSource ? () => mockClosedSource() : null;
  },
}));

jest.mock('../../edition/edition', () => ({
  isCommunityEdition: () => mockCommunity,
}));

import { fetchOtelIngestToken } from './otel-token-fetcher';

describe('fetchOtelIngestToken', () => {
  const savedToken = process.env.OTEL_INGEST_TOKEN;

  beforeEach(() => {
    mockClosedSource.mockReset();
    mockClosedSource.mockResolvedValue('closed-token');
    mockHasClosedSource = true;
    mockCommunity = false;
    delete process.env.OTEL_INGEST_TOKEN;
  });

  afterAll(() => {
    if (savedToken === undefined) delete process.env.OTEL_INGEST_TOKEN;
    else process.env.OTEL_INGEST_TOKEN = savedToken;
  });

  it('returns the token of the environment and asks no other source', async () => {
    process.env.OTEL_INGEST_TOKEN = 'env-token';

    await expect(fetchOtelIngestToken()).resolves.toBe('env-token');
    expect(mockClosedSource).not.toHaveBeenCalled();
  });

  it('in the Community Edition, reads the environment only', async () => {
    mockCommunity = true;

    await expect(fetchOtelIngestToken()).resolves.toBeUndefined();
    expect(mockClosedSource).not.toHaveBeenCalled();
  });

  it('in another edition, falls back to the closed extension', async () => {
    await expect(fetchOtelIngestToken()).resolves.toBe('closed-token');
    expect(mockClosedSource).toHaveBeenCalledTimes(1);
  });

  it('has no token without the environment nor a closed extension', async () => {
    mockHasClosedSource = false;

    await expect(fetchOtelIngestToken()).resolves.toBeUndefined();
  });

  it('imports the edition layer only, no package', () => {
    const source = readFileSync(
      join(__dirname, 'otel-token-fetcher.ts'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual([
      '../../edition/edition',
      '../../edition/ee-observability',
    ]);
  });
});
