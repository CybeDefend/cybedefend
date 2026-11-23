import { describe, expect, it } from 'vitest';
import { shortDigest } from './shortDigest';

describe('shortDigest', () => {
  it('gives eight lowercase hex characters', () => {
    expect(shortDigest('12345678-9abc-4def-8123-456789abcdef')).toMatch(/^[0-9a-f]{8}$/);
    expect(shortDigest('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('gives the same digest for the same value, another one for another value', () => {
    expect(shortDigest('org-1')).toBe(shortDigest('org-1'));
    expect(shortDigest('org-1')).not.toBe(shortDigest('org-2'));
  });

  it('does not contain the value it stands for', () => {
    const id = '12345678-9abc-4def-8123-456789abcdef';
    expect(shortDigest(id)).not.toContain(id.slice(0, 8));
  });

  it('is FNV-1a over 32 bits: known vectors', () => {
    expect(shortDigest('')).toBe('811c9dc5');
    expect(shortDigest('a')).toBe('e40c292c');
    expect(shortDigest('foobar')).toBe('bf9cf968');
  });
});
