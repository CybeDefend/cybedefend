import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeHmacHex,
  verifyHmacSignature,
  constantTimeStringEquals,
} from './webhook-verify.util';

describe('webhook-verify.util (gateway copy)', () => {
  describe('computeHmacHex', () => {
    it('matches the Node crypto reference HMAC-SHA256 hex output', () => {
      const body = Buffer.from('{"a":1}');
      const secret = 'super-secret';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      expect(computeHmacHex(body, secret)).toBe(expected);
    });
  });

  describe('verifyHmacSignature', () => {
    const secret = 'shared-secret';
    const body = Buffer.from('payload-bytes');
    const validHex = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    it('accepts a valid signature', () => {
      expect(verifyHmacSignature(body, validHex, secret)).toBe(true);
    });

    it('rejects tampered signatures of correct length', () => {
      const tampered = '0'.repeat(validHex.length);
      expect(verifyHmacSignature(body, tampered, secret)).toBe(false);
    });

    it('rejects unequal-length signatures without throwing', () => {
      expect(() => verifyHmacSignature(body, 'short', secret)).not.toThrow();
      expect(verifyHmacSignature(body, 'short', secret)).toBe(false);
    });

    it('rejects empty / nullish candidate signatures', () => {
      expect(verifyHmacSignature(body, '', secret)).toBe(false);
      expect(verifyHmacSignature(body, undefined as any, secret)).toBe(false);
      expect(verifyHmacSignature(body, null as any, secret)).toBe(false);
    });
  });

  describe('constantTimeStringEquals', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeStringEquals('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of equal length', () => {
      expect(constantTimeStringEquals('abc', 'abd')).toBe(false);
    });

    it('returns false on length mismatch without throwing', () => {
      expect(() => constantTimeStringEquals('a', 'aaaa')).not.toThrow();
      expect(constantTimeStringEquals('a', 'aaaa')).toBe(false);
    });
  });

  describe('implementation must use crypto.timingSafeEqual', () => {
    it('source file references crypto.timingSafeEqual', () => {
      const src = fs.readFileSync(
        path.join(__dirname, 'webhook-verify.util.ts'),
        'utf-8',
      );
      expect(src).toContain('crypto.timingSafeEqual');
    });
  });
});
