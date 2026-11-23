import type { SlotRegistration } from '@/edition/slots';

/** A scan type the core lists in the results page's tab row; each key is also its URL segment. */
export type CoreScannerTabKey = 'sast' | 'iac' | 'secret' | 'cicd' | 'sca' | 'container';

/**
 * The scanner tabs of the results list that the core lists itself, with their
 * place in the row. The closed tree adds its own through the
 * `project.tabs` slot: a registration whose id starts with `scanner:` adds a
 * tab to this list (its id's suffix is the tab's URL segment).
 */
export const CORE_SCANNER_TABS: readonly { key: CoreScannerTabKey; order: number }[] = [
  { key: 'sast', order: 10 },
  { key: 'iac', order: 20 },
  { key: 'cicd', order: 30 },
  { key: 'secret', order: 40 },
  { key: 'sca', order: 50 },
  { key: 'container', order: 60 },
];

/** The `project.tabs` registration ids that add a tab to the results scanner list. */
export const SCANNER_TAB_SLOT_PREFIX = 'scanner:';

/** True for a `project.tabs` registration that belongs to the scanner list, not the section nav. */
export const isScannerTabEntry = (entry: SlotRegistration): boolean =>
  entry.id.startsWith(SCANNER_TAB_SLOT_PREFIX);

/** The URL segment of a scanner-list tab registration: its id past the prefix. */
export const scannerTabSegment = (id: string): string => id.slice(SCANNER_TAB_SLOT_PREFIX.length);
