import * as yauzl from 'yauzl';

/**
 * Pre-rewrite size gate for repository archives.
 *
 * The repo-scan worker used to gate on the COMPRESSED size of the downloaded
 * zipball, after the download and roughly 5× above the pod's memory limit —
 * which let a 1 GiB zipball holding 40 GiB of sources through, straight into a
 * rewrite that then had to be killed by the cgroup (exit 137).
 *
 * This gate is read from the zip's central directory: yauzl reports
 * `uncompressedSize` per entry without inflating a single byte, so summing it
 * costs one seek and no memory, and it is what actually bounds the work the
 * rewrite has to do.
 */

/** Total uncompressed bytes allowed in a repository archive: 5 GiB. */
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 5 * 1024 ** 3;

/**
 * Tuning override for {@link DEFAULT_MAX_UNCOMPRESSED_BYTES}, in bytes.
 *
 * A pure tuning variable with a safe code default, so — per the service
 * convention — it is deliberately NOT registered in the Joi validation schema.
 */
export const MAX_UNCOMPRESSED_BYTES_ENV = 'REPO_SCAN_MAX_UNCOMPRESSED_BYTES';

/** Resolve the configured ceiling, falling back to the code default. */
export function resolveMaxUncompressedBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[MAX_UNCOMPRESSED_BYTES_ENV];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_UNCOMPRESSED_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_UNCOMPRESSED_BYTES;
  }
  return parsed;
}

/**
 * Sum the uncompressed size of every entry in `inputPath`.
 *
 * Reads the central directory only — no entry is ever inflated, so this is
 * O(entries) in time and O(1) in memory whatever the archive holds.
 */
export async function sumUncompressedBytes(inputPath: string): Promise<number> {
  // `decodeStrings` is yauzl's default, spelled out because it is load-bearing
  // beyond decoding: it is what runs `validateFileName`, which refuses
  // zip-slip entry names (`..` segments, absolute paths, backslashes). Since
  // this gate runs before the rewrite, it is where a malicious archive is
  // actually turned away. `zip-processor.spec.ts` pins that refusal
  // end-to-end, not this call site individually: its zip-slip tests go red
  // only if this open AND the rewrite's both stop decoding, which is why each
  // site keeps `decodeStrings: true` explicit.
  const zipfile = await yauzl.openPromise(inputPath, {
    lazyEntries: true,
    decodeStrings: true,
  });
  let total = 0;
  for await (const entry of zipfile.eachEntry()) {
    total += entry.uncompressedSize;
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${bytes} bytes`;
}

/**
 * Refuse `inputPath` when its total uncompressed size exceeds `maxBytes`.
 *
 * @returns the measured total, so callers can log it.
 * @throws a deliberate, user-safe message (no raw exception text) naming both
 *   the measured size and the limit.
 */
export async function assertArchiveWithinUncompressedLimit(
  inputPath: string,
  maxBytes: number = resolveMaxUncompressedBytes(),
): Promise<number> {
  const total = await sumUncompressedBytes(inputPath);
  if (total > maxBytes) {
    throw new Error(
      `Repository archive is too large: ${formatBytes(total)} uncompressed ` +
        `exceeds the ${formatBytes(maxBytes)} limit`,
    );
  }
  return total;
}
