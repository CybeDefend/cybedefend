import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureExtension } from '@cybedefend/db-dialect';

/**
 * The PostgreSQL track of security-scanning: the schema of the
 * core entities as the frozen MySQL track leaves it, generated from those
 * entities (src/entities/, never the closed ones) against an empty PostgreSQL 16,
 * then completed by hand so that both engines end with the same schema
 * (schema-parity.live.spec.ts):
 * - the citext extension first (as in the other baselines; no core column of
 *   this service uses it yet);
 * - every varchar without a length is varchar(255), the length TypeORM gives
 *   it on MySQL;
 * - the timestamps the MySQL track keeps to the second (scan.startTime and
 *   endTime, container.createdAt, startedAt, finishedAt, analysisQueuedAt and
 *   analysisStartedAt) are TIMESTAMP(0); scan.createAt and updatedAt are
 *   datetime(6) on MySQL, so they stay plain TIMESTAMP (precision 6);
 * - container.scanId stays character varying(255) and scan.errorCategory
 *   character varying(50): the lengths the MySQL track created them with;
 * - IDX_scan_errorCategory, which on MySQL only a migration created, is added
 *   by hand.
 * No scanner row is seeded (the scanner rows come from the scanners' own
 * registration, and the SARIF import in the Community Edition), and no
 * updated-at trigger: scan.updatedAt is an @UpdateDateColumn, which TypeORM
 * owns on both engines. Every later schema change is a common migration
 * (src/core/migrations-common/).
 */
export class PostgresBaseline1778350000000 implements MigrationInterface {
  name = 'PostgresBaseline1778350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureExtension(queryRunner, 'citext');
    await queryRunner.query(
      `CREATE TYPE "public"."scan_state_enum" AS ENUM('waiting_for_file', 'queued', 'running', 'completed', 'completed_degraded', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scanner_scannerType_enum" AS ENUM('sast', 'iac', 'sca', 'container', 'secret', 'aibom')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scan" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "state" "public"."scan_state_enum" NOT NULL DEFAULT 'waiting_for_file', "language" text NOT NULL, "projectId" character varying(255) NOT NULL, "organizationId" character varying(255) NOT NULL, "private" boolean NOT NULL DEFAULT false, "initializerUserId" character varying(255), "createAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "scanType" character varying(255), "startTime" TIMESTAMP(0), "endTime" TIMESTAMP(0), "retryCount" integer NOT NULL DEFAULT '0', "totalLOC" integer NOT NULL DEFAULT '0', "totalSize" character varying(255) NOT NULL DEFAULT '0Mo', "metadata" jsonb, "branch" character varying(255), "isDiffScan" boolean NOT NULL DEFAULT false, "isGraphOnly" boolean NOT NULL DEFAULT false, "vibedefendUnitClosed" boolean NOT NULL DEFAULT false, "errorMessage" character varying(255), "errorCode" integer, "errorCategory" character varying(50), "policyPassed" boolean, "policyBlockingCount" integer NOT NULL DEFAULT '0', "policyWarningCount" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_scan" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_projectId_state" ON "scan" ("projectId", "state") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_projectId_createAt" ON "scan" ("projectId", "createAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_projectId_branch" ON "scan" ("projectId", "branch") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_organizationId_state" ON "scan" ("organizationId", "state") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_state_createAt" ON "scan" ("state", "createAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_projectId_isDiffScan" ON "scan" ("projectId", "isDiffScan") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_orgId_userId_isDiffScan" ON "scan" ("organizationId", "initializerUserId", "isDiffScan") `,
    );
    // Only the MySQL track's CreateInitialTables created this one.
    await queryRunner.query(
      `CREATE INDEX "IDX_scan_errorCategory" ON "scan" ("errorCategory") `,
    );
    await queryRunner.query(
      `CREATE TABLE "container" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "clusterId" character varying(255), "clusterName" character varying(255), "clusterEndpoint" character varying(255), "podName" character varying(255) NOT NULL, "podUid" character varying(255), "image" character varying(255) NOT NULL, "version" character varying(255), "status" character varying(255) NOT NULL, "scanId" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(0), "finishedAt" TIMESTAMP(0), "totalVulnerabilities" integer, "processedVulnerabilities" integer, "step" character varying(255), "scannerId" character varying(36), "analysisQueuedAt" TIMESTAMP(0), "analysisStartedAt" TIMESTAMP(0), "outcomeReason" character varying(64), "podRetryCount" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_container" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_container_scanId_status" ON "container" ("scanId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_container_podName_scanId" ON "container" ("podName", "scanId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_container_status_createdAt" ON "container" ("status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scanner" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "imageName" character varying(255) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "scannerType" "public"."scanner_scannerType_enum" NOT NULL, "memoryRequest" character varying(255) DEFAULT '1Gi', "cpuRequest" character varying(255) DEFAULT '500m', "memoryLimit" character varying(255) DEFAULT '1Gi', "cpuLimit" character varying(255) DEFAULT '500m', "deletePodsOnFinish" boolean NOT NULL DEFAULT true, "deletePodsOnError" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_scanner" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "supported_language" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "maturity" character varying(255) NOT NULL, "scannerId" character varying(36), CONSTRAINT "PK_supported_language" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "container" ADD CONSTRAINT "FK_container_scan" FOREIGN KEY ("scanId") REFERENCES "scan"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "container" ADD CONSTRAINT "FK_container_scanner" FOREIGN KEY ("scannerId") REFERENCES "scanner"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "supported_language" ADD CONSTRAINT "FK_supported_language_scanner" FOREIGN KEY ("scannerId") REFERENCES "scanner"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supported_language" DROP CONSTRAINT "FK_supported_language_scanner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "container" DROP CONSTRAINT "FK_container_scanner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "container" DROP CONSTRAINT "FK_container_scan"`,
    );
    await queryRunner.query(`DROP TABLE "supported_language"`);
    await queryRunner.query(`DROP TABLE "scanner"`);
    await queryRunner.query(`DROP TYPE "public"."scanner_scannerType_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_container_status_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_container_podName_scanId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_container_scanId_status"`,
    );
    await queryRunner.query(`DROP TABLE "container"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_scan_errorCategory"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scan_orgId_userId_isDiffScan"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scan_projectId_isDiffScan"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_scan_state_createAt"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scan_organizationId_state"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_scan_projectId_branch"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scan_projectId_createAt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_scan_projectId_state"`);
    await queryRunner.query(`DROP TABLE "scan"`);
    await queryRunner.query(`DROP TYPE "public"."scan_state_enum"`);
  }
}
