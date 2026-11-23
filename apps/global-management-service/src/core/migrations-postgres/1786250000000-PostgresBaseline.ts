import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureExtension } from '@cybedefend/db-dialect';

/**
 * The PostgreSQL track of global-management: the schema of the
 * core entities as the frozen MySQL track leaves it, generated from those
 * entities (src/entities/, never the closed edition's) against an empty PostgreSQL 16,
 * then completed by hand so that both engines end with the same schema
 * (schema-parity.live.spec.ts):
 * - the citext extension first (team and project names are compared
 *   case-insensitively);
 * - every varchar without a length is varchar(255), the length TypeORM gives
 *   it on MySQL;
 * - the four timestamps the MySQL track keeps to the second (datetime
 *   without precision) are TIMESTAMP(0): organization_invitations.acceptedAt
 *   and expiresAt, project.appsec_enabled_at,
 *   project_branch_ingestion.lastParsedAt.
 * The organisation columns only the closed edition declares (on the core
 * entity, from its own code) are not created here: the closed edition adds
 * them with its own PostgreSQL migration.
 * IDX_user_email_unique, which on MySQL only a migration created, is declared
 * on the entity and was generated.
 * Global-management has no onUpdate column, so no updated-at trigger; and no
 * seed row. Every later schema change is a common migration
 * (src/core/migrations-common/).
 */
export class PostgresBaseline1786250000000 implements MigrationInterface {
  name = 'PostgresBaseline1786250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureExtension(queryRunner, 'citext');
    await queryRunner.query(
      `CREATE TYPE "public"."organization_invitations_status_enum" AS ENUM('pending', 'accepted', 'canceled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "organization_invitations" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "token" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "role" character varying(255) NOT NULL, "appsec_access" boolean NOT NULL DEFAULT true, "vibedefend_access" boolean NOT NULL DEFAULT true, "status" "public"."organization_invitations_status_enum" NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP(0), "teamAssignments" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "acceptedAt" TIMESTAMP(0), "logtoInvitationId" character varying(128), "organizationId" character varying(36), "invitedById" character varying(36), CONSTRAINT "PK_f172f12b8a9ee6584b661f57e24" PRIMARY KEY ("id")); COMMENT ON COLUMN "organization_invitations"."teamAssignments" IS 'Array of team assignments with roles for automatic addition upon invitation acceptance'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orginv_org_status_exp" ON "organization_invitations" ("organizationId", "status", "expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orginv_token_email" ON "organization_invitations" ("token", "email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "teams_members" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "role" character varying(255) NOT NULL, "userId" character varying(36), "teamId" character varying(36), CONSTRAINT "PK_03affb28a3c43c8ec03e0e86eec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tm_team_user" ON "teams_members" ("teamId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_environment_enum" AS ENUM('production', 'staging', 'development')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_internetexposure_enum" AS ENUM('public', 'internal', 'airgapped')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_deploymenttype_enum" AS ENUM('saas', 'onprem', 'embedded', 'mobile')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_dataclassification_enum" AS ENUM('public', 'internal', 'confidential', 'regulated')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_businesscriticality_enum" AS ENUM('low', 'medium', 'high', 'mission_critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_userbasesize_enum" AS ENUM('small', 'medium', 'large')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_security_context_networksegmentation_enum" AS ENUM('flat', 'segmented', 'microsegmented')`,
    );
    await queryRunner.query(
      `CREATE TABLE "project_security_context" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(36) NOT NULL, "environment" "public"."project_security_context_environment_enum" NOT NULL DEFAULT 'production', "internetExposure" "public"."project_security_context_internetexposure_enum" NOT NULL DEFAULT 'public', "deploymentType" "public"."project_security_context_deploymenttype_enum" NOT NULL DEFAULT 'saas', "dataClassification" "public"."project_security_context_dataclassification_enum" NOT NULL DEFAULT 'confidential', "handlesPii" boolean NOT NULL DEFAULT false, "handlesPaymentData" boolean NOT NULL DEFAULT false, "businessCriticality" "public"."project_security_context_businesscriticality_enum" NOT NULL DEFAULT 'medium', "userBaseSize" "public"."project_security_context_userbasesize_enum" NOT NULL DEFAULT 'medium', "complianceFrameworks" text, "safetyCritical" boolean NOT NULL DEFAULT false, "networkSegmentation" "public"."project_security_context_networksegmentation_enum" NOT NULL DEFAULT 'flat', "isCustomized" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, CONSTRAINT "UQ_d03bbc8caeebd92dc6311cb49ae" UNIQUE ("projectId"), CONSTRAINT "REL_d03bbc8caeebd92dc6311cb49a" UNIQUE ("projectId"), CONSTRAINT "PK_9144cbf28a23ff254e865992b99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_lastscansourcetype_enum" AS ENUM('manual', 'cli', 'github', 'gitlab', 'jetbrains', 'vscode')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_issuecreationmode_enum" AS ENUM('per_vulnerability', 'per_vulnerability_type', 'per_file')`,
    );
    await queryRunner.query(
      `CREATE TABLE "project" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" citext NOT NULL, "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "cyber_risk_score" integer NOT NULL DEFAULT '0', "applicationType" character varying(255), "analysisFrequency" character varying(255), "emailAlertEnabled" boolean NOT NULL DEFAULT false, "monthlyReportEnabled" boolean NOT NULL DEFAULT false, "weeklyReportEnabled" boolean NOT NULL DEFAULT false, "sastEnabled" boolean NOT NULL DEFAULT false, "dastEnabled" boolean NOT NULL DEFAULT false, "scaEnabled" boolean NOT NULL DEFAULT false, "containerEnabled" boolean NOT NULL DEFAULT false, "apiEnabled" boolean NOT NULL DEFAULT false, "iacEnabled" boolean NOT NULL DEFAULT false, "secretEnabled" boolean NOT NULL DEFAULT true, "aibomEnabled" boolean NOT NULL DEFAULT false, "sastFastScanEnabled" boolean NOT NULL DEFAULT false, "diffScanMinSeverity" character varying(255) NOT NULL DEFAULT 'medium', "sastSeverities" text, "iacSeverities" text, "scaSeverities" text, "containerSeverities" text, "secretSeverities" text, "incidentCreationOption" character varying(255), "aiMergeRequestEnabled" boolean NOT NULL DEFAULT false, "improvingResultsEnabled" boolean NOT NULL DEFAULT false, "sortsVulnerabilitiesEnabled" boolean NOT NULL DEFAULT false, "scaTransitiveDependenciesEnabled" boolean NOT NULL DEFAULT false, "scaDevelopmentDependenciesEnabled" boolean NOT NULL DEFAULT false, "scaReachabilityPriorityEnabled" boolean NOT NULL DEFAULT true, "scaReachabilityStatusEnabled" boolean NOT NULL DEFAULT true, "securityChampionEnabled" boolean NOT NULL DEFAULT false, "vibedefendEnabled" boolean NOT NULL DEFAULT true, "appsec_enabled_at" TIMESTAMP(0), "scanOnCommitEnabled" boolean NOT NULL DEFAULT true, "agent_categories_sast" text, "agent_categories_iac" text, "agent_categories_cicd" text, "lastScanSourceType" "public"."project_lastscansourcetype_enum" DEFAULT 'manual', "githubIssueEnabled" boolean NOT NULL DEFAULT false, "gitlabIssueEnabled" boolean NOT NULL DEFAULT false, "issueCreationMode" "public"."project_issuecreationmode_enum" DEFAULT 'per_vulnerability_type', "issueCreationBranches" text, "referenceBranch" character varying(255), "notifSeverityThreshold" text, "notifScannerTypes" text, "zeroDayEmailEnabled" boolean NOT NULL DEFAULT true, "zeroDaySlackEnabled" boolean NOT NULL DEFAULT false, "zeroDaySeverityThreshold" text, "weeklyReportSlackEnabled" boolean NOT NULL DEFAULT false, "monthlyReportSlackEnabled" boolean NOT NULL DEFAULT false, "scanCompleteEmailEnabled" boolean NOT NULL DEFAULT false, "scanCompleteSlackEnabled" boolean NOT NULL DEFAULT false, "creatorId" character varying(36), "teamId" character varying(36), CONSTRAINT "PK_4d68b1358bb5b766d3e78f32f57" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_project_cyber_risk_score" ON "project" ("cyber_risk_score") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_project_team_name" ON "project" ("teamId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "team" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" citext NOT NULL, "description" character varying(255) NOT NULL, "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "creatorId" character varying(36), "organizationId" character varying(36), CONSTRAINT "PK_f57d8293406df4af348402e4b74" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_org_name" ON "team" ("organizationId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "organization" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "industry" character varying(255) NOT NULL, "country" character varying(255) NOT NULL, "isActive" boolean NOT NULL DEFAULT false, "concurrentScanLimit" integer NOT NULL DEFAULT '1', "member_products" boolean NOT NULL DEFAULT false, "diffScanMaxParallelPerUser" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "creatorId" character varying(36), CONSTRAINT "PK_472c1f99a32def1b0abb219cd67" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users_organizations_members" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "role" character varying(255) NOT NULL, "appsec_access" boolean NOT NULL DEFAULT true, "vibedefend_access" boolean NOT NULL DEFAULT true, "userId" character varying(36), "organizationId" character varying(36), CONSTRAINT "PK_f4ec086b09a3a6780f68c97a6d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uom_org_user" ON "users_organizations_members" ("organizationId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "firstName" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "lastName" character varying(255) NOT NULL, "picture" character varying(8192) NOT NULL, "notification" boolean NOT NULL DEFAULT true, "isOnboardingCompleted" boolean NOT NULL DEFAULT false, "onboardingProgress" text, "onboardingPersona" character varying(32), "onboardingUsage" character varying(128), "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "logtoUserId" character varying(128), CONSTRAINT "UQ_ac8c8146b527c9372ce65bc72ed" UNIQUE ("logtoUserId"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_email_unique" ON "user" ("email") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."project_branch_ingestion_status_enum" AS ENUM('parsing', 'parsed', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "project_branch_ingestion" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "branch" character varying(255) NOT NULL, "lastParsedScanId" character varying(36), "lastParsedAt" TIMESTAMP(0), "status" "public"."project_branch_ingestion_status_enum" NOT NULL DEFAULT 'parsing', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, CONSTRAINT "UQ_23b17065086a9bed0bf5fa9c09b" UNIQUE ("projectId", "branch"), CONSTRAINT "PK_de9a5021d30a8c378056790306b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "data_purge_job" ("id" character varying(36) NOT NULL, "kind" character varying(16) NOT NULL, "subjectId" character varying(36) NOT NULL, "organizationId" character varying(36) NOT NULL, "teamIds" jsonb, "deletedAt" TIMESTAMP(3) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "pass" integer NOT NULL DEFAULT '1', "nextAttemptAt" TIMESTAMP(3) NOT NULL, "leaseUntil" TIMESTAMP(3), "leaseToken" character varying(36), "completedAt" TIMESTAMP(3), CONSTRAINT "PK_9b8fe50e5bdf23b1e3c3012c773" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_data_purge_job_subject" ON "data_purge_job" ("subjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_data_purge_job_status_next_attempt" ON "data_purge_job" ("status", "nextAttemptAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "data_purge_step" ("jobId" character varying(36) NOT NULL, "step" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP(3) NOT NULL, "lastErrorCode" character varying(32), "doneAt" TIMESTAMP(3), "deleted" jsonb, CONSTRAINT "PK_94e209ca8f6b91f3cb7c421c02f" PRIMARY KEY ("jobId", "step"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "archived_branch" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(36) NOT NULL, "branchName" character varying(255) NOT NULL, "archivedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9aa978067381d962baad8d25e26" UNIQUE ("projectId", "branchName"), CONSTRAINT "PK_f3d092536ddde2645b77a463d4f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "organization_deletion_code" ("organizationId" character varying(36) NOT NULL, "userId" character varying(36) NOT NULL, "codeHash" character varying(64), "codeSalt" character varying(32), "expiresAt" TIMESTAMP(3), "attempts" integer NOT NULL DEFAULT '0', "sentAt" TIMESTAMP(3), "sendsWindowStart" TIMESTAMP(3), "sendsInWindow" integer NOT NULL DEFAULT '0', "failuresWindowStart" TIMESTAMP(3), "failuresInWindow" integer NOT NULL DEFAULT '0', "lockedUntil" TIMESTAMP(3), CONSTRAINT "PK_3318d11ad85fe790bed45f88310" PRIMARY KEY ("organizationId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_a36b0344f658384839d0ca39483" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_42551a8640e76595be597bd4f20" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams_members" ADD CONSTRAINT "FK_23a92ad171fd437c27a3d5d9c06" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams_members" ADD CONSTRAINT "FK_1614df13b7c208ea6d6f26ccd4a" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_security_context" ADD CONSTRAINT "FK_d03bbc8caeebd92dc6311cb49ae" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD CONSTRAINT "FK_cfb02dac45e9dec5b82f960b3e3" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD CONSTRAINT "FK_d0474b642dc0ae63660dd8e2ac0" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" ADD CONSTRAINT "FK_221f660916dd8a58ff7269aaf8c" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" ADD CONSTRAINT "FK_12e10686074dba7e8fd02f41bf4" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization" ADD CONSTRAINT "FK_221ca61526d7f786a4c4a46e59b" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users_organizations_members" ADD CONSTRAINT "FK_9a3e621ae64354cdac680ae79de" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users_organizations_members" ADD CONSTRAINT "FK_54f8f5048722018b8acbc59393a" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_branch_ingestion" ADD CONSTRAINT "FK_58eab6cb4ce300ce4557f685233" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "data_purge_step" ADD CONSTRAINT "FK_data_purge_step_job" FOREIGN KEY ("jobId") REFERENCES "data_purge_job"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "archived_branch" ADD CONSTRAINT "FK_b232f25fa4ac24d876670035a31" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_deletion_code" ADD CONSTRAINT "FK_organization_deletion_code_organization" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organization_deletion_code" DROP CONSTRAINT "FK_organization_deletion_code_organization"`,
    );
    await queryRunner.query(
      `ALTER TABLE "archived_branch" DROP CONSTRAINT "FK_b232f25fa4ac24d876670035a31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "data_purge_step" DROP CONSTRAINT "FK_data_purge_step_job"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_branch_ingestion" DROP CONSTRAINT "FK_58eab6cb4ce300ce4557f685233"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users_organizations_members" DROP CONSTRAINT "FK_54f8f5048722018b8acbc59393a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users_organizations_members" DROP CONSTRAINT "FK_9a3e621ae64354cdac680ae79de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization" DROP CONSTRAINT "FK_221ca61526d7f786a4c4a46e59b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" DROP CONSTRAINT "FK_12e10686074dba7e8fd02f41bf4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" DROP CONSTRAINT "FK_221f660916dd8a58ff7269aaf8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP CONSTRAINT "FK_d0474b642dc0ae63660dd8e2ac0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP CONSTRAINT "FK_cfb02dac45e9dec5b82f960b3e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_security_context" DROP CONSTRAINT "FK_d03bbc8caeebd92dc6311cb49ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams_members" DROP CONSTRAINT "FK_1614df13b7c208ea6d6f26ccd4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams_members" DROP CONSTRAINT "FK_23a92ad171fd437c27a3d5d9c06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_42551a8640e76595be597bd4f20"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_a36b0344f658384839d0ca39483"`,
    );
    await queryRunner.query(`DROP TABLE "organization_deletion_code"`);
    await queryRunner.query(`DROP TABLE "archived_branch"`);
    await queryRunner.query(`DROP TABLE "data_purge_step"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_data_purge_job_status_next_attempt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_data_purge_job_subject"`);
    await queryRunner.query(`DROP TABLE "data_purge_job"`);
    await queryRunner.query(`DROP TABLE "project_branch_ingestion"`);
    await queryRunner.query(
      `DROP TYPE "public"."project_branch_ingestion_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_user_email_unique"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_uom_org_user"`);
    await queryRunner.query(`DROP TABLE "users_organizations_members"`);
    await queryRunner.query(`DROP TABLE "organization"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_team_org_name"`);
    await queryRunner.query(`DROP TABLE "team"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_project_team_name"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_project_cyber_risk_score"`,
    );
    await queryRunner.query(`DROP TABLE "project"`);
    await queryRunner.query(
      `DROP TYPE "public"."project_issuecreationmode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_lastscansourcetype_enum"`,
    );
    await queryRunner.query(`DROP TABLE "project_security_context"`);
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_networksegmentation_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_userbasesize_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_businesscriticality_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_dataclassification_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_deploymenttype_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_internetexposure_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."project_security_context_environment_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_tm_team_user"`);
    await queryRunner.query(`DROP TABLE "teams_members"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orginv_token_email"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orginv_org_status_exp"`);
    await queryRunner.query(`DROP TABLE "organization_invitations"`);
    await queryRunner.query(
      `DROP TYPE "public"."organization_invitations_status_enum"`,
    );
  }
}
