import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it.each([
    '12345678-9abc-4def-8123-456789abcdef',
    '12345678-9ABC-4DEF-8123-456789ABCDEF',
    // Any version: the gateway's own pipe accepts them all.
    '00000000-0000-1000-8000-000000000000',
  ])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a word', 'integration'],
    ['a path', '../organization/settings'],
    ['a UUID followed by a path', '12345678-9abc-4def-8123-456789abcdef/../x'],
    ['a UUID after a path', '../12345678-9abc-4def-8123-456789abcdef'],
    ['a UUID with a query', '12345678-9abc-4def-8123-456789abcdef?a=b'],
    ['a UUID on a second line', 'x\n12345678-9abc-4def-8123-456789abcdef'],
    ['a short one', '12345678-9abc-4def-8123'],
    ['an encoded slash', '12345678-9abc-4def-8123-456789abcdef%2F..'],
  ])('refuses %s', (_case, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}]])('refuses %s', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
