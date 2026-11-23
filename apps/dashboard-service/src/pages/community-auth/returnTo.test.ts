import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('safeReturnTo', () => {
  it('keeps a path of this app, query and hash included', () => {
    expect(safeReturnTo('/project/abc?x=1#y')).toBe('/project/abc?x=1#y');
    expect(safeReturnTo('/')).toBe('/');
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'javascript:alert(1)',
    'https://evil.com',
    'evil.com',
    '/a b',
    '/a\u007f',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
    '',
  ])('refuses %j', (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it('refuses nothing given', () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
  });
});
