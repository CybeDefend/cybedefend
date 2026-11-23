import { describe, it, expect } from 'vitest';
import {
    buildImageReference,
    imageReferenceSuffix,
} from './containerImageReference';

const FULL_DIGEST = `sha256:${'a'.repeat(64)}`;

describe('imageReferenceSuffix', () => {
    it('joins a normal tag with ":"', () => {
        expect(imageReferenceSuffix({ name: 'v1.0.1' })).toBe(':v1.0.1');
    });

    it('joins a digest-identified tag with "@" and never with ":"', () => {
        const suffix = imageReferenceSuffix({
            name: FULL_DIGEST,
            digest: FULL_DIGEST,
            isDigest: true,
        });
        expect(suffix).toBe(`@${FULL_DIGEST}`);
        expect(suffix).not.toContain(':sha256:');
    });

    it('uses the FULL digest even when the displayed name is truncated (GHCR)', () => {
        // GHCR rows show `sha256:5e2b1` for readability; the reference must
        // still carry the untruncated digest or the registry cannot resolve it.
        expect(
            imageReferenceSuffix({
                name: 'sha256:5e2b1',
                digest: FULL_DIGEST,
                isDigest: true,
            }),
        ).toBe(`@${FULL_DIGEST}`);
    });

    it('treats a name that IS a full digest as a digest even without the flag', () => {
        // Defence in depth: a normalizer we do not own may forget isDigest —
        // emitting `repo:sha256:<hex>` is the production bug we are killing.
        expect(imageReferenceSuffix({ name: FULL_DIGEST })).toBe(
            `@${FULL_DIGEST}`,
        );
    });

    it('falls back to the caller default when no tag is selected', () => {
        expect(imageReferenceSuffix(undefined, 'latest')).toBe(':latest');
    });

    it('emits nothing when no tag is selected and no default is given', () => {
        expect(imageReferenceSuffix(undefined)).toBe('');
    });
});

describe('buildImageReference', () => {
    it('appends a tag to the repository', () => {
        expect(
            buildImageReference('registry.example.com/org/app', {
                name: 'v2',
            }),
        ).toBe('registry.example.com/org/app:v2');
    });

    it('appends an untagged image digest with "@"', () => {
        const ref = buildImageReference(
            '123456789012.dkr.ecr.eu-west-1.amazonaws.com/app',
            { name: FULL_DIGEST, digest: FULL_DIGEST, isDigest: true },
        );
        expect(ref).toBe(
            `123456789012.dkr.ecr.eu-west-1.amazonaws.com/app@${FULL_DIGEST}`,
        );
        expect(ref).not.toContain(':sha256:');
    });

    // GHCR has no tag-selection surface yet, so this composition — the exact one
    // `GitHubContainerRegistryModal.handleSelectImage` performs — is the only
    // place it can be pinned. The row is shaped like `normalizeGithubTag`'s
    // output for an untagged version: a name truncated for DISPLAY, and the full
    // digest beside it. Rebuilding `{ name }` from that row (which the modal used
    // to do) would copy `ghcr.io/org/app:sha256:5e2b1` — wrong separator AND a
    // digest no registry can resolve.
    it('appends an untagged GHCR version with "@" and its untruncated digest', () => {
        const ref = buildImageReference('ghcr.io/org/app', {
            name: 'sha256:5e2b1',
            digest: FULL_DIGEST,
            isDigest: true,
        });
        expect(ref).toBe(`ghcr.io/org/app@${FULL_DIGEST}`);
        expect(ref).not.toContain(':sha256:');
    });

    it('leaves the repository bare when there is no tag and no default', () => {
        expect(buildImageReference('org/app')).toBe('org/app');
    });
});
