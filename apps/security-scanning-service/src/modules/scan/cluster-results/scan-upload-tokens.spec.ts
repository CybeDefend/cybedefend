import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import {
  hashScanToken,
  SCAN_TOKEN_PATTERN,
  ScanUploadTokens,
} from './scan-upload-tokens';

/**
 * Community scans on a connected Kubernetes cluster: one upload token per scanner container, `cdst_` + 32 random bytes in
 * base64url, stored only as the SHA-256 hex of the whole string, spent once.
 * The claim itself (one conditional UPDATE decided on `affected`) is proven
 * on both engines by scan-upload-tokens.live.spec.ts.
 */
const NOW = new Date('2026-11-04T10:00:00Z');
const LATER = new Date('2026-11-04T12:00:00Z');
const H = 'ab'.repeat(32);

const row = (over: Partial<ScanUploadToken> = {}): ScanUploadToken =>
  ({
    id: 'row-1',
    scanId: 'scan-1',
    containerId: 'container-1',
    tokenHash: H,
    category: 'sast',
    severities: 'critical,high',
    expiresAt: LATER,
    usedAt: null,
    createdAt: NOW,
    ...over,
  }) as ScanUploadToken;

const repository = (found: ScanUploadToken | null = null) => {
  const query = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const repo = {
    insert: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(found),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(query),
  };
  return {
    repo,
    query,
    tokens: new ScanUploadTokens(
      repo as unknown as Repository<ScanUploadToken>,
    ),
  };
};

describe('hashScanToken', () => {
  it('is the SHA-256 hex of the whole string', () => {
    const token = `cdst_${'A'.repeat(43)}`;
    expect(hashScanToken(token)).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(hashScanToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SCAN_TOKEN_PATTERN', () => {
  it('accepts cdst_ and 43 base64url characters, nothing else', () => {
    expect(SCAN_TOKEN_PATTERN.test(`cdst_${'a-_Z9'.repeat(8)}abc`)).toBe(true);
    expect(SCAN_TOKEN_PATTERN.test(`cdst_${'a'.repeat(42)}`)).toBe(false);
    expect(SCAN_TOKEN_PATTERN.test(`cdst_${'a'.repeat(44)}`)).toBe(false);
    expect(SCAN_TOKEN_PATTERN.test(`cdst_${'a'.repeat(42)}=`)).toBe(false);
    expect(SCAN_TOKEN_PATTERN.test(`cdpat_${'a'.repeat(43)}`)).toBe(false);
  });
});

describe('ScanUploadTokens', () => {
  describe('mint', () => {
    it('mint returns a token matching SCAN_TOKEN_PATTERN and saves only its hash', async () => {
      const { repo, tokens } = repository();

      const token = await tokens.mint({
        scanId: 'scan-1',
        containerId: 'container-1',
        category: 'cicd',
        severities: 'critical,high,medium,low',
        expiresAt: LATER,
      });

      expect(token).toMatch(SCAN_TOKEN_PATTERN);
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const saved = repo.insert.mock.calls[0][0];
      expect(saved).toEqual({
        scanId: 'scan-1',
        containerId: 'container-1',
        tokenHash: hashScanToken(token),
        category: 'cicd',
        severities: 'critical,high,medium,low',
        expiresAt: LATER,
        usedAt: null,
      });
      expect(JSON.stringify(saved)).not.toContain(token);
      expect(JSON.stringify(saved)).not.toContain(token.slice(5));
    });

    it('two mints give two different tokens', async () => {
      const { tokens } = repository();
      const input = {
        scanId: 'scan-1',
        containerId: 'container-1',
        category: 'sast',
        severities: '',
        expiresAt: LATER,
      };

      const [a, b] = [await tokens.mint(input), await tokens.mint(input)];

      expect(a).not.toBe(b);
    });
  });

  describe('authorize', () => {
    it('a valid token answers its row', async () => {
      const valid = row();
      const { repo, tokens } = repository(valid);

      await expect(
        tokens.authorize('scan-1', valid.tokenHash, NOW),
      ).resolves.toEqual({ row: valid });
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { tokenHash: valid.tokenHash },
      });
    });

    it('authorize: unknown hash, other scan or expired ⇒ invalid, spent ⇒ used', async () => {
      await expect(
        repository(null).tokens.authorize('scan-1', 'cd'.repeat(32), NOW),
      ).resolves.toEqual({ refused: 'invalid' });
      await expect(
        repository(row({ scanId: 'scan-2' })).tokens.authorize(
          'scan-1',
          H,
          NOW,
        ),
      ).resolves.toEqual({ refused: 'invalid' });
      await expect(
        repository(row({ expiresAt: NOW })).tokens.authorize('scan-1', H, NOW),
      ).resolves.toEqual({ refused: 'invalid' });
      await expect(
        repository(row({ usedAt: NOW })).tokens.authorize('scan-1', H, NOW),
      ).resolves.toEqual({ refused: 'used' });
    });

    it('a spent token is used even once expired (a lost answer after a fast import)', async () => {
      await expect(
        repository(
          row({ usedAt: NOW, expiresAt: new Date('2026-11-04T09:00:00Z') }),
        ).tokens.authorize('scan-1', H, NOW),
      ).resolves.toEqual({ refused: 'used' });
    });

    it('a spent token of another scan is invalid, never used', async () => {
      await expect(
        repository(row({ scanId: 'scan-2', usedAt: NOW })).tokens.authorize(
          'scan-1',
          H,
          NOW,
        ),
      ).resolves.toEqual({ refused: 'invalid' });
    });

    it('a hash that is not 64 hex characters is invalid without a read', async () => {
      const { repo, tokens } = repository(row());

      await expect(
        tokens.authorize('scan-1', 'cdst_abc', NOW),
      ).resolves.toEqual({ refused: 'invalid' });
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('claim', () => {
    it('one conditional UPDATE decides: affected 1 is claimed', async () => {
      const { query, tokens } = repository();

      await expect(tokens.claim('scan-1', H, NOW)).resolves.toBe('claimed');
      expect(query.update).toHaveBeenCalledTimes(1);
      expect(query.set).toHaveBeenCalledWith({ usedAt: NOW });
      expect(query.execute).toHaveBeenCalledTimes(1);
    });

    it('affected 0 on a spent token of the scan is used, otherwise invalid', async () => {
      const spent = repository(row({ usedAt: NOW }));
      spent.query.execute.mockResolvedValue({ affected: 0 });
      await expect(spent.tokens.claim('scan-1', H, NOW)).resolves.toBe('used');

      const unknown = repository(null);
      unknown.query.execute.mockResolvedValue({ affected: 0 });
      await expect(unknown.tokens.claim('scan-1', H, NOW)).resolves.toBe(
        'invalid',
      );

      const expired = repository(row());
      expired.query.execute.mockResolvedValue({ affected: 0 });
      await expect(expired.tokens.claim('scan-1', H, LATER)).resolves.toBe(
        'invalid',
      );
    });

    it('a malformed hash is invalid without a write', async () => {
      const { query, tokens } = repository();

      await expect(tokens.claim('scan-1', 'nothex', NOW)).resolves.toBe(
        'invalid',
      );
      expect(query.execute).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('one conditional UPDATE on the claim it gives back: affected 1 is released', async () => {
      const { query, tokens } = repository();

      await expect(tokens.release(H, NOW)).resolves.toBe(true);
      expect(query.update).toHaveBeenCalledTimes(1);
      expect(query.set).toHaveBeenCalledWith({ usedAt: null });
      expect(query.where).toHaveBeenCalledWith({ tokenHash: H, usedAt: NOW });
      expect(query.execute).toHaveBeenCalledTimes(1);
    });

    it('affected 0 (another claim, or no row) releases nothing', async () => {
      const { query, tokens } = repository();
      query.execute.mockResolvedValue({ affected: 0 });

      await expect(tokens.release(H, NOW)).resolves.toBe(false);
    });

    it('a malformed hash releases nothing, without a write', async () => {
      const { query, tokens } = repository();

      await expect(tokens.release('nothex', NOW)).resolves.toBe(false);
      expect(query.execute).not.toHaveBeenCalled();
    });
  });

  describe('spentAt', () => {
    it('one IN query: when each spent container spent its token', async () => {
      const { repo, tokens } = repository();
      repo.find.mockResolvedValue([{ containerId: 'c-1', usedAt: NOW }]);

      const spent = await tokens.spentAt(['c-1', 'c-2']);

      expect(spent).toEqual(new Map([['c-1', NOW]]));
      expect(repo.find).toHaveBeenCalledTimes(1);
      const [options] = repo.find.mock.calls[0];
      expect(options.select).toEqual({ containerId: true, usedAt: true });
      expect(options.where.usedAt).toMatchObject({ type: 'not' });
    });

    it('no container: no query, an empty map', async () => {
      const { repo, tokens } = repository();

      await expect(tokens.spentAt([])).resolves.toEqual(new Map());
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('spentContainers', () => {
    it('one IN query on the spent tokens of the containers', async () => {
      const { repo, tokens } = repository();
      repo.find.mockResolvedValue([
        { containerId: 'c-1' },
        { containerId: 'c-3' },
      ]);

      const spent = await tokens.spentContainers(['c-1', 'c-2', 'c-3']);

      expect(spent).toEqual(new Set(['c-1', 'c-3']));
      expect(repo.find).toHaveBeenCalledTimes(1);
      const [options] = repo.find.mock.calls[0];
      expect(options.select).toEqual({ containerId: true });
      expect(options.where.containerId).toMatchObject({
        type: 'in',
        value: ['c-1', 'c-2', 'c-3'],
      });
      expect(options.where.usedAt).toMatchObject({ type: 'not' });
    });

    it('no container: no query, an empty set', async () => {
      const { repo, tokens } = repository();

      await expect(tokens.spentContainers([])).resolves.toEqual(new Set());
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
