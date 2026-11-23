import { normalizeImageReference } from './image-reference.util';

describe('normalizeImageReference', () => {
  it('preserves an uppercase tag while lowercasing the repository', () => {
    expect(normalizeImageReference('myOrg/myImage:PROD')).toBe(
      'myorg/myimage:PROD',
    );
  });

  it('lowercases a bare repository that has no tag', () => {
    expect(normalizeImageReference('MyOrg/MyImage')).toBe('myorg/myimage');
  });

  it('does not treat a registry port as a tag', () => {
    expect(normalizeImageReference('Registry.io:5000/Org/Repo')).toBe(
      'registry.io:5000/org/repo',
    );
  });

  it('preserves the tag on a reference that also carries a registry port', () => {
    expect(
      normalizeImageReference('Registry.io:5000/Org/Repo:Release-2024'),
    ).toBe('registry.io:5000/org/repo:Release-2024');
  });

  it('keeps a mixed-case tag with dots and dashes', () => {
    expect(normalizeImageReference('ghcr.io/Owner/App:v1.2.3-RC1')).toBe(
      'ghcr.io/owner/app:v1.2.3-RC1',
    );
  });

  it('preserves the tag and lowercases repo + digest when both are present', () => {
    expect(normalizeImageReference('Owner/Repo:PROD@sha256:ABCDEF1234')).toBe(
      'owner/repo:PROD@sha256:abcdef1234',
    );
  });

  it('lowercases a digest-only reference (no tag)', () => {
    expect(normalizeImageReference('Owner/Repo@sha256:ABCDEF1234')).toBe(
      'owner/repo@sha256:abcdef1234',
    );
  });
});
