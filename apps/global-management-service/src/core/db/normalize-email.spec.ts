import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail(' Jane.Doe@ACME.io ')).toBe('jane.doe@acme.io');
  });

  it('returns an already normalised address unchanged', () => {
    expect(normalizeEmail('jane.doe@acme.io')).toBe('jane.doe@acme.io');
  });
});
