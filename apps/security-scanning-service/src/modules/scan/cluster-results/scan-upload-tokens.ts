import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';

/**
 * The per-container upload token of a Community cluster scan.
 *
 * - A token is `cdst_` + 32 random bytes in base64url. Only the SHA-256 hex
 *   of the whole string is stored; the token itself is handed to the pod's
 *   Secret by the launcher and never kept, logged or returned again.
 * - It is valid until its `expiresAt`, and spent once: `claim` is one
 *   conditional UPDATE decided on its `affected` count, so two concurrent
 *   submits of one container import once. `release` gives a claim back
 *   (the same kind of UPDATE) when its import could not be queued.
 * - Nothing here logs a token or a hash.
 */

export const SCAN_TOKEN_PATTERN = /^cdst_[A-Za-z0-9_-]{43}$/;

const TOKEN_PREFIX = 'cdst_';
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The stored form of a token: the SHA-256 hex of the whole string. */
export function hashScanToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type ScanTokenRefusal = 'invalid' | 'used';

@Injectable()
export class ScanUploadTokens {
  constructor(
    @InjectRepository(ScanUploadToken)
    private readonly tokens: Repository<ScanUploadToken>,
  ) {}

  /** Mints the container's token; stores only its hash. One per container. */
  async mint(input: {
    scanId: string;
    containerId: string;
    category: string;
    severities: string;
    expiresAt: Date;
  }): Promise<string> {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    await this.tokens.insert({
      scanId: input.scanId,
      containerId: input.containerId,
      tokenHash: hashScanToken(token),
      category: input.category,
      severities: input.severities,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
    return token;
  }

  /**
   * The token's row, or why it is refused: `invalid` for an unknown hash, a
   * token of another scan or an expired one; `used` for a spent token of the
   * scan, expired or not (a retry after a lost answer is told it was
   * already submitted).
   */
  async authorize(
    scanId: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ row: ScanUploadToken } | { refused: ScanTokenRefusal }> {
    if (!HASH_PATTERN.test(tokenHash)) return { refused: 'invalid' };
    const row = await this.tokens.findOne({ where: { tokenHash } });
    if (!row || row.scanId !== scanId) return { refused: 'invalid' };
    if (row.usedAt) return { refused: 'used' };
    if (row.expiresAt.getTime() <= now.getTime()) {
      return { refused: 'invalid' };
    }
    return { row };
  }

  /**
   * UPDATE … SET usedAt=:now WHERE tokenHash=:h AND scanId=:s AND usedAt IS
   * NULL AND expiresAt > :now; affected === 1 is `claimed`. Otherwise `used`
   * when the scan's token is already spent, else `invalid`.
   */
  async claim(
    scanId: string,
    tokenHash: string,
    now: Date,
  ): Promise<'claimed' | ScanTokenRefusal> {
    if (!HASH_PATTERN.test(tokenHash)) return 'invalid';
    const result = await this.tokens
      .createQueryBuilder()
      .update(ScanUploadToken)
      .set({ usedAt: now })
      .where({
        tokenHash,
        scanId,
        usedAt: IsNull(),
        expiresAt: MoreThan(now),
      })
      .execute();
    if (result.affected === 1) return 'claimed';
    const row = await this.tokens.findOne({ where: { tokenHash } });
    return row && row.scanId === scanId && row.usedAt ? 'used' : 'invalid';
  }

  /**
   * Gives back the claim made at `claimedAt` (the import could not be
   * queued, so the runner's retry must be able to claim again). UPDATE … SET usedAt=NULL WHERE tokenHash=:h AND usedAt=:claimedAt;
   * true only when affected === 1, never a read first.
   */
  async release(tokenHash: string, claimedAt: Date): Promise<boolean> {
    if (!HASH_PATTERN.test(tokenHash)) return false;
    const result = await this.tokens
      .createQueryBuilder()
      .update(ScanUploadToken)
      .set({ usedAt: null })
      .where({ tokenHash, usedAt: claimedAt })
      .execute();
    return result.affected === 1;
  }

  /**
   * When each container among `containerIds` spent its token (its claim
   * time); containers with an unspent token are absent. One IN query.
   */
  async spentAt(containerIds: string[]): Promise<Map<string, Date>> {
    if (containerIds.length === 0) return new Map();
    const rows = await this.tokens.find({
      select: { containerId: true, usedAt: true },
      where: { containerId: In(containerIds), usedAt: Not(IsNull()) },
    });
    return new Map(rows.map((r) => [r.containerId, new Date(r.usedAt)]));
  }

  /** The containers among `containerIds` whose token is spent: one IN query. */
  async spentContainers(containerIds: string[]): Promise<Set<string>> {
    if (containerIds.length === 0) return new Set();
    const rows = await this.tokens.find({
      select: { containerId: true },
      where: { containerId: In(containerIds), usedAt: Not(IsNull()) },
    });
    return new Set(rows.map((r) => r.containerId));
  }
}
