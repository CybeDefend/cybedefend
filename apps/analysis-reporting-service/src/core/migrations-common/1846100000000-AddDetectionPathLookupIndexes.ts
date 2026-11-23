import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';
import { dialectApi, parseDialect, run } from '@cybedefend/db-dialect';

/**
 * An index on (projectId, branch, path)
 * on the four detection tables whose ingestion shares
 * `SastIacUtilsService.lookupThenCreateDetection`'s duplicate lookup
 * (projectId, scannerType, path, language, lines, branch).
 *
 * Without it the lookup used the (projectId, branch, fingerprint) unique
 * (MySQL) or the projectId index (PostgreSQL) and read every detection of the
 * branch, once per result: a 100,000-result SARIF import was quadratic and
 * took over an hour on both engines.
 *
 * MySQL: built online (ALGORITHM=INPLACE, LOCK=NONE), the cloud tables being
 * large. projectId and branch are varchar(255) and path is varchar(255) on
 * the SAST and IaC tables but varchar(1024) on the CI/CD and secret tables;
 * in utf8mb4 a full key would pass InnoDB's 3,072-byte limit there, so path
 * longer than 255 characters is indexed on its first 255 (1,022 + 1,023 +
 * 1,022 = 3,067 bytes). The prefix is chosen from the column's length read
 * back from the database.
 *
 * PostgreSQL: the full columns (TypeORM's schema API). A btree entry is
 * limited to 2,704 bytes after PostgreSQL's inline compression; an ASCII key
 * is at most 255 + 255 + 1,024 bytes, so only a path of several hundred
 * multi-byte, incompressible characters could reach it. The full column is
 * kept on the varchar(1024) CI/CD and secret tables too (coordinator's
 * decision): such a path would fail only the import that carries it.
 *
 * Idempotent both ways: an index that already exists is not created again,
 * one that does not is not dropped (the existence read is TypeORM's
 * getTable, scoped to the current database / schema).
 */
const INDEXES: ReadonlyArray<{ table: string; name: string }> = [
  {
    table: 'vulnerability_detections_sast',
    name: 'IDX_vd_sast_proj_branch_path',
  },
  {
    table: 'vulnerability_detections_iac',
    name: 'IDX_vd_iac_proj_branch_path',
  },
  {
    table: 'vulnerability_detections_cicd',
    name: 'IDX_vd_cicd_proj_branch_path',
  },
  {
    table: 'vulnerability_detections_secret',
    name: 'IDX_vd_secret_proj_branch_path',
  },
];

const COLUMNS = ['projectId', 'branch', 'path'];

/** MySQL key-part length of `path`: the whole column up to 255 characters. */
const MYSQL_PATH_PREFIX = 255;

export class AddDetectionPathLookupIndexes1846100000000 implements MigrationInterface {
  name = 'AddDetectionPathLookupIndexes1846100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const dialect = parseDialect(queryRunner.connection.options.type);
    for (const { table, name } of INDEXES) {
      const read = await queryRunner.getTable(table);
      if (!read || read.indices.some((i) => i.name === name)) continue;

      if (dialect === 'postgres') {
        await queryRunner.createIndex(
          table,
          new TableIndex({ name, columnNames: COLUMNS }),
        );
        continue;
      }

      const { sql, ident } = dialectApi('mysql');
      const length = Number(read.findColumnByName('path')?.length ?? 0);
      // DDL takes no parameter: the prefix is literal text (255, MYSQL_PATH_PREFIX).
      const pathPart =
        length > MYSQL_PATH_PREFIX ? sql`${ident('path')}(255)` : ident('path');
      await run(
        queryRunner,
        sql`CREATE INDEX ${ident(name)} ON ${ident(table)} (${ident('projectId')}, ${ident('branch')}, ${pathPart}) ALGORITHM=INPLACE LOCK=NONE`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dialect = parseDialect(queryRunner.connection.options.type);
    for (const { table, name } of INDEXES) {
      const read = await queryRunner.getTable(table);
      if (!read || !read.indices.some((i) => i.name === name)) continue;

      if (dialect === 'postgres') {
        await queryRunner.dropIndex(table, name);
        continue;
      }
      const { sql, ident } = dialectApi('mysql');
      await run(
        queryRunner,
        sql`DROP INDEX ${ident(name)} ON ${ident(table)} ALGORITHM=INPLACE LOCK=NONE`,
      );
    }
  }
}
