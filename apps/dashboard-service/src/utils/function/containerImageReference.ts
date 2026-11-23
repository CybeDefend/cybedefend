/**
 * Minimal structural shape of a registry tag row, so this module stays free of
 * the registry hooks (and their services) — `ContainerImageTag` satisfies it.
 */
export interface ImageTagReference {
    name: string;
    digest?: string;
    /** True when the row identifies an UNTAGGED image, i.e. only its digest. */
    isDigest?: boolean;
}

/** A complete sha256 digest — the only form a registry can resolve. */
const FULL_SHA256 = /^sha256:[0-9a-f]{64}$/i;

/**
 * The `:tag` / `@digest` part of an image reference.
 *
 * An untagged image (very common on ECR, where pushing over a tag orphans the
 * previous manifest) is surfaced in the UI with its digest as the row label.
 * Concatenating that label with ':' produced `repo:sha256:<hex>`, which is not
 * a valid reference: the registry parses the LAST ':' as the tag separator, so
 * the repository became `repo:sha256` and AWS answered 400
 * InvalidParameterException. A digest is only addressable with '@'.
 *
 * @param fallbackTag emitted (as a tag) when no row is selected at all — e.g.
 * 'latest' for the scan flows, omitted where a bare repository is legitimate.
 */
export const imageReferenceSuffix = (
    tag?: ImageTagReference,
    fallbackTag?: string,
): string => {
    const name = tag?.name?.trim() ?? '';
    const digest = tag?.digest?.trim() ?? '';

    // `isDigest` is authoritative, but a name that IS a full digest is treated
    // as one even without the flag: normalizers we do not own (or future
    // registries) must not be able to resurrect the ':sha256:' bug.
    const digestRef = digest || name;
    if (digestRef && (tag?.isDigest || FULL_SHA256.test(name))) {
        return `@${digestRef}`;
    }

    if (name) return `:${name}`;
    return fallbackTag ? `:${fallbackTag}` : '';
};

/**
 * Full image reference for a repository (host included when the caller has one)
 * and an optionally selected tag row.
 */
export const buildImageReference = (
    repository: string,
    tag?: ImageTagReference,
    fallbackTag?: string,
): string => `${repository}${imageReferenceSuffix(tag, fallbackTag)}`;
