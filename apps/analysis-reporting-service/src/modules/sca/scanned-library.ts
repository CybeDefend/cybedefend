/**
 * Interface for a library detected by a scanner.
 */
export interface ScannedLibrary {
  name: string;
  version: string; // Can be a concrete version OR a range specifier
  ecosystem: string;
}
