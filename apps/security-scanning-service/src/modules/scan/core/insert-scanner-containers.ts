import type { Repository } from 'typeorm';
import { Container } from 'src/entities/container.entity';

/**
 * One INSERT, ids set by the caller, `.updateEntity(false)`.
 *
 * One INSERT, not `save`: on MySQL (no RETURNING) TypeORM saves an array of
 * this entity (generated uuid, column defaults) one INSERT and one SELECT per
 * row.
 *
 * The ids are set by the caller and nothing is read back. After a
 * multi-row INSERT, TypeORM re-selects the rows to read their defaults, with
 * no ORDER BY, and merges them into the entities by position, ids included:
 * each pod was then recorded on the row of another scanner.
 */
export async function insertScannerContainers(
  repo: Repository<Container>,
  rows: Container[],
): Promise<void> {
  await repo
    .createQueryBuilder()
    .insert()
    .into(Container)
    .values(rows)
    .updateEntity(false)
    .execute();
}
