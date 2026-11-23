import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeHmacHex,
  verifyHmacSignature,
  constantTimeStringEquals,
} from './webhook-verify.util';

describe('webhook-verify.util', () => {
  // --------------------------------------------------------------
  // computeHmacHex
  // --------------------------------------------------------------
  describe('computeHmacHex', () => {
    it('matches Node crypto reference HMAC-SHA256 hex output', () => {
      const body = Buffer.from('{"a":1}');
      const secret = 'super-secret';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      expect(computeHmacHex(body, secret)).toBe(expected);
    });

    it('hashes raw bytes (not re-serialized JSON)', () => {
      // Whitespace inside JSON string changes the bytes — both should produce
      // different HMACs. This is the GitHub re-serialization bypass surface.
      const body1 = Buffer.from('{"a":1}');
      const body2 = Buffer.from('{ "a" : 1 }');
      const secret = 's';

      expect(computeHmacHex(body1, secret)).not.toBe(
        computeHmacHex(body2, secret),
      );
    });
  });

  // --------------------------------------------------------------
  // verifyHmacSignature — constant-time HMAC compare
  // --------------------------------------------------------------
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

    it('rejects an invalid signature of correct length', () => {
      const tampered = '0'.repeat(validHex.length);
      expect(verifyHmacSignature(body, tampered, secret)).toBe(false);
    });

    it('rejects a signature with wrong length without throwing', () => {
      expect(verifyHmacSignature(body, 'short', secret)).toBe(false);
      expect(verifyHmacSignature(body, validHex + 'aa', secret)).toBe(false);
    });

    it('rejects when signature is missing or empty', () => {
      expect(verifyHmacSignature(body, '', secret)).toBe(false);
      expect(verifyHmacSignature(body, undefined as any, secret)).toBe(false);
      expect(verifyHmacSignature(body, null as any, secret)).toBe(false);
    });

    it('strips an "sha256=" prefix from the candidate signature', () => {
      const prefixed = 'sha256=' + validHex;
      expect(verifyHmacSignature(body, prefixed, secret)).toBe(true);
    });

    it('does not throw when length differs (fast-fail before timingSafeEqual)', () => {
      // crypto.timingSafeEqual throws on unequal-length buffers; the helper
      // must short-circuit so callers can rely on a boolean return.
      expect(() => verifyHmacSignature(body, 'short', secret)).not.toThrow();
      expect(() =>
        verifyHmacSignature(body, validHex + 'aa', secret),
      ).not.toThrow();
    });
  });

  // --------------------------------------------------------------
  // constantTimeStringEquals — for plain-token (e.g. GitLab) compares
  // --------------------------------------------------------------
  describe('constantTimeStringEquals', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeStringEquals('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of equal length', () => {
      expect(constantTimeStringEquals('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths without throwing', () => {
      expect(constantTimeStringEquals('a', 'aa')).toBe(false);
    });

    it('returns false for empty / nullish inputs', () => {
      expect(constantTimeStringEquals('', '')).toBe(false);
      expect(constantTimeStringEquals('a', '')).toBe(false);
      expect(constantTimeStringEquals('', 'a')).toBe(false);
      expect(constantTimeStringEquals(undefined as any, 'a')).toBe(false);
      expect(constantTimeStringEquals('a', undefined as any)).toBe(false);
    });

    it('does not throw on unequal-length inputs (length fast-fail)', () => {
      expect(() => constantTimeStringEquals('a', 'aaaa')).not.toThrow();
    });
  });

  // --------------------------------------------------------------
  // Anti-regression: enforce that the implementation file uses the
  // node:crypto timing-safe comparison primitive.
  //
  // This guards against a future refactor that switches back to a
  // naive `===` / `!==` compare, which leaks timing.
  // --------------------------------------------------------------
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
