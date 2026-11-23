import { SelectQueryBuilder } from 'typeorm';

/**
 * Apply the priority filter on a detection query so legacy detections stay
 * visible.
 *
 * Older rows were created with currentPriority = '' (the column's
 * DEFAULT '' from CreateInitialTables) and were never re-priced by
 * CvssRecalculationProcessor.recomputePrioritiesForProject. A strict
 * `currentPriority IN (:...priority)` would drop them from the listing
 * entirely, surfacing total=0 on the detail view while vulnCountByType still
 * reports the real count. The OR on '' / NULL keeps them visible until the
 * next Security Context update or EPSS sync triggers a runtime recalc.
 */
export function applyPriorityFilter(
  qb: SelectQueryBuilder<unknown>,
  priority: string[] | null | undefined,
  detectionAlias: string,
): void {
  if (!priority || priority.length === 0) {
    return;
  }
  qb.andWhere(
    `(${detectionAlias}.currentPriority IN (:...priority) OR ${detectionAlias}.currentPriority = '' OR ${detectionAlias}.currentPriority IS NULL)`,
    { priority },
  );
}
