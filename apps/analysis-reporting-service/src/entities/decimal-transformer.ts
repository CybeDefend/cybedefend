/**
 * TypeORM column transformer that converts the raw `string` returned by the
 * MySQL driver for DECIMAL columns into a JavaScript `number` on read, and
 * passes the value through unchanged on write.
 *
 * Without this, comparing a stored decimal (e.g. '0.50') against a computed
 * `number` (e.g. 0.5) is always false (string ≠ number), which made the
 * Dirty-check on `exploitabilityScore`/`cvss4*Score`/`epssScore`
 * never short-circuit and bumped `exploitabilityUpdatedAt` on every recalc
 * — silently breaking `exploitabilityStale`. priorityScore already had this
 * transformer; we lift it to a shared helper so the contract is uniform
 * across all detection entities.
 */
export const decimalToNumberTransformer = {
  to: (value: number | null | undefined): number | null =>
    value === undefined || value === null ? null : value,
  from: (value: string | number | null): number | null => {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' ? value : Number(value);
  },
};
