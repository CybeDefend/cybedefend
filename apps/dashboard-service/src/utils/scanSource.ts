/**
 * Where a project's last scan came from, as global-management stores it
 * (`project.lastScanSourceType`, enum `ScanSourceType`). The API hands it over
 * as a plain string, and the backend list grows (the JetBrains and VS Code
 * plugins were added after the dashboard learned the first four): a value this
 * list does not know reads « Other source », never a raw translation key.
 */
export const SCAN_SOURCES = ['manual', 'cli', 'github', 'gitlab', 'jetbrains', 'vscode'] as const;

export type ScanSource = (typeof SCAN_SOURCES)[number];

const KNOWN: ReadonlySet<string> = new Set(SCAN_SOURCES);

export function isKnownScanSource(value: unknown): value is ScanSource {
  return typeof value === 'string' && KNOWN.has(value);
}

/** The translation key naming a scan source, for any value the API sends. */
export function scanSourceLabelKey(source: string | null | undefined): string {
  return isKnownScanSource(source) ? `components.scanSourceBadge.${source}` : 'components.scanSourceBadge.other';
}
