/**
 * The ONE rule for reconciling two detection windows: `first_detected_at` takes
 * the EARLIER of the two, `last_detected_at` the LATER. A window only ever
 * widens.
 *
 * WHY IT LIVES IN ITS OWN LEAF MODULE. Three callers need it and they have
 * nothing else in common:
 *
 *   - `src/scripts/backfill-lifecycle.ts` reconciles its reconstruction with
 *     whatever the live write paths already stored, as `'YYYY-MM-DD HH:MM:SS'`
 *     literals on the session's timezone base (a string compare IS the
 *     chronological one there);
 *   - `sast-iac.utils.ts`'s line-drift repair merges a freshly-created row into
 *     an older one and then DELETES it, as `Date`s on entity columns;
 *   - anything else that ever merges two rows for the same finding.
 *
 * A second copy of "earlier wins / later wins" would drift, and the two sides
 * would then disagree about the same finding depending on which path last
 * touched it. Hence one generic function over both representations.
 *
 * The module deliberately imports NOTHING: `backfill-lifecycle.ts` is a
 * standalone `ts-node` script that never boots Nest, so anything it pulls in
 * must not drag the entity graph behind it.
 */

/** A bound as stored on an entity (`Date`) or as the backfill formats it. */
export type DetectionBound = string | Date;

export interface StoredBounds<T extends DetectionBound = string> {
  first: T | null;
  last: T | null;
}

export interface MergedBounds<T extends DetectionBound = string> {
  first: T | null;
  last: T | null;
  changed: boolean;
}

/** Value equality, so two distinct `Date` objects for one instant match. */
function sameBound(
  a: DetectionBound | null,
  b: DetectionBound | null,
): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return false;
}

function earlierOf(
  a: DetectionBound | null,
  b: DetectionBound | null,
): DetectionBound | null {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return a < b ? a : b;
}

function laterOf(
  a: DetectionBound | null,
  b: DetectionBound | null,
): DetectionBound | null {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return a > b ? a : b;
}

/**
 * Reconcile two windows for the same finding. Neither bound ever moves inward,
 * and a null on either side simply contributes nothing.
 *
 * For the backfill this is the "only ever ADD evidence" guarantee: the two
 * history tables record sightings, not all of them — container has no ingestion
 * trail at all, so replaying its reconstruction over a live re-detection stamp
 * would pin `last_detected_at` to row-creation time permanently, with no way to
 * self-heal. `--rebuild` bypasses this, for the one case it does not cover:
 * stored values that are themselves the damage. That is an operator decision,
 * never a default.
 *
 * @param stored - what the surviving row carries today.
 * @param computed - the other window (a reconstruction, or the row being merged
 *   in and deleted).
 */
// Two overloads rather than one type parameter: a generic constrained by
// `string | Date` makes TypeScript infer the STRING LITERAL of whatever the
// caller passes, so `{ first: '…35', last: '…36' }` fails to type-check against
// itself. The concrete signatures below never trigger literal inference.
export function mergeDetectionBounds(
  stored: StoredBounds<string>,
  computed: StoredBounds<string>,
): MergedBounds<string>;
export function mergeDetectionBounds(
  stored: StoredBounds<Date>,
  computed: StoredBounds<Date>,
): MergedBounds<Date>;
export function mergeDetectionBounds(
  stored: StoredBounds<DetectionBound>,
  computed: StoredBounds<DetectionBound>,
): MergedBounds<DetectionBound> {
  const first = earlierOf(stored.first, computed.first);
  const last = laterOf(stored.last, computed.last);
  return {
    first,
    last,
    changed: !sameBound(first, stored.first) || !sameBound(last, stored.last),
  };
}
