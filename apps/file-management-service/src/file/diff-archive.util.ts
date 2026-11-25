import * as path from 'path';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { shouldExcludeFile } from '../core/data/filter-patterns';
import { isScannerConfigurationFile } from './scanner-config-files';

export interface DiffArchiveCaps {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/**
 * A single entry of the uploaded diff ZIP, as listed by the reader.
 * `size` is the (real) uncompressed byte count — directory entries carry 0.
 */
export interface DiffZipEntry {
  path: string;
  size: number;
}

/**
 * Defensive backstop on the RAW entry count: well above any legitimate diff
 * (the effective cap is `maxFiles` on the kept files, default 300), it only
 * rejects pathological archives so the validation loop never iterates an
 * unbounded list. The real "too many files" decision is made on the
 * post-filter count below.
 */
const MAX_RAW_DIFF_FILES = 50_000;

function invalid(message: string): never {
  throw new RpcException({ code: status.INVALID_ARGUMENT, message });
}

/**
 * A ZIP entry path is unsafe if it escapes the repo
 * root (traversal / absolute) or forges a `.git` tree (which would let the
 * agent drive gitleaks history mode). Such entries are REJECTED, not silently
 * dropped — the agent built this archive, so an unsafe path is suspicious.
 */
export function isUnsafeDiffPath(p: string): boolean {
  if (!p || typeof p !== 'string') return true;
  const norm = path.posix.normalize(p.replaceAll('\\', '/'));
  if (
    norm.startsWith('..') ||
    norm.includes('../') ||
    path.posix.isAbsolute(norm)
  ) {
    return true;
  }
  if (norm === '.git' || norm.startsWith('.git/')) return true;
  return false;
}

/**
 * Validate the entries of the agent-uploaded diff ZIP and return the
 * subset that should be scanned. Throws INVALID_ARGUMENT on caps violations or
 * unsafe paths (the cron marks the scan `failed` so the agent can fall back to
 * a full scan). Directory entries are ignored; files matching the standard
 * exclusion patterns (node_modules, …) are dropped before the size/count caps
 * so an excluded blob never pushes an otherwise-small diff over a cap.
 *
 * This mirrors the pre-upload `selectDiffFiles`, but operates on the
 * uploaded archive's entries (path + uncompressed size) instead of inline file
 * content — the file bytes no longer transit /mcp or gRPC.
 */
export function validateDiffZipEntries(
  entries: DiffZipEntry[],
  caps: DiffArchiveCaps,
): string[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    invalid('The uploaded diff archive is empty');
  }
  // Pathological-input guard only — the real "too many files" cap is enforced on
  // the post-filter count below.
  if (entries.length > MAX_RAW_DIFF_FILES) {
    invalid(
      `Too many entries in the diff archive (${entries.length} > ${MAX_RAW_DIFF_FILES}); run a full scan instead`,
    );
  }

  let total = 0;
  const accepted: string[] = [];
  for (const entry of entries) {
    const rawPath = entry?.path;
    // Skip directory entries (no content to scan).
    if (typeof rawPath === 'string' && rawPath.endsWith('/')) continue;
    if (isUnsafeDiffPath(rawPath)) {
      invalid(`Unsafe path in the diff archive: ${rawPath}`);
    }
    // Drop excluded files (node_modules, dist, build artefacts) BEFORE the size
    // checks so they never count toward the per-file / aggregate caps.
    const normalized = path.posix.normalize(rawPath.replaceAll('\\', '/'));
    if (shouldExcludeFile(normalized)) continue;
    // A scanner's own configuration is never forwarded (see
    // SCANNER_CONFIGURATION_FILES): it is not scanned and counts toward no cap.
    if (isScannerConfigurationFile(normalized)) continue;
    const size = entry.size ?? 0;
    if (size > caps.maxFileBytes) {
      invalid(
        `File ${normalized} is too large (${size} > ${caps.maxFileBytes} bytes); run a full scan instead`,
      );
    }
    total += size;
    if (total > caps.maxTotalBytes) {
      invalid(
        `Changed files exceed the aggregate size cap (${caps.maxTotalBytes} bytes); run a full scan instead`,
      );
    }
    accepted.push(normalized);
  }

  // Enforce the file-count cap on the KEPT files (post-exclusion).
  if (accepted.length > caps.maxFiles) {
    invalid(
      `Too many changed files (${accepted.length} > ${caps.maxFiles}); run a full scan instead`,
    );
  }
  if (accepted.length === 0) {
    invalid('No scannable files in the diff archive after filtering');
  }
  return accepted;
}
