import { describe, expect, it } from 'vitest';
import { IMPORT_IMAGE_MAX_LENGTH, IMPORT_IMAGE_PATTERN, isImportImage } from './importImage';

/**
 * The image of a container import: the
 * gateway's own rule, checked before any request. The gateway stays the
 * authority; this only spares a round trip.
 */
describe('isImportImage', () => {
  it.each([
    'nginx',
    'nginx:1.27',
    'ghcr.io/acme/api:v2',
    'registry.local:5000/team/app@sha256:' + 'a'.repeat(64),
    'library/redis:7.4-alpine',
  ])('%s is accepted', (v) => expect(isImportImage(v)).toBe(true));

  it.each([
    '',
    'NGINX',
    'nginx:',
    ' nginx',
    'nginx latest',
    'a/'.repeat(128) + 'b',
    'nginx@sha256:abc',
    'https://ghcr.io/acme/api',
  ])('%j is refused', (v) => expect(isImportImage(v)).toBe(false));

  it('refuses a reference longer than 255 characters, even one the pattern accepts', () => {
    const long = 'a'.repeat(IMPORT_IMAGE_MAX_LENGTH + 1);
    expect(IMPORT_IMAGE_PATTERN.test(long)).toBe(true);
    expect(isImportImage(long)).toBe(false);
    expect(isImportImage('a'.repeat(IMPORT_IMAGE_MAX_LENGTH))).toBe(true);
  });

  it('is the contract pattern, copied verbatim', () => {
    expect(IMPORT_IMAGE_PATTERN.source).toBe(
      String.raw`^(?:[a-z0-9.-]+(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$`,
    );
    expect(IMPORT_IMAGE_PATTERN.flags).toBe('');
  });
});
