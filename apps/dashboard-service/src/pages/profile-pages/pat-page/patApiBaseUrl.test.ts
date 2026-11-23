import { describe, expect, it } from 'vitest';
import { patApiBaseUrl } from './patApiBaseUrl';

/**
 * The API the token guide's examples call: the build's own setting first, then
 * the edition's public API, and without one (the Community Edition) the
 * instance itself, whose gateway is served under `/api`.
 */
describe('patApiBaseUrl', () => {
  it('takes the build setting first', () => {
    expect(patApiBaseUrl({ envUrl: 'https://api.example.com', editionUrl: 'https://cloud.example.com', origin: 'https://ce.example.com' })).toBe(
      'https://api.example.com',
    );
  });

  it("takes the edition's public API without a build setting", () => {
    expect(patApiBaseUrl({ envUrl: '', editionUrl: 'https://cloud.example.com', origin: 'https://ce.example.com' })).toBe('https://cloud.example.com');
  });

  it('takes the instance origin and /api in the Community Edition', () => {
    expect(patApiBaseUrl({ envUrl: undefined, editionUrl: null, origin: 'https://ce.example.com' })).toBe('https://ce.example.com/api');
  });
});
