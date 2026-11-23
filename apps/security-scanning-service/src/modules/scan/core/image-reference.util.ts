/**
 * Normalize a Docker/OCI image reference for the container scanner.
 *
 * The registry host and repository path MUST be lowercase (OCI requirement),
 * but the TAG is case-sensitive and MUST be preserved. Blanket-lowercasing the
 * whole reference silently rewrote tags like `:PROD` / `:Release-2024` into a
 * tag that does not exist in the registry, which surfaced as a false
 * `IMAGE_NOT_FOUND` (exit 41) on every scan of such an image.
 *
 * A digest (`@sha256:<hex>`) is lowercase hex by spec, so it is lowercased too;
 * only the tag's case is preserved.
 */
export function normalizeImageReference(image: string): string {
  // Split off an optional digest so it never gets mistaken for a tag.
  const atIndex = image.indexOf('@');
  const ref = atIndex === -1 ? image : image.slice(0, atIndex);
  const digest = atIndex === -1 ? '' : image.slice(atIndex);

  // The tag is the substring after the LAST ':' that comes after the last '/'.
  // A ':' before the last '/' is a registry port, not a tag.
  const lastSlash = ref.lastIndexOf('/');
  const lastColon = ref.lastIndexOf(':');

  if (lastColon > lastSlash) {
    const repo = ref.slice(0, lastColon);
    const tag = ref.slice(lastColon + 1);
    return `${repo.toLowerCase()}:${tag}${digest.toLowerCase()}`;
  }

  return `${ref.toLowerCase()}${digest.toLowerCase()}`;
}
