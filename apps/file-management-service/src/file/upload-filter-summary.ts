import type {
  ExcludedFolder,
  UploadFilterSummary,
} from '@grpc/security-scanning/scan';
import { excludePatterns } from '../core/data/filter-patterns';

/**
 * What the upload filter left out of an archive is recorded on the scan and
 * shown with it, so a scan never looks complete when files were not read.
 * The record stays small: counts by reason, and the excluded folders that
 * held the most files, each named by its path in the archive up to and
 * including the excluded folder (`web/build`), never a list of files nor any
 * content.
 */

/** Excluded folders named in a summary, the largest first. */
export const MAX_EXCLUDED_FOLDERS = 20;

/** Characters of an excluded folder's path kept in a summary. */
export const MAX_FOLDER_NAME_LENGTH = 200;

/** Folder names the filter leaves out wherever they are, as written. */
const EXCLUDED_DIRECTORIES = new Set(
  excludePatterns.filter((p) => p.type === 'directory').map((p) => p.pattern),
);

/** Folder names the filter leaves out whatever their case. */
const EXCLUDED_DIRECTORIES_ANY_CASE = new Set([
  'node_modules',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
]);

function isExcludedDirectory(segment: string): boolean {
  return (
    EXCLUDED_DIRECTORIES.has(segment) ||
    EXCLUDED_DIRECTORIES_ANY_CASE.has(segment.toLowerCase())
  );
}

/**
 * The outermost excluded folder of an entry left out for its place in the
 * tree (`web/build` for `web/build/assets/app.js`), or null when the entry
 * was left out for its own name or type.
 */
export function excludedFolderOf(entryPath: string): string | null {
  const segments = entryPath.split('/');
  // The last segment is the file itself.
  for (let i = 0; i < segments.length - 1; i++) {
    if (isExcludedDirectory(segments[i])) {
      return segments.slice(0, i + 1).join('/');
    }
  }
  return null;
}

/** `name` cut to MAX_FOLDER_NAME_LENGTH characters, never inside one. */
function boundedName(name: string): string {
  const characters = [...name];
  return characters.length > MAX_FOLDER_NAME_LENGTH
    ? characters.slice(0, MAX_FOLDER_NAME_LENGTH).join('')
    : name;
}

/** Counts what the filter leaves out of one archive, entry by entry. */
export class UploadFilterSummaryBuilder {
  private readonly counts = {
    scannerConfiguration: 0,
    excludedPath: 0,
    excludedType: 0,
    unsafeName: 0,
    gitMetadata: 0,
  };
  // Bounded by the number of entries, which the archive limits bound.
  private readonly folders = new Map<string, number>();

  scannerConfiguration(): void {
    this.counts.scannerConfiguration++;
  }

  excludedType(): void {
    this.counts.excludedType++;
  }

  unsafeName(): void {
    this.counts.unsafeName++;
  }

  gitMetadata(): void {
    this.counts.gitMetadata++;
  }

  /** An entry left out for its place in the tree, or a name pattern. */
  excludedPath(entryPath: string): void {
    this.counts.excludedPath++;
    const folder = excludedFolderOf(entryPath);
    if (folder === null) return;
    const name = boundedName(folder);
    this.folders.set(name, (this.folders.get(name) ?? 0) + 1);
  }

  /** The bounded summary: every count, the largest folders only. */
  summary(): UploadFilterSummary {
    const excludedFolders: ExcludedFolder[] = [...this.folders]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) =>
        b.count !== a.count ? b.count - a.count : a.name < b.name ? -1 : 1,
      )
      .slice(0, MAX_EXCLUDED_FOLDERS);
    return { ...this.counts, excludedFolders };
  }
}
