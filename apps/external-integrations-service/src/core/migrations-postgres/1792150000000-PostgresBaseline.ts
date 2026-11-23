import { MigrationInterface, QueryRunner } from 'typeorm';
import { createUpdatedAtTrigger } from '@cybedefend/db-dialect';
import { BASELINE_UPDATED_AT_COLUMNS as UPDATED_AT_COLUMNS } from '../db/updated-at-columns';

/**
 * The PostgreSQL track of external-integrations: the schema of
 * the core entities as the frozen MySQL track leaves it, generated from those
 * entities (src/entities/, never src/ee/) against an empty PostgreSQL 16,
 * then completed by hand so that both engines end with the same schema
 * (schema-parity.live.spec.ts):
 * - every varchar without a length is varchar(255), the length TypeORM gives
 *   it on MySQL;
 * - the timestamps the MySQL track keeps to the second (timestamp/datetime
 *   without precision) are TIMESTAMP(0): the createdAt/updatedAt of the
 *   github, jira and slack tables, github_repositories, and the
 *   tokenExpiresAt/refreshTokenExpiresAt columns;
 * - the migration-only key the frozen track actually keeps: jira_integrations'
 *   webhookSecret index (1780200000000);
 * - one updated-at trigger per entry of UPDATED_AT_COLUMNS: PostgreSQL has no
 *   ON UPDATE, the MySQL track carries ON UPDATE CURRENT_TIMESTAMP[(6)].
 * No citext (no ciText column), no seed row. Every later schema change is a
 * common migration (src/core/migrations-common/). It creates no table of a
 * closed entity: those are the closed edition's own PostgreSQL migrations.
 */
export class PostgresBaseline1792150000000 implements MigrationInterface {
  name = 'PostgresBaseline1792150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."vulnerability_issue_mapping_platform_enum" AS ENUM('github', 'gitlab', 'jira')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vulnerability_issue_mapping" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "projectId" character varying(255) NOT NULL, "vulnerabilityId" character varying(255) NOT NULL, "scannerType" character varying(255) NOT NULL, "platform" "public"."vulnerability_issue_mapping_platform_enum" NOT NULL, "externalIssueId" character varying(255) NOT NULL, "issueUrl" character varying(255), "issueTitle" character varying(255) NOT NULL, "issueState" character varying(255) NOT NULL DEFAULT 'open', "repositoryId" character varying(255), "scanId" character varying(255), "groupKey" character varying(255), "creationMode" character varying(255), "jiraProjectKey" character varying(255), "jiraPriority" character varying(255), "jiraAssignee" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8f7d1d757c590821f4b23f74ee6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d639106102c8fcd5b44ac3ed1b" ON "vulnerability_issue_mapping" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vuln_issue_external" ON "vulnerability_issue_mapping" ("platform", "externalIssueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vuln_issue_project_platform" ON "vulnerability_issue_mapping" ("projectId", "platform") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vuln_issue_project_vuln" ON "vulnerability_issue_mapping" ("projectId", "vulnerabilityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "slack_channel_mappings" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "integrationId" character varying(36) NOT NULL, "projectId" character varying(36) NOT NULL, "channelId" character varying(255) NOT NULL, "channelName" character varying(255) NOT NULL, "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "UQ_slack_channel_mappings_projectId" UNIQUE ("projectId"), CONSTRAINT "PK_13263453668ab64770d8ad401e9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "slack_integrations" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "organizationId" character varying(36) NOT NULL, "teamId" character varying(255) NOT NULL, "teamName" character varying(255) NOT NULL, "accessToken" text NOT NULL, "refreshToken" text, "installedByUserId" character varying(36), "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "UQ_slack_integrations_organizationId" UNIQUE ("organizationId"), CONSTRAINT "PK_eadf605e2672ec04ee58999bb03" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "jira_integrations" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "organizationId" character varying(36) NOT NULL, "cloudId" character varying(255) NOT NULL, "siteName" character varying(255) NOT NULL, "siteUrl" character varying(512) NOT NULL, "accessToken" text NOT NULL, "refreshToken" text, "tokenExpiresAt" TIMESTAMP(0), "webhookSecret" character varying(64), "webhookId" integer, "installedByUserId" character varying(36), "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "UQ_jira_integrations_organizationId" UNIQUE ("organizationId"), CONSTRAINT "PK_f7e2150c4af98c521ce39992d7a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "jira_project_mappings" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "integrationId" character varying(36) NOT NULL, "projectId" character varying(36) NOT NULL, "jiraProjectId" character varying(255) NOT NULL, "jiraProjectKey" character varying(50) NOT NULL, "jiraProjectName" character varying(255) NOT NULL, "allowedBranches" text, "autoCreateEnabled" smallint NOT NULL DEFAULT '0', "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "UQ_jira_project_mappings_projectId" UNIQUE ("projectId"), CONSTRAINT "PK_0e69b4ef245e70a0f980fcc4256" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "gitlab_branches" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "isProtected" boolean NOT NULL DEFAULT false, "repositoryId" character varying(36) NOT NULL, "firstSeenAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "lastSeenAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, CONSTRAINT "PK_77ca0e7ab289bb757f5905c51c3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_gitlab_branches_unique_name_per_repo" ON "gitlab_branches" ("repositoryId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gitlab_repositories" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "gitlabId" integer NOT NULL, "name" character varying(255) NOT NULL, "nameWithNamespace" character varying(512) NOT NULL, "path" character varying(255) NOT NULL, "pathWithNamespace" character varying(512) NOT NULL, "private" boolean NOT NULL, "defaultBranch" character varying(255), "description" text, "webUrl" character varying(512), "sshUrlToRepo" character varying(512), "httpUrlToRepo" character varying(512), "projectId" character varying(255), "scanBranch" character varying(255), "webhookId" integer, "integrationId" character varying(255) NOT NULL, "branchesSyncedAt" TIMESTAMP(6), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7fad6f14e6ea30f8b4ef3a42816" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_repo_projectId" ON "gitlab_repositories" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gitlab_integrations" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "userId" character varying(255), "organizationId" character varying(255), "gitlabUserId" integer, "gitlabGroupId" integer, "accessToken" text, "refreshToken" text, "refreshTokenExpiresAt" TIMESTAMP(0), "tokenExpiresAt" TIMESTAMP(0), "scope" character varying(255), "reconnectRequiredAt" TIMESTAMP(6), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c8840e1a6846f148391c90731ed" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_integ_organizationId" ON "gitlab_integrations" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "github_integrations" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "installationId" integer NOT NULL, "userId" character varying(255), "organizationId" character varying(255), "githubOwner" character varying(255), "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "UQ_github_integrations_installationId" UNIQUE ("installationId"), CONSTRAINT "PK_11471a10a0f6e388dfc8cef0b0a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gh_integ_organizationId" ON "github_integrations" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "github_branches" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "name" character varying(255) NOT NULL, "isProtected" boolean NOT NULL DEFAULT false, "repositoryId" character varying(36) NOT NULL, "firstSeenAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "lastSeenAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "createdAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone, CONSTRAINT "PK_1d6eef97fe8fe9c1d02adb090af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_github_branches_unique_name_per_repo" ON "github_branches" ("repositoryId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "github_repositories" ("id" character varying(36) NOT NULL DEFAULT gen_random_uuid()::text, "githubId" integer NOT NULL, "nodeId" character varying(255) NOT NULL, "name" character varying(255) NOT NULL, "fullName" character varying(255) NOT NULL, "private" boolean NOT NULL, "projectId" character varying(255), "defaultBranch" character varying(255), "scanBranch" character varying(255), "integrationId" character varying(255) NOT NULL, "branchesSyncedAt" TIMESTAMP(6), "createdAt" TIMESTAMP(0) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(0) NOT NULL DEFAULT now(), CONSTRAINT "PK_b79a368b43cd2b79b14ca6fb2e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gh_repo_projectId" ON "github_repositories" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_github_repositories_unique_repo_per_install" ON "github_repositories" ("githubId", "integrationId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "slack_channel_mappings" ADD CONSTRAINT "FK_7ab1bce613763951666ebb7e7e6" FOREIGN KEY ("integrationId") REFERENCES "slack_integrations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_project_mappings" ADD CONSTRAINT "FK_2075490f2d9f51866204b70f0c3" FOREIGN KEY ("integrationId") REFERENCES "jira_integrations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gitlab_branches" ADD CONSTRAINT "FK_a70c2a297e0b3208311942b1d08" FOREIGN KEY ("repositoryId") REFERENCES "gitlab_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gitlab_repositories" ADD CONSTRAINT "FK_55017e94dd607b9465a28bf780a" FOREIGN KEY ("integrationId") REFERENCES "gitlab_integrations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_branches" ADD CONSTRAINT "FK_b3b2585dd45218eb593aab2cb5d" FOREIGN KEY ("repositoryId") REFERENCES "github_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_repositories" ADD CONSTRAINT "FK_7436eb961eda3f5da7e6de60605" FOREIGN KEY ("integrationId") REFERENCES "github_integrations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // The migration-only key the frozen MySQL track actually keeps: the
    // jira webhookSecret index comes from 1780200000000.
    await queryRunner.query(
      `CREATE INDEX "IDX_jira_integrations_webhookSecret" ON "jira_integrations" ("webhookSecret") `,
    );
    for (const [table, column] of UPDATED_AT_COLUMNS) {
      await createUpdatedAtTrigger(queryRunner, table, column);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [, column] of UPDATED_AT_COLUMNS) {
      await queryRunner.query(
        `DROP FUNCTION IF EXISTS "cd_touch_${column}"() CASCADE`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_jira_integrations_webhookSecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_repositories" DROP CONSTRAINT "FK_7436eb961eda3f5da7e6de60605"`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_branches" DROP CONSTRAINT "FK_b3b2585dd45218eb593aab2cb5d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gitlab_repositories" DROP CONSTRAINT "FK_55017e94dd607b9465a28bf780a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gitlab_branches" DROP CONSTRAINT "FK_a70c2a297e0b3208311942b1d08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_project_mappings" DROP CONSTRAINT "FK_2075490f2d9f51866204b70f0c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "slack_channel_mappings" DROP CONSTRAINT "FK_7ab1bce613763951666ebb7e7e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_github_repositories_unique_repo_per_install"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_gh_repo_projectId"`);
    await queryRunner.query(`DROP TABLE "github_repositories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_github_branches_unique_name_per_repo"`,
    );
    await queryRunner.query(`DROP TABLE "github_branches"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_gh_integ_organizationId"`,
    );
    await queryRunner.query(`DROP TABLE "github_integrations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_gl_integ_organizationId"`,
    );
    await queryRunner.query(`DROP TABLE "gitlab_integrations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gl_repo_projectId"`);
    await queryRunner.query(`DROP TABLE "gitlab_repositories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_gitlab_branches_unique_name_per_repo"`,
    );
    await queryRunner.query(`DROP TABLE "gitlab_branches"`);
    await queryRunner.query(`DROP TABLE "jira_project_mappings"`);
    await queryRunner.query(`DROP TABLE "jira_integrations"`);
    await queryRunner.query(`DROP TABLE "slack_integrations"`);
    await queryRunner.query(`DROP TABLE "slack_channel_mappings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vuln_issue_project_vuln"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vuln_issue_project_platform"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_vuln_issue_external"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d639106102c8fcd5b44ac3ed1b"`,
    );
    await queryRunner.query(`DROP TABLE "vulnerability_issue_mapping"`);
    await queryRunner.query(
      `DROP TYPE "public"."vulnerability_issue_mapping_platform_enum"`,
    );
  }
}
