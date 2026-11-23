import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The PostgreSQL track of file-management: the schema of the
 * core entities as the frozen MySQL track leaves it, generated from those
 * entities (src/entities/, never closed code) against an empty PostgreSQL 16,
 * then completed by hand so that both engines end with the same schema
 * (schema-parity.live.spec.ts):
 * - every varchar without a length is varchar(255), the length TypeORM gives
 *   it on MySQL.
 * The MySQL track keeps createdAt and updatedAt as datetime(6), which reads
 * back as timestamp(6) on PostgreSQL's plain TIMESTAMP, so no TIMESTAMP(0)
 * edit was needed; file_scan has no onUpdate column in the MySQL track beyond
 * updatedAt, which TypeORM sets itself. No seed row. Every later schema
 * change is a common migration (src/core/migrations-common/).
 */
export class PostgresBaseline1808500000000 implements MigrationInterface {
  name = 'PostgresBaseline1808500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."file_scan_status_enum" AS ENUM('PENDING_UPLOAD', 'PROCESSING', 'UPLOADED', 'PROCESSED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "file_scan" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "scanId" character varying(255) NOT NULL, "fileName" character varying(255) NOT NULL, "typeScan" character varying(255) NOT NULL, "projectId" character varying(255) NOT NULL, "status" "public"."file_scan_status_enum" NOT NULL DEFAULT 'PENDING_UPLOAD', "objectPath" character varying(255), "isDiffScan" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c48dabac08f45bc3048eeca042e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_scan_projectId" ON "file_scan" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_scan_scanId" ON "file_scan" ("scanId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_scan_status_updatedAt" ON "file_scan" ("status", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_scan_status_createdAt" ON "file_scan" ("status", "createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_file_scan_status_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_file_scan_status_updatedAt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_file_scan_scanId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_file_scan_projectId"`);
    await queryRunner.query(`DROP TABLE "file_scan"`);
    await queryRunner.query(`DROP TYPE "public"."file_scan_status_enum"`);
  }
}
