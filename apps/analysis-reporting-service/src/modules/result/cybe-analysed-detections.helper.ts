import { ObjectLiteral, Repository } from 'typeorm';
import { caseSensitiveEquals } from '@cybedefend/db-dialect';

/**
 * The userId the AI agent writes on the history rows of the detections it
 * analysed.
 */
export const CYBE_AGENT_USER_ID = 'system';

/**
 * Ids of the given detections that the AI agent analysed: at least one history
 * row written by userId 'system'. One query for the detections of a page,
 * shared by the grouped views and the slim (MCP) lists, which do not load the
 * history itself.
 *
 * `userId` is compared byte for byte (`caseSensitiveEquals`), the SQL form
 * of the JS rule `h.userId === 'system'` the detection mappers apply to the
 * loaded history (`hasCybeAnalysis` in sast-iac.mapper.ts and sca.mapper.ts):
 * the column's collation (utf8mb4_0900_ai_ci) would let a plain `=` match
 * 'SYSTEM' too.
 *
 * The repository is a detection table whose entity has a `historyItems`
 * relation and a `projectId` column (SAST, IaC, CICD, Secret, SCA,
 * container).
 */
export async function findCybeAnalysedDetectionIds<T extends ObjectLiteral>(
  repository: Repository<T>,
  projectId: string,
  detectionIds: string[],
): Promise<Set<string>> {
  if (detectionIds.length === 0) return new Set();
  const rows = await repository
    .createQueryBuilder('analysed')
    .select('analysed.id', 'id')
    .innerJoin('analysed.historyItems', 'history')
    .where('analysed.id IN (:...detectionIds)', { detectionIds })
    // Keeps the query on the project's rows even when a long id list makes
    // MySQL drop the IN range (range_optimizer_max_mem_size).
    .andWhere('analysed.projectId = :projectId', { projectId })
    .andWhere(
      caseSensitiveEquals('history.userId', `'${CYBE_AGENT_USER_ID}'`).text,
    )
    .distinct(true)
    .getRawMany<{ id: string }>();
  return new Set(rows.map((row) => row.id));
}
