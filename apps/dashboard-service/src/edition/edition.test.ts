import { describe, expect, it } from 'vitest';
import { EDITIONS, parseEdition } from './edition';

describe('parseEdition', () => {
  it('reads an unset VITE_EDITION as cloud', () => {
    expect(parseEdition(undefined)).toBe('cloud');
    expect(parseEdition('')).toBe('cloud');
  });

  it.each(['community', 'cloud', 'enterprise'] as const)('accepts %s', (value) => {
    expect(parseEdition(value)).toBe(value);
  });

  it('refuses any other value with a message naming the variable', () => {
    expect(() => parseEdition('ce')).toThrow(
      'VITE_EDITION must be one of community, cloud, enterprise (got "ce")',
    );
  });

  it('lists the three editions', () => {
    expect(EDITIONS).toEqual(['community', 'cloud', 'enterprise']);
  });
});
