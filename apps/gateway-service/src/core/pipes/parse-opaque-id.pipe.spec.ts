import { BadRequestException } from '@nestjs/common';

import { ParseOpaqueIdPipe } from './parse-opaque-id.pipe';

describe('ParseOpaqueIdPipe', () => {
  const pipe = new ParseOpaqueIdPipe();

  // Every id shape the upstream service produces must pass through
  // untouched — otherwise the gateway would 400 legitimate callers.
  it.each([
    ['category slug', 'category-alpha'],
    ['rule slug', 'rule-alpha-read'],
    ['slug with digits', 'example-2025-a01'],
    ['slug with an underscore', 'parent_category-2025'],
    ['32-hex-character id (no hyphens)', 'f47ac10b58cc4372a5670e02b2c3d479'],
    ['hyphenated uuid', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  ])('accepts a legitimate %s', (_label, id) => {
    expect(pipe.transform(id)).toBe(id);
  });

  // Anything carrying a path separator or dot-segment (post find-my-way
  // decode) or residual percent-encoding must be refused before it can be
  // interpolated into an upstream URL.
  it.each([
    ['decoded slash', '../../other/segment/x'],
    ['bare parent ref', '..'],
    ['single dot', '.'],
    ['backslash', '..\\..\\x'],
    ['residual double-encoding', '..%2f..%2fx'],
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['space', 'gr fs'],
  ])('rejects %s with 400', (_label, id) => {
    expect(() => pipe.transform(id as any)).toThrow(BadRequestException);
  });
});
