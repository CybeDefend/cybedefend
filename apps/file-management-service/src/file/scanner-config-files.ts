import * as path from 'node:path';

/**
 * Files a scanner reads as its own configuration when it finds them in the
 * tree it scans. Whoever can commit a file to a scanned repository could use
 * one to switch detection off (load no rule, skip files, disable checks), and
 * the next scan would then report the existing findings as fixed. So they are
 * removed, wherever they are in the tree, from every archive forwarded to the
 * scanners: full uploads and diff uploads alike.
 *
 * The complete answer is a configuration owned by the instance and passed to
 * each scanner, so that no file of the scanned tree is read as configuration;
 * that belongs to the scanner images.
 *
 * Matched on the file name alone (the last path segment), exactly.
 */
export const SCANNER_CONFIGURATION_FILES: readonly string[] = Object.freeze([
  '.gitleaks.toml',
  'gitleaks.toml',
  'trivy.yaml',
  'trivy.yml',
  'zizmor.yml',
  'zizmor.yaml',
  '.checkov.yaml',
  '.checkov.yml',
]);

const CONFIGURATION = new Set(SCANNER_CONFIGURATION_FILES);

function fileName(entryPath: string): string {
  return path.posix.basename(entryPath.replaceAll('\\', '/'));
}

/** Whether `entryPath` is a scanner configuration file (removed). */
export function isScannerConfigurationFile(entryPath: string): boolean {
  return CONFIGURATION.has(fileName(entryPath));
}
