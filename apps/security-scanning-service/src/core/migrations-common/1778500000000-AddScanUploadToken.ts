import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';
import { dialectApi, parseDialect } from '@cybedefend/db-dialect';

const TABLE = 'scan_upload_token';

/**
 * Community scans on a connected Kubernetes cluster: the per-container
 * upload token of a cluster scan (entity
 * src/entities/scan-upload-token.entity.ts). Only the SHA-256 hex of a token
 * is stored; both foreign keys cascade, so a scan's tokens go with it.
 *
 * Common migration: TypeORM's schema API only, no SQL text, so it runs on
 * MySQL after the frozen track and on PostgreSQL after the baseline. The
 * engine is read from the query runner (never from DB_TYPE). The FK columns
 * take the charset and collation TypeORM reads off `scan.id` and
 * `container.id` (filled on MySQL only when they differ from the database
 * defaults): a database whose tables drifted from its default otherwise
 * refuses the foreign key (ER_FK_INCOMPATIBLE_COLUMNS). The timestamps carry
 * milliseconds on both engines (precision 3: PostgreSQL would default to 6,
 * MySQL to 0). Idempotent both ways.
 */
export class AddScanUploadToken1778500000000 implements MigrationInterface {
  name = 'AddScanUploadToken1778500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) return;
    const api = dialectApi(parseDialect(queryRunner.connection.options.type));

    const keyOf = async (table: string): Promise<Partial<TableColumn>> => {
      const id = (await queryRunner.getTable(table))?.findColumnByName('id');
      const key: Partial<TableColumn> = {};
      if (id?.charset) key.charset = id.charset;
      if (id?.collation) key.collation = id.collation;
      return key;
    };
    const scanKey = await keyOf('scan');
    const containerKey = await keyOf('container');
    const datetime = api.columnType('datetime') as string;

    await queryRunner.createTable(
      new Table({
        name: TABLE,
        columns: [
          new TableColumn({
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
            // UuidPrimaryColumn: TypeORM generates the id on MySQL
            ...(api.dialect === 'postgres'
              ? { default: api.uuidExpr().text }
              : {}),
          }),
          new TableColumn({
            name: 'scanId',
            type: 'varchar',
            length: '36',
            ...scanKey,
          }),
          new TableColumn({
            name: 'containerId',
            type: 'varchar',
            length: '36',
            ...containerKey,
          }),
          new TableColumn({ name: 'tokenHash', type: 'char', length: '64' }),
          new TableColumn({ name: 'category', type: 'varchar', length: '16' }),
          new TableColumn({
            name: 'severities',
            type: 'varchar',
            length: '64',
          }),
          new TableColumn({ name: 'expiresAt', type: datetime, precision: 3 }),
          new TableColumn({
            name: 'usedAt',
            type: datetime,
            precision: 3,
            isNullable: true,
          }),
          new TableColumn({
            name: 'createdAt',
            type: datetime,
            precision: 3,
            default: 'CURRENT_TIMESTAMP(3)',
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_scan_upload_token_scan',
            columnNames: ['scanId'],
            referencedTableName: 'scan',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_scan_upload_token_container',
            columnNames: ['containerId'],
            referencedTableName: 'container',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_scan_upload_token_scanId',
            columnNames: ['scanId'],
          }),
          new TableIndex({
            name: 'UQ_scan_upload_token_containerId',
            columnNames: ['containerId'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'UQ_scan_upload_token_tokenHash',
            columnNames: ['tokenHash'],
            isUnique: true,
          }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE, true);
    }
  }
}
