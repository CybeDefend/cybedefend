import { allowedOriginsFrom, isOriginAllowed } from './origin-policy';

describe('allowedOriginsFrom', () => {
  const PUBLIC_URL = 'http://localhost:3010';

  it('allows only the service itself by default in the Community Edition', () => {
    const allowed = allowedOriginsFrom(undefined, PUBLIC_URL, 'community');

    expect(allowed).toEqual(new Set(['http://localhost:3010']));
    expect(isOriginAllowed('http://localhost:3010', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:8080', allowed)).toBe(false);
  });

  it('allows any origin by default in the other editions', () => {
    expect(allowedOriginsFrom(undefined, PUBLIC_URL, 'cloud')).toBe('*');
    expect(allowedOriginsFrom('', PUBLIC_URL, 'enterprise')).toBe('*');
  });

  it('takes the configured list, normalised, in every edition', () => {
    const allowed = allowedOriginsFrom(
      ' https://Agent.Example/ , http://localhost:6274/path,not a url',
      PUBLIC_URL,
      'cloud',
    );

    expect(allowed).toEqual(
      new Set([
        'https://agent.example',
        'http://localhost:6274',
        'http://localhost:3010',
      ]),
    );
  });

  it('takes a wildcard', () => {
    expect(
      allowedOriginsFrom('https://a.example,*', PUBLIC_URL, 'community'),
    ).toBe('*');
  });
});

describe('isOriginAllowed', () => {
  const allowed = new Set(['https://agent.example']);

  it.each([
    ['https://agent.example', true],
    ['https://AGENT.example', true],
    ['https://agent.example:443', true],
    ['http://agent.example', false],
    ['https://agent.example.evil.example', false],
    ['null', false],
    ['', false],
    ['file://', false],
  ])('%p → %p', (origin, expected) => {
    expect(isOriginAllowed(origin, allowed)).toBe(expected);
  });

  it('allows everything under a wildcard', () => {
    expect(isOriginAllowed('null', '*')).toBe(true);
  });
});
