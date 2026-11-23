/**
 * Parse a boolean query parameter from string.
 * Handles 'true', 'false', '1', '0' strings correctly.
 * Returns undefined if the value is not provided or invalid.
 *
 * @param value - The raw query parameter value (string | undefined)
 * @returns true, false, or undefined
 */
export function parseBooleanQuery(
  value: string | undefined | null,
): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  return undefined;
}
