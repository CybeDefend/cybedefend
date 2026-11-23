import { describe, expect, it } from 'vitest';

import { initialsOf } from './initials';

/** The letters on an avatar disc without a picture (the organisation header of the AppSec rail, the account row). */
describe('initialsOf', () => {
  it('takes the first letter of the first two words, in capitals', () => {
    expect(initialsOf('Acme Corp')).toBe('AC');
    expect(initialsOf('acme corp sas')).toBe('AC');
    expect(initialsOf('  Ada   Lovelace ')).toBe('AL');
  });

  it('takes one letter for one word, and a question mark for no name', () => {
    expect(initialsOf('CybeDefend')).toBe('C');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});
