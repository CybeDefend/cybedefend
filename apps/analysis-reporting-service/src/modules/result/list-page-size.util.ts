/**
 * Largest page an explicit page size gets on a flat result
 * list (SAST, IaC, CICD, Secret, SCA, container). 500 and not 100: the IDE
 * extension asks for 500 rows in one call and does not page (cybedefend-ide
 * SecurityApiService.ts:260); lower it only once the IDE loops on
 * `totalPages`.
 */
export const MAX_LIST_PAGE_SIZE = 500;

/**
 * An explicit page size (> 0), clamped silently at {@link MAX_LIST_PAGE_SIZE}:
 * a public caller asking for more gets a shorter page, never a 400. Anything
 * else becomes 0, which the lists already read as "the whole list" — what an
 * absent `page_size_number` decodes to, and how policy-management reads every
 * finding after a scan (`fetchAllVulnerabilities`, no paging). Public callers
 * never send 0: the gateway always sets a page size.
 */
export function clampListPageSize(size: number | null | undefined): number {
  return size && size > 0 ? Math.min(size, MAX_LIST_PAGE_SIZE) : 0;
}
