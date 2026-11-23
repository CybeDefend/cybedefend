import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  createUpdatedAtTrigger,
  ensureExtension,
} from '@cybedefend/db-dialect';

/**
 * The PostgreSQL track of analysis-reporting: the schema of the
 * 32 core entities as the frozen MySQL track leaves it, generated from those
 * entities (src/entities/, never src/ee/: the generator emitted no table of
 * an ee entity) against an empty PostgreSQL 16, then completed by hand so
 * that both engines end with the same schema (schema-parity.live.spec.ts):
 * - the citext extension first (sca_detected_packages.packageName and
 *   packageVersion, container_detected_images.artifactName are compared
 *   case-insensitively);
 * - every varchar without a length is varchar(255), the length TypeORM gives
 *   it on MySQL; the lengths the MySQL migrations set otherwise are theirs:
 *   container_detected_images.branch varchar(191), the cicd and secret
 *   detections' path varchar(1024), vulnerability_osv_affected.purl
 *   varchar(512), cwe_reports.projectId (uuid on the entity) and
 *   sca_detected_packages.projectId (length 36 on the entity) varchar(255);
 * - the timestamps the MySQL track keeps to the second (timestamp or
 *   datetime without precision) are TIMESTAMP(0): the triage, resolution,
 *   detection, exploitability and EPSS dates of the six detection tables,
 *   createdAt and updateAt of the sast, iac, cicd and secret detections,
 *   history_item.date,
 *   vulnerability_detection_history.detectedAt, vulnerability_osv.publishedAt,
 *   modifiedAt and withdrawnAt;
 * - vulnerability_detections_sca.currentCVSS defaults to '0.0', as on MySQL;
 * - what only MySQL migrations created: the six (projectId, branch,
 *   fingerprint) uniques of 1810000000000-AddFindingFingerprintUnique, and the
 *   plain indexes listed after the generated DDL, under their MySQL names.
 *   The (scanner, ruleId) unique of 1835000000001 and the indexes of
 *   1804000001000-AddPerformanceIndexes are declared on the entities and were
 *   generated (plain indexes, without MySQL's prefix lengths);
 * - the ON UPDATE CURRENT_TIMESTAMP of the four detection `updateAt` columns
 *   is a trigger (createUpdatedAtTrigger).
 * No table of a closed entity: those are created outside the Community
 * Edition, by the closed PostgreSQL migrations.
 * No seed row: no catalogue code (1835000000000), no Checkov pair
 * (1835000000001). Every later schema change is a common migration
 * (src/core/migrations-common/).
 */
export class PostgresBaseline1845500000000 implements MigrationInterface {
  name = 'PostgresBaseline1845500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureExtension(queryRunner, 'citext');
    await queryRunner.query(
      `CREATE TABLE "correspondance_table" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "scanner" character varying(255) NOT NULL, "ruleId" character varying(512) NOT NULL, "vulnerabilityType" character varying(255) NOT NULL DEFAULT 'sast', "enabled" boolean NOT NULL DEFAULT true, "vulnerabilityId" character varying(36), CONSTRAINT "PK_deec580111bbc7ec10667f4076d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_correspondance_table_scanner_ruleId" ON "correspondance_table" ("scanner", "ruleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "references" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "url" character varying(255) NOT NULL, "name" character varying(255) NOT NULL, "vulnerabilityId" character varying(36), CONSTRAINT "PK_795ec632ca1153bf5ec99d656e5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "autofix_records" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "vulnerabilityId" character varying(255) NOT NULL, "detectionId" character varying(255) NOT NULL, "vulnerabilityType" character varying(16) NOT NULL DEFAULT 'sast', "branch" text NOT NULL, "prUrl" text, "edits" jsonb NOT NULL, "commitMessage" text NOT NULL, "prTitle" text NOT NULL, "prBody" text NOT NULL, "diff" text, "status" character varying(32) NOT NULL, "reason" text, "taskId" character varying(64), "userId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sastDetectionId" character varying(36), "iacDetectionId" character varying(36), "cicdDetectionId" character varying(36), "secretDetectionId" character varying(36), CONSTRAINT "PK_7559f4911d39e8b835fecf16355" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2bb95380326ddd9ee7870f1204" ON "autofix_records" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_954c2fba26bfffbb694afc1943" ON "autofix_records" ("vulnerabilityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_770e2f298d8b94e83f21a89b56" ON "autofix_records" ("detectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18143418af6cbca44ade30250b" ON "autofix_records" ("vulnerabilityType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7955b67897b50ecd41f24ef3bd" ON "autofix_records" ("taskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_autofix_proj_vulntype" ON "autofix_records" ("projectId", "vulnerabilityType") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_exploitability_source_enum" AS ENUM('agent', 'manual', 'static')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_source_enum" AS ENUM('head', 'history')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_secret_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_secret" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updateAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "timeToFix" character varying(255), "currentState" character varying(255) NOT NULL, "currentSeverity" character varying(255) NOT NULL, "currentPriority" character varying(255) NOT NULL, "contextualExplanation" text, "language" character varying(255) NOT NULL, "path" character varying(1024) NOT NULL, "vulnerableStartLine" integer NOT NULL, "vulnerableEndLine" integer NOT NULL, "scannerType" character varying(255) NOT NULL, "fileHash" character varying(255), "branch" character varying(255), "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_secret_scoring_source_enum" NOT NULL DEFAULT 'static', "effective_severity" "public"."vulnerability_detections_secret_effective_severity_enum", "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_secret_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_secret_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "commitSha" character varying(64), "encryptedSecret" bytea, "source" "public"."vulnerability_detections_secret_source_enum" NOT NULL DEFAULT 'head', "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_secret_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "vulnerabilityId" character varying(36), CONSTRAINT "PK_1ab25d10a30d6feebe7f54a9434" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_secret"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f26d440492cda8732ef37994d6" ON "vulnerability_detections_secret" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67f2b5c0015375c30219ed8b25" ON "vulnerability_detections_secret" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_secret_proj_state_branch" ON "vulnerability_detections_secret" ("projectId", "currentState", "branch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "container_detected_images" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "scanId" character varying(255) NOT NULL, "artifactName" citext NOT NULL, "imageId" character varying(255) NOT NULL, "osFamily" character varying(255) NOT NULL, "osName" character varying(255) NOT NULL, "osEosl" boolean NOT NULL DEFAULT false, "branch" character varying(191) NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_container_detected_images_project_artifact_branch" UNIQUE ("projectId", "artifactName", "branch"), CONSTRAINT "PK_118a5235666773467c478f82b29" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "container_detected_packages" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "packageName" character varying(255) NOT NULL, "packageVersion" character varying(255) NOT NULL, "arch" character varying(255), "srcName" character varying(255), "srcVersion" character varying(255), "fullVersion" character varying(255), "srcFullVersion" character varying(255), "digest" character varying(255), "target" character varying(255), "class" character varying(255), "licenses" text, "dependsOn" text, "lastScanId" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "detectedImageId" character varying(36), CONSTRAINT "PK_95a5e76c6aec5c73d802bfc1b62" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_alias" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "alias" character varying(255) NOT NULL, "vulnerabilityOsvId" character varying(255), CONSTRAINT "PK_2dc5a1d4a1f2b152ac124b95793" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_reference" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "type" character varying(255), "url" text, "vulnerabilityOsvId" character varying(255), CONSTRAINT "PK_8b7b73ddffc48516a73dd37fe68" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_severity" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "type" character varying(255), "score" text NOT NULL, "vulnerabilityOsvId" character varying(255), CONSTRAINT "PK_79ac900d529d4abcdbdeac1ac95" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_affected_event" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "introduced" character varying(255), "fixed" character varying(255), "lastAffected" character varying(255), "limit" character varying(255), "rangeId" character varying(36), CONSTRAINT "PK_d96e9072f6aff3a46974521da6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_affected_range" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "type" character varying(255), "repo" character varying(255), "affectedId" character varying(36), CONSTRAINT "PK_27d95c5604eb3a4c0500866a1c4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv_affected" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "ecosystem" character varying(255), "packageName" character varying(255), "purl" character varying(512), "versions" jsonb, "severity" jsonb, "ecosystemSpecific" jsonb, "databaseSpecific" jsonb, "vulnerabilityOsvId" character varying(255), CONSTRAINT "PK_e61252a1e551a6d34c4a60294ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_osv_affected_ecosystem_package" ON "vulnerability_osv_affected" ("ecosystem", "packageName") `,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_osv" ("id" character varying(255) NOT NULL, "internalId" character varying(255), "schema_version" character varying(255), "content_hash" character varying(64), "summary" text, "details" text, "modifiedAt" TIMESTAMP(0), "publishedAt" TIMESTAMP(0), "withdrawnAt" TIMESTAMP(0), "related" jsonb, "upstream" jsonb, "database_specific" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_6db4628d93e70403aa25b848488" UNIQUE ("internalId"), CONSTRAINT "PK_bda9c31b9dae630085d0342cde3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_detection_source_enum" AS ENUM('scanner', 'osv')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_exploitability_source_enum" AS ENUM('agent', 'manual', 'static')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_container_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_container" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "vulnerabilityIdentifier" character varying(255) NOT NULL, "fixedVersion" character varying(255), "cvss_score" double precision NOT NULL DEFAULT '0', "currentState" character varying(255) NOT NULL DEFAULT 'to_verify', "currentSeverity" character varying(255) NOT NULL DEFAULT '', "currentPriority" character varying(255) NOT NULL DEFAULT '', "branch" character varying(255), "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_container_scoring_source_enum" NOT NULL DEFAULT 'static', "detection_source" "public"."vulnerability_detections_container_detection_source_enum" NOT NULL DEFAULT 'scanner', "effective_severity" "public"."vulnerability_detections_container_effective_severity_enum", "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_container_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_container_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "state_manually_modified" boolean NOT NULL DEFAULT false, "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_container_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "detectedImageId" character varying(36), "detectedPackageId" character varying(36), "vulnerabilityId" character varying(255), CONSTRAINT "PK_324926b1ea54d1e7f06bfd13a7b" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_container"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd399398a82bae1f8cf128968a" ON "vulnerability_detections_container" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccc15c3249f23e6aad7aea6184" ON "vulnerability_detections_container" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_container_proj_state_branch" ON "vulnerability_detections_container" ("projectId", "currentState", "branch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "history_item" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "type" character varying(255) NOT NULL, "value" text NOT NULL, "date" TIMESTAMP(0) NOT NULL, "userId" character varying(255), "source" character varying(64), "agent_tool_call_id" character varying(64), "agent_conversation_id" character varying(128), "agent_stream_id" character varying(128), "sastVulnerabilityDetectionId" character varying(36), "iacVulnerabilityDetectionId" character varying(36), "cicdVulnerabilityDetectionId" character varying(36), "secretVulnerabilityDetectionId" character varying(36), "scaVulnerabilityDetectionId" character varying(36), "containerVulnerabilityDetectionId" character varying(36), CONSTRAINT "PK_e332487e5fda0228286667a1268" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_cicd_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_cicd_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_cicd_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_cicd_exploitability_source_enum" AS ENUM('agent', 'manual', 'static')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_cicd_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_cicd" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updateAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "timeToFix" character varying(255), "currentState" character varying(255) NOT NULL, "currentSeverity" character varying(255) NOT NULL, "currentPriority" character varying(255) NOT NULL, "contextualExplanation" text, "language" character varying(255) NOT NULL, "path" character varying(1024) NOT NULL, "vulnerableStartLine" integer NOT NULL, "vulnerableEndLine" integer NOT NULL, "scannerType" character varying(255) NOT NULL, "fileHash" character varying(255), "branch" character varying(255), "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_cicd_scoring_source_enum" NOT NULL DEFAULT 'static', "effective_severity" "public"."vulnerability_detections_cicd_effective_severity_enum", "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_cicd_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_cicd_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "state_manually_modified" boolean NOT NULL DEFAULT false, "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_cicd_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "vulnerabilityId" character varying(36), CONSTRAINT "PK_4a838f042db82171bcf19ff7544" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_cicd"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab3e78dd88fe748a05b8e3c8e3" ON "vulnerability_detections_cicd" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b542e977cde9c8be681b930298" ON "vulnerability_detections_cicd" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_cicd_proj_exsrc_exupd" ON "vulnerability_detections_cicd" ("projectId", "exploitability_source", "exploitability_updated_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_cicd_proj_state_branch" ON "vulnerability_detections_cicd" ("projectId", "currentState", "branch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "code_snippet" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "vulnerableStartLine" integer NOT NULL, "vulnerableEndLine" integer NOT NULL, "startLine" integer NOT NULL, "endLine" integer NOT NULL, "code" jsonb NOT NULL, "language" character varying(255) NOT NULL, "fixAnalysis" character varying(255), "fixAnalysisDescription" character varying(255), "sastVulnerabilityDetectionId" character varying(36), "iacVulnerabilityDetectionId" character varying(36), "cicdVulnerabilityDetectionId" character varying(36), "secretVulnerabilityDetectionId" character varying(36), CONSTRAINT "PK_2ce08f698a9bf08a9dca20735e8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_iac_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_iac_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_iac_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_iac_exploitability_source_enum" AS ENUM('agent', 'manual', 'static')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_iac_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_iac" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updateAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "timeToFix" character varying(255), "currentState" character varying(255) NOT NULL, "currentSeverity" character varying(255) NOT NULL, "currentPriority" character varying(255) NOT NULL, "contextualExplanation" text, "language" character varying(255) NOT NULL, "path" character varying(255) NOT NULL, "vulnerableStartLine" integer NOT NULL, "vulnerableEndLine" integer NOT NULL, "scannerType" character varying(255) NOT NULL, "fileHash" character varying(255), "branch" character varying(255), "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_iac_scoring_source_enum" NOT NULL DEFAULT 'static', "effective_severity" "public"."vulnerability_detections_iac_effective_severity_enum", "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_iac_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_iac_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "state_manually_modified" boolean NOT NULL DEFAULT false, "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_iac_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "vulnerabilityId" character varying(36), CONSTRAINT "PK_7b33211a488b7be1fc643a82e9c" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_iac"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b60f790a1477f5aa5a3790ccc4" ON "vulnerability_detections_iac" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6569ee7d197043fb0ffee4ed0c" ON "vulnerability_detections_iac" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_iac_proj_exsrc_exupd" ON "vulnerability_detections_iac" ("projectId", "exploitability_source", "exploitability_updated_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_iac_proj_state_branch" ON "vulnerability_detections_iac" ("projectId", "currentState", "branch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "cwe" text, "name" character varying(512) NOT NULL, "shortDescription" character varying(2048) NOT NULL, "description" text NOT NULL, "howToPrevent" text NOT NULL, "owaspTop10" text, "severity" character varying(255) NOT NULL, "language" character varying(255) NOT NULL, "vulnerabilityType" character varying(255) NOT NULL DEFAULT 'sast', "code" character varying(24) NOT NULL, "cvss3" jsonb, "codeExamples" jsonb, "sourceMetadata" jsonb, CONSTRAINT "PK_0d1b35aef20e00b7b907cca7358" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_code" ON "vulnerability" ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "data_flow_item" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "nameHighlight" text NOT NULL, "line" integer NOT NULL, "language" character varying(255) NOT NULL, "code" jsonb NOT NULL, "type" character varying(255) NOT NULL, "order" integer NOT NULL, "sastVulnerabilityDetectionId" character varying(36), CONSTRAINT "PK_58dc0902fc598fc3b75ade4a7df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sast_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sast_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sast_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sast_exploitability_source_enum" AS ENUM('agent', 'manual', 'static')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sast_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_sast" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updateAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "timeToFix" character varying(255), "currentState" character varying(255) NOT NULL, "currentSeverity" character varying(255) NOT NULL, "currentPriority" character varying(255) NOT NULL, "contextualExplanation" text, "language" character varying(255) NOT NULL, "path" character varying(255) NOT NULL, "vulnerableStartLine" integer NOT NULL, "vulnerableEndLine" integer NOT NULL, "scannerType" character varying(255) NOT NULL, "fileHash" character varying(255), "branch" character varying(255), "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_sast_scoring_source_enum" NOT NULL DEFAULT 'static', "effective_severity" "public"."vulnerability_detections_sast_effective_severity_enum", "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_sast_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_sast_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "state_manually_modified" boolean NOT NULL DEFAULT false, "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_sast_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "vulnerabilityId" character varying(36), CONSTRAINT "PK_bb432132e74d011e593f9fd5e19" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_sast"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33fda863d9ed4584c5f5ed499f" ON "vulnerability_detections_sast" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c15ab90e6ec6192dcd82464a60" ON "vulnerability_detections_sast" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_sast_proj_exsrc_exupd" ON "vulnerability_detections_sast" ("projectId", "exploitability_source", "exploitability_updated_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_sast_proj_state_branch" ON "vulnerability_detections_sast" ("projectId", "currentState", "branch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detection_history" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "scanId" character varying(255) NOT NULL, "detectedAt" TIMESTAMP(0) NOT NULL, "sastVulnerabilityDetectionId" character varying(36), "iacVulnerabilityDetectionId" character varying(36), "cicdVulnerabilityDetectionId" character varying(36), "secretVulnerabilityDetectionId" character varying(36), "scaVulnerabilityDetectionId" character varying(36), CONSTRAINT "PK_6ad4c45947a1be20e10e1266bb0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vdh_scanId" ON "vulnerability_detection_history" ("scanId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sca_detected_packages" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "packageName" citext NOT NULL, "packageVersion" citext NOT NULL, "branch" character varying(191) NOT NULL DEFAULT '', "fileName" character varying(255) NOT NULL, "ecosystem" character varying(255) NOT NULL, "lastScanId" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "path" text, "isTransitive" boolean NOT NULL, "isDev" boolean NOT NULL, "dependencyInfoAvailable" boolean NOT NULL DEFAULT true, "reachability" character varying(32), "importLocations" text, "licenses" text, "licenseExpression" character varying(512), "isLicenseIgnored" smallint NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_sca_detected_packages_project_name_version_branch" UNIQUE ("projectId", "packageName", "packageVersion", "branch"), CONSTRAINT "PK_9d0deab2c6bb66951d9013c50ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sca_autofix_records" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(36) NOT NULL, "scaVulnerabilityDetectionId" character varying(36) NOT NULL, "cveId" character varying(64) NOT NULL, "severity" character varying(16) NOT NULL, "summary" text, "vulnerablePackage" character varying(255) NOT NULL, "vulnerableVersion" character varying(64) NOT NULL, "dependencyPath" jsonb NOT NULL, "ecosystem" character varying(32) NOT NULL, "isTransitive" boolean NOT NULL DEFAULT false, "fileName" character varying(512), "recommendedParentPackage" character varying(255), "recommendedCurrentVersion" character varying(64), "recommendedProposedVersion" character varying(64), "recommendedFixedChildVersion" character varying(64), "recommendedRequiredChildVersion" character varying(64), "recommendedUpdateType" character varying(16), "recommendedFixIsValid" boolean NOT NULL DEFAULT false, "installCommand" character varying(512), "branch" character varying(255), "prUrl" character varying(512), "prNumber" integer, "fixCandidates" jsonb, "status" character varying(32) NOT NULL DEFAULT 'pending', "errorMessage" text, "testedVersionsCount" integer NOT NULL DEFAULT '0', "hasFixAvailable" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fd260323752d6468755e64453a0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e83a01b0b740458b571eeb5388" ON "sca_autofix_records" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b787214350ce3efd93d365483" ON "sca_autofix_records" ("scaVulnerabilityDetectionId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sca_scoring_source_enum" AS ENUM('static', 'agent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sca_effective_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sca_exploitability_verdict_enum" AS ENUM('not_exploitable', 'theoretical', 'proven', 'actively_exploited', 'malicious')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sca_exploitability_source_enum" AS ENUM('agent', 'manual', 'static', 'malware')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_detections_sca_triaged_by_type_enum" AS ENUM('user', 'agent', 'system')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_detections_sca" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "currentState" character varying(255) NOT NULL DEFAULT 'to_verify', "currentSeverity" character varying(255) NOT NULL DEFAULT '', "currentPriority" character varying(255) NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "timeToFix" character varying(255), "currentCVSS" numeric(3,1) NOT NULL DEFAULT '0.0', "branch" character varying(255) NOT NULL DEFAULT '', "cvss4_vector" character varying(512), "cvss4_environmental_vector" character varying(512), "cvss4_base_score" numeric(3,1), "cvss4_environmental_score" numeric(3,1), "epss_score" numeric(5,4), "epss_percentile" numeric(5,4), "epss_refreshed_at" TIMESTAMP(0), "scoring_source" "public"."vulnerability_detections_sca_scoring_source_enum" NOT NULL DEFAULT 'static', "effective_severity" "public"."vulnerability_detections_sca_effective_severity_enum", "is_malware" boolean NOT NULL DEFAULT false, "exploitability_score" numeric(3,2), "exploitability_verdict" "public"."vulnerability_detections_sca_exploitability_verdict_enum", "exploitability_reason" text, "exploitability_score_reason" text, "exploitability_source" "public"."vulnerability_detections_sca_exploitability_source_enum", "exploitability_updated_at" TIMESTAMP(0), "priority_score" numeric(5,2), "priority_manual_override" boolean NOT NULL DEFAULT false, "state_manually_modified" boolean NOT NULL DEFAULT false, "fingerprint" character varying(64), "first_detected_at" TIMESTAMP(0), "last_detected_at" TIMESTAMP(0), "triaged_at" TIMESTAMP(0), "triaged_by" character varying(36), "triaged_by_type" "public"."vulnerability_detections_sca_triaged_by_type_enum", "resolved_at" TIMESTAMP(0), "dismissal_reason" text, "scaDetectedPackageId" character varying(36), "vulnerabilityId" character varying(255), CONSTRAINT "UQ_9ed3fc6ecff294852839d9b2c85" UNIQUE ("scaDetectedPackageId", "vulnerabilityId", "branch"), CONSTRAINT "PK_0b3b4a108b75bc2192b3b103a04" PRIMARY KEY ("id")); COMMENT ON COLUMN "vulnerability_detections_sca"."currentCVSS" IS 'Pre-calculated CVSS score for efficient SQL sorting'; COMMENT ON COLUMN "vulnerability_detections_sca"."branch" IS 'Branch that was scanned when this vulnerability was detected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9cc1c97bad702b23d288032ab" ON "vulnerability_detections_sca" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_612cd4c3e624b315421b50232d" ON "vulnerability_detections_sca" ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_sca_proj_branch" ON "vulnerability_detections_sca" ("projectId", "branch") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vd_sca_proj_state" ON "vulnerability_detections_sca" ("projectId", "currentState") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sca_license_overrides" ("organizationId" character varying(36) NOT NULL, "spdxId" character varying(64) NOT NULL, "category" character varying(32) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2c314b1b4a0fbdfe4fae9b47039" PRIMARY KEY ("organizationId", "spdxId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "owasp_reports" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "reportJson" text NOT NULL, "format" character varying(50) NOT NULL DEFAULT 'json', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9e688420b6c18c1053e11a0f7e1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5cb465a4810121055c01ffdbf" ON "owasp_reports" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b92b896c733bcdfa675dc5f2f" ON "owasp_reports" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "project_cyber_risk" ("project_id" character varying(36) NOT NULL, "score" integer NOT NULL DEFAULT '0', "level" character varying(16) NOT NULL DEFAULT 'none', "level_7d" character varying(16) NOT NULL DEFAULT 'none', "vuln_count" integer NOT NULL DEFAULT '0', "computed_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(), CONSTRAINT "PK_4bed2e02ce840bd8c937308d99b" PRIMARY KEY ("project_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_project_cyber_risk_score" ON "project_cyber_risk" ("score") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_project_cyber_risk_level" ON "project_cyber_risk" ("level") `,
    );
    await queryRunner.query(
      `CREATE TABLE "organization_statistics" ("organization_id" character varying(36) NOT NULL, "stats" jsonb, "computed_at" TIMESTAMP(3), "last_event_at" TIMESTAMP(3), "dirty_since" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(), CONSTRAINT "PK_ba15fbe0c15f6cf198aeac03ac1" PRIMARY KEY ("organization_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_org_statistics_computed_at" ON "organization_statistics" ("computed_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_org_statistics_dirty_since" ON "organization_statistics" ("dirty_since") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cwe_reports" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "reportJson" text NOT NULL, "format" character varying(50) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a04e702374cafb2f99477810329" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "generated_reports" ("id" character varying(36) NOT NULL, "projectId" character varying(36) NOT NULL, "organizationId" character varying(36), "kind" character varying(32) NOT NULL, "format" character varying(16) NOT NULL, "detailed" boolean NOT NULL DEFAULT true, "branch" character varying(191), "scannerTypes" text, "filename" character varying(255), "contentType" character varying(128), "objectPath" character varying(512), "status" character varying(16) NOT NULL DEFAULT 'queued', "error" text, "expiresAt" TIMESTAMP(6), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3875618b27e8f2d438168399374" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_generated_reports_expires_at" ON "generated_reports" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_generated_reports_org_status_expires" ON "generated_reports" ("organizationId", "status", "expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_generated_reports_project" ON "generated_reports" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "aggregated_reports" ("id" character varying(36) NOT NULL, "scope_type" character varying(50) NOT NULL, "scope_id" character varying(255) NOT NULL, "organization_id" character varying(255), "report_type" character varying(50) NOT NULL, "format" character varying(20) NOT NULL DEFAULT 'json', "status" character varying(20) NOT NULL DEFAULT 'queued', "object_path" character varying(1024), "filename" character varying(512), "content_type" character varying(128), "error" character varying(2000), "expiresAt" TIMESTAMP(6), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3c1a74e56d2cc385e863b9973cc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_998df966db53636d91331e8def" ON "aggregated_reports" ("scope_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dae9429168816927e29dba3372" ON "aggregated_reports" ("scope_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7c589e68dbc1ebc6d28e59a06" ON "aggregated_reports" ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3b0a61546dac1fe85dff3cce9" ON "aggregated_reports" ("report_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff40ae3ee7d3d11e55d8e1e5a5" ON "aggregated_reports" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aggregated_reports_expires_at" ON "aggregated_reports" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aggregated_reports_org_status_expires" ON "aggregated_reports" ("organization_id", "status", "expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c717be23ae3d95887e535515cd" ON "aggregated_reports" ("scope_type", "scope_id", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "correspondance_table" ADD CONSTRAINT "FK_6193f0a3116de9f1159dc67065a" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "references" ADD CONSTRAINT "FK_15156929b46577f58660eca5101" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" ADD CONSTRAINT "FK_123c522568b0f5f1b46d75afc14" FOREIGN KEY ("sastDetectionId") REFERENCES "vulnerability_detections_sast"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" ADD CONSTRAINT "FK_d3a3935dd651f879b2cd049e1dd" FOREIGN KEY ("iacDetectionId") REFERENCES "vulnerability_detections_iac"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" ADD CONSTRAINT "FK_cc15a692bbd5fb6145b1e8494f0" FOREIGN KEY ("cicdDetectionId") REFERENCES "vulnerability_detections_cicd"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" ADD CONSTRAINT "FK_eaa2c7c0f2ad6414f95bfb4e5d0" FOREIGN KEY ("secretDetectionId") REFERENCES "vulnerability_detections_secret"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_secret" ADD CONSTRAINT "FK_61ba9af49dc0408c8afba15991b" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "container_detected_packages" ADD CONSTRAINT "FK_9c7105070fd57395950315ce127" FOREIGN KEY ("detectedImageId") REFERENCES "container_detected_images"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_alias" ADD CONSTRAINT "FK_a30e6f4f42ac969bc768f2f7ad4" FOREIGN KEY ("vulnerabilityOsvId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_reference" ADD CONSTRAINT "FK_d44e9a11c27104dbf8770c07e72" FOREIGN KEY ("vulnerabilityOsvId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_severity" ADD CONSTRAINT "FK_724f6432897954ca3d3af7601a2" FOREIGN KEY ("vulnerabilityOsvId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected_event" ADD CONSTRAINT "FK_b87f1a5171f05f920e3fde28179" FOREIGN KEY ("rangeId") REFERENCES "vulnerability_osv_affected_range"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected_range" ADD CONSTRAINT "FK_7d90aa0d970fff753dbc9eb1100" FOREIGN KEY ("affectedId") REFERENCES "vulnerability_osv_affected"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected" ADD CONSTRAINT "FK_dba5437960ef66397c6db674f0e" FOREIGN KEY ("vulnerabilityOsvId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" ADD CONSTRAINT "FK_54a37c4abeee14c2c248ee21582" FOREIGN KEY ("detectedImageId") REFERENCES "container_detected_images"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" ADD CONSTRAINT "FK_00c946621e8f74e37b34d1a4724" FOREIGN KEY ("detectedPackageId") REFERENCES "container_detected_packages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" ADD CONSTRAINT "FK_7f5ad132586c9c3e61be9efd066" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_12b265888f9903aea3be13145a0" FOREIGN KEY ("sastVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sast"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_02d35dc6ad8014a32d37c25f9a4" FOREIGN KEY ("iacVulnerabilityDetectionId") REFERENCES "vulnerability_detections_iac"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_ffba375f42bd8bdaba776772aea" FOREIGN KEY ("cicdVulnerabilityDetectionId") REFERENCES "vulnerability_detections_cicd"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_0645fe65b8179ed3b346da2ad39" FOREIGN KEY ("secretVulnerabilityDetectionId") REFERENCES "vulnerability_detections_secret"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_c45a9a69d3b4f73f51cf66250dd" FOREIGN KEY ("scaVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sca"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" ADD CONSTRAINT "FK_b8fe8fd7dc1d8aac82c072207cc" FOREIGN KEY ("containerVulnerabilityDetectionId") REFERENCES "vulnerability_detections_container"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_cicd" ADD CONSTRAINT "FK_3a8a0485ae6708e3a5f2c48dcb2" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" ADD CONSTRAINT "FK_fb4b454c223a992f16264540e09" FOREIGN KEY ("sastVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sast"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" ADD CONSTRAINT "FK_d0de310d392fac3cd6aa2fcf327" FOREIGN KEY ("iacVulnerabilityDetectionId") REFERENCES "vulnerability_detections_iac"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" ADD CONSTRAINT "FK_91b9a2a659fa43df620b2304372" FOREIGN KEY ("cicdVulnerabilityDetectionId") REFERENCES "vulnerability_detections_cicd"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" ADD CONSTRAINT "FK_1febb8ed8abb85d8fae9617770f" FOREIGN KEY ("secretVulnerabilityDetectionId") REFERENCES "vulnerability_detections_secret"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_iac" ADD CONSTRAINT "FK_c96e49286320a840c2aa0d4ca50" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "data_flow_item" ADD CONSTRAINT "FK_eca35c96769afffb4a41d2211a4" FOREIGN KEY ("sastVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sast"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sast" ADD CONSTRAINT "FK_1ed596403122773674191f2bfc6" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" ADD CONSTRAINT "FK_c47b4ab33238bccc6eb40cfee7d" FOREIGN KEY ("sastVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sast"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" ADD CONSTRAINT "FK_6fc1fd1d461583c5dc3d1510a46" FOREIGN KEY ("iacVulnerabilityDetectionId") REFERENCES "vulnerability_detections_iac"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" ADD CONSTRAINT "FK_7ad3a7f9953ad4408d7a650cf29" FOREIGN KEY ("cicdVulnerabilityDetectionId") REFERENCES "vulnerability_detections_cicd"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" ADD CONSTRAINT "FK_a817e862c2b70acae686c8d3cab" FOREIGN KEY ("secretVulnerabilityDetectionId") REFERENCES "vulnerability_detections_secret"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" ADD CONSTRAINT "FK_668e9790f3b4b77b761d757d928" FOREIGN KEY ("scaVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sca"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sca_autofix_records" ADD CONSTRAINT "FK_4b787214350ce3efd93d3654838" FOREIGN KEY ("scaVulnerabilityDetectionId") REFERENCES "vulnerability_detections_sca"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sca" ADD CONSTRAINT "FK_4b20f624a581e6e01f6b6a94195" FOREIGN KEY ("scaDetectedPackageId") REFERENCES "sca_detected_packages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sca" ADD CONSTRAINT "FK_0030ab373840c6b1f99befe7948" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerability_osv"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Created on MySQL by 1810000000000-AddFindingFingerprintUnique only.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_sast_fingerprint" ON "vulnerability_detections_sast" ("projectId", "branch", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_iac_fingerprint" ON "vulnerability_detections_iac" ("projectId", "branch", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_cicd_fingerprint" ON "vulnerability_detections_cicd" ("projectId", "branch", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_secret_fingerprint" ON "vulnerability_detections_secret" ("projectId", "branch", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_sca_fingerprint" ON "vulnerability_detections_sca" ("projectId", "branch", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vulnerability_detections_container_fingerprint" ON "vulnerability_detections_container" ("projectId", "branch", "fingerprint")`,
    );
    // Plain indexes the MySQL track created in migrations only (MySQL names).
    await queryRunner.query(
      `CREATE INDEX "idx_history_item_agent_tool_call" ON "history_item" ("agent_tool_call_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_history_item_source" ON "history_item" ("source")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sca_autofix_pr_url" ON "sca_autofix_records" ("prUrl")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_osv_alias_alias" ON "vulnerability_osv_alias" ("alias")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CICD_PROJECT_BRANCH" ON "vulnerability_detections_cicd" ("projectId", "branch")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CICD_SCANNER_TYPE" ON "vulnerability_detections_cicd" ("scannerType")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SECRET_PROJECT_BRANCH" ON "vulnerability_detections_secret" ("projectId", "branch")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SECRET_SCANNER_TYPE" ON "vulnerability_detections_secret" ("scannerType")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vds_commit_sha" ON "vulnerability_detections_secret" ("commitSha")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vds_source" ON "vulnerability_detections_secret" ("source")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sast_effective_severity" ON "vulnerability_detections_sast" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sast_exploitability" ON "vulnerability_detections_sast" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sast_priority_score" ON "vulnerability_detections_sast" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sast_scoring" ON "vulnerability_detections_sast" ("scoring_source", "cvss4_environmental_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_iac_effective_severity" ON "vulnerability_detections_iac" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_iac_exploitability" ON "vulnerability_detections_iac" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_iac_priority_score" ON "vulnerability_detections_iac" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_iac_scoring" ON "vulnerability_detections_iac" ("scoring_source", "cvss4_environmental_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_cicd_effective_severity" ON "vulnerability_detections_cicd" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_cicd_exploitability" ON "vulnerability_detections_cicd" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_cicd_priority_score" ON "vulnerability_detections_cicd" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_cicd_scoring" ON "vulnerability_detections_cicd" ("scoring_source", "cvss4_environmental_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_secret_effective_severity" ON "vulnerability_detections_secret" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_secret_exploitability" ON "vulnerability_detections_secret" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_secret_priority_score" ON "vulnerability_detections_secret" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_secret_scoring" ON "vulnerability_detections_secret" ("scoring_source", "cvss4_environmental_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sca_effective_severity" ON "vulnerability_detections_sca" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sca_exploitability" ON "vulnerability_detections_sca" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sca_priority_score" ON "vulnerability_detections_sca" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_sca_scoring" ON "vulnerability_detections_sca" ("scoring_source", "cvss4_environmental_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_container_effective_severity" ON "vulnerability_detections_container" ("effective_severity", "currentSeverity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_container_exploitability" ON "vulnerability_detections_container" ("exploitability_verdict", "exploitability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_container_priority_score" ON "vulnerability_detections_container" ("priority_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vulnerability_detections_container_scoring" ON "vulnerability_detections_container" ("scoring_source", "cvss4_environmental_score")`,
    );
    // ON UPDATE CURRENT_TIMESTAMP on MySQL; a trigger on PostgreSQL.
    await createUpdatedAtTrigger(
      queryRunner,
      'vulnerability_detections_sast',
      'updateAt',
    );
    await createUpdatedAtTrigger(
      queryRunner,
      'vulnerability_detections_iac',
      'updateAt',
    );
    await createUpdatedAtTrigger(
      queryRunner,
      'vulnerability_detections_secret',
      'updateAt',
    );
    await createUpdatedAtTrigger(
      queryRunner,
      'vulnerability_detections_cicd',
      'updateAt',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "cd_touch_updateAt"() CASCADE`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_container_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_container_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_container_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_container_effective_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sca_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sca_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sca_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sca_effective_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_secret_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_secret_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_secret_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_secret_effective_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_cicd_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_cicd_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_cicd_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_cicd_effective_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_iac_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_iac_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_iac_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_iac_effective_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sast_scoring"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sast_priority_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sast_exploitability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_detections_sast_effective_severity"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_vds_source"`);
    await queryRunner.query(`DROP INDEX "public"."idx_vds_commit_sha"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_SECRET_SCANNER_TYPE"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_SECRET_PROJECT_BRANCH"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_CICD_SCANNER_TYPE"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_CICD_PROJECT_BRANCH"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vulnerability_osv_alias_alias"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_sca_autofix_pr_url"`);
    await queryRunner.query(`DROP INDEX "public"."idx_history_item_source"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_history_item_agent_tool_call"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_sast_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_iac_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_cicd_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_secret_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_sca_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vulnerability_detections_container_fingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sca" DROP CONSTRAINT "FK_0030ab373840c6b1f99befe7948"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sca" DROP CONSTRAINT "FK_4b20f624a581e6e01f6b6a94195"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sca_autofix_records" DROP CONSTRAINT "FK_4b787214350ce3efd93d3654838"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" DROP CONSTRAINT "FK_668e9790f3b4b77b761d757d928"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" DROP CONSTRAINT "FK_a817e862c2b70acae686c8d3cab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" DROP CONSTRAINT "FK_7ad3a7f9953ad4408d7a650cf29"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" DROP CONSTRAINT "FK_6fc1fd1d461583c5dc3d1510a46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detection_history" DROP CONSTRAINT "FK_c47b4ab33238bccc6eb40cfee7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_sast" DROP CONSTRAINT "FK_1ed596403122773674191f2bfc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "data_flow_item" DROP CONSTRAINT "FK_eca35c96769afffb4a41d2211a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_iac" DROP CONSTRAINT "FK_c96e49286320a840c2aa0d4ca50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" DROP CONSTRAINT "FK_1febb8ed8abb85d8fae9617770f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" DROP CONSTRAINT "FK_91b9a2a659fa43df620b2304372"`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" DROP CONSTRAINT "FK_d0de310d392fac3cd6aa2fcf327"`,
    );
    await queryRunner.query(
      `ALTER TABLE "code_snippet" DROP CONSTRAINT "FK_fb4b454c223a992f16264540e09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_cicd" DROP CONSTRAINT "FK_3a8a0485ae6708e3a5f2c48dcb2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_b8fe8fd7dc1d8aac82c072207cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_c45a9a69d3b4f73f51cf66250dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_0645fe65b8179ed3b346da2ad39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_ffba375f42bd8bdaba776772aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_02d35dc6ad8014a32d37c25f9a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "history_item" DROP CONSTRAINT "FK_12b265888f9903aea3be13145a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" DROP CONSTRAINT "FK_7f5ad132586c9c3e61be9efd066"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" DROP CONSTRAINT "FK_00c946621e8f74e37b34d1a4724"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_container" DROP CONSTRAINT "FK_54a37c4abeee14c2c248ee21582"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected" DROP CONSTRAINT "FK_dba5437960ef66397c6db674f0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected_range" DROP CONSTRAINT "FK_7d90aa0d970fff753dbc9eb1100"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_affected_event" DROP CONSTRAINT "FK_b87f1a5171f05f920e3fde28179"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_severity" DROP CONSTRAINT "FK_724f6432897954ca3d3af7601a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_reference" DROP CONSTRAINT "FK_d44e9a11c27104dbf8770c07e72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_osv_alias" DROP CONSTRAINT "FK_a30e6f4f42ac969bc768f2f7ad4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "container_detected_packages" DROP CONSTRAINT "FK_9c7105070fd57395950315ce127"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vulnerability_detections_secret" DROP CONSTRAINT "FK_61ba9af49dc0408c8afba15991b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" DROP CONSTRAINT "FK_eaa2c7c0f2ad6414f95bfb4e5d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" DROP CONSTRAINT "FK_cc15a692bbd5fb6145b1e8494f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" DROP CONSTRAINT "FK_d3a3935dd651f879b2cd049e1dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "autofix_records" DROP CONSTRAINT "FK_123c522568b0f5f1b46d75afc14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "references" DROP CONSTRAINT "FK_15156929b46577f58660eca5101"`,
    );
    await queryRunner.query(
      `ALTER TABLE "correspondance_table" DROP CONSTRAINT "FK_6193f0a3116de9f1159dc67065a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c717be23ae3d95887e535515cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aggregated_reports_org_status_expires"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aggregated_reports_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff40ae3ee7d3d11e55d8e1e5a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3b0a61546dac1fe85dff3cce9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7c589e68dbc1ebc6d28e59a06"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dae9429168816927e29dba3372"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_998df966db53636d91331e8def"`,
    );
    await queryRunner.query(`DROP TABLE "aggregated_reports"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_generated_reports_project"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_generated_reports_org_status_expires"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_generated_reports_expires_at"`,
    );
    await queryRunner.query(`DROP TABLE "generated_reports"`);
    await queryRunner.query(`DROP TABLE "cwe_reports"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_org_statistics_dirty_since"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_org_statistics_computed_at"`,
    );
    await queryRunner.query(`DROP TABLE "organization_statistics"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_project_cyber_risk_level"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_project_cyber_risk_score"`,
    );
    await queryRunner.query(`DROP TABLE "project_cyber_risk"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b92b896c733bcdfa675dc5f2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5cb465a4810121055c01ffdbf"`,
    );
    await queryRunner.query(`DROP TABLE "owasp_reports"`);
    await queryRunner.query(`DROP TABLE "sca_license_overrides"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vd_sca_proj_state"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vd_sca_proj_branch"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_612cd4c3e624b315421b50232d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9cc1c97bad702b23d288032ab"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_sca"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sca_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sca_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sca_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sca_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sca_scoring_source_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b787214350ce3efd93d365483"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e83a01b0b740458b571eeb5388"`,
    );
    await queryRunner.query(`DROP TABLE "sca_autofix_records"`);
    await queryRunner.query(`DROP TABLE "sca_detected_packages"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vdh_scanId"`);
    await queryRunner.query(`DROP TABLE "vulnerability_detection_history"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_sast_proj_state_branch"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_sast_proj_exsrc_exupd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c15ab90e6ec6192dcd82464a60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33fda863d9ed4584c5f5ed499f"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_sast"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sast_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sast_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sast_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sast_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_sast_scoring_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "data_flow_item"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_vulnerability_code"`);
    await queryRunner.query(`DROP TABLE "vulnerability"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_iac_proj_state_branch"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_iac_proj_exsrc_exupd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6569ee7d197043fb0ffee4ed0c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b60f790a1477f5aa5a3790ccc4"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_iac"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_iac_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_iac_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_iac_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_iac_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_iac_scoring_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "code_snippet"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_cicd_proj_state_branch"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_cicd_proj_exsrc_exupd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b542e977cde9c8be681b930298"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab3e78dd88fe748a05b8e3c8e3"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_cicd"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_cicd_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_cicd_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_cicd_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_cicd_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_cicd_scoring_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "history_item"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_container_proj_state_branch"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccc15c3249f23e6aad7aea6184"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd399398a82bae1f8cf128968a"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_container"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_detection_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_container_scoring_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_osv"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_osv_affected_ecosystem_package"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_osv_affected"`);
    await queryRunner.query(`DROP TABLE "vulnerability_osv_affected_range"`);
    await queryRunner.query(`DROP TABLE "vulnerability_osv_affected_event"`);
    await queryRunner.query(`DROP TABLE "vulnerability_osv_severity"`);
    await queryRunner.query(`DROP TABLE "vulnerability_osv_reference"`);
    await queryRunner.query(`DROP TABLE "vulnerability_osv_alias"`);
    await queryRunner.query(`DROP TABLE "container_detected_packages"`);
    await queryRunner.query(`DROP TABLE "container_detected_images"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vd_secret_proj_state_branch"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67f2b5c0015375c30219ed8b25"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f26d440492cda8732ef37994d6"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_detections_secret"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_triaged_by_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_exploitability_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_exploitability_verdict_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_effective_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_detections_secret_scoring_source_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_autofix_proj_vulntype"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7955b67897b50ecd41f24ef3bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18143418af6cbca44ade30250b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_770e2f298d8b94e83f21a89b56"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_954c2fba26bfffbb694afc1943"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2bb95380326ddd9ee7870f1204"`,
    );
    await queryRunner.query(`DROP TABLE "autofix_records"`);
    await queryRunner.query(`DROP TABLE "references"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_correspondance_table_scanner_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "correspondance_table"`);
  }
}
