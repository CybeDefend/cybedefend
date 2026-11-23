import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema migration for Policy Management Service
 *
 * Creates all tables for:
 * - security_policies: Security policies with YAML-based rules
 * - policy_violations: Records of policy violations
 * - policy_evaluations: Async evaluation status tracking
 */
export class InitialSchema1736900000000 implements MigrationInterface {
  name = 'InitialSchema1736900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      CREATE TYPE "policy_scope_enum" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT')
    `);

    await queryRunner.query(`
      CREATE TYPE "violation_action_enum" AS ENUM ('WARN', 'BLOCK')
    `);

    await queryRunner.query(`
      CREATE TYPE "violation_severity_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    `);

    await queryRunner.query(`
      CREATE TYPE "evaluation_status_enum" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')
    `);

    // Create security_policies table
    await queryRunner.query(`
      CREATE TABLE "security_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scope" "policy_scope_enum" NOT NULL DEFAULT 'PROJECT',
        "organizationId" uuid NOT NULL,
        "projectIds" jsonb NOT NULL DEFAULT '[]',
        "teamIds" jsonb NOT NULL DEFAULT '[]',
        "name" character varying(255) NOT NULL,
        "description" text,
        "priority" integer NOT NULL DEFAULT 50,
        "rules" jsonb NOT NULL DEFAULT '{}',
        "exclusions" jsonb NOT NULL DEFAULT '[]',
        "isEnabled" boolean NOT NULL DEFAULT true,
        "createdBy" uuid,
        "updatedBy" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_policies" PRIMARY KEY ("id")
      )
    `);

    // Create indexes for security_policies
    await queryRunner.query(`
      CREATE INDEX "IDX_security_policies_organizationId" ON "security_policies" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_security_policies_scope_organizationId" ON "security_policies" ("scope", "organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_security_policies_isEnabled" ON "security_policies" ("isEnabled")
    `);

    // Create policy_violations table
    await queryRunner.query(`
      CREATE TABLE "policy_violations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "policyId" uuid NOT NULL,
        "projectId" uuid NOT NULL,
        "scanId" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "teamId" uuid,
        "ruleId" character varying(255) NOT NULL,
        "ruleName" character varying(255) NOT NULL,
        "severity" "violation_severity_enum" NOT NULL DEFAULT 'MEDIUM',
        "actionTaken" "violation_action_enum" NOT NULL DEFAULT 'WARN',
        "violationDetails" jsonb NOT NULL DEFAULT '{}',
        "resolved" boolean NOT NULL DEFAULT false,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "resolvedBy" uuid,
        "resolutionReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_policy_violations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_policy_violations_policyId" FOREIGN KEY ("policyId") 
          REFERENCES "security_policies"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes for policy_violations
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_policyId" ON "policy_violations" ("policyId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_projectId" ON "policy_violations" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_scanId" ON "policy_violations" ("scanId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_organizationId" ON "policy_violations" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_teamId" ON "policy_violations" ("teamId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_policyId_scanId" ON "policy_violations" ("policyId", "scanId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_projectId_createdAt" ON "policy_violations" ("projectId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_organizationId_createdAt" ON "policy_violations" ("organizationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_violations_resolved" ON "policy_violations" ("resolved")
    `);

    // Create policy_evaluations table
    await queryRunner.query(`
      CREATE TABLE "policy_evaluations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scanId" uuid NOT NULL,
        "projectId" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        "teamId" uuid,
        "status" "evaluation_status_enum" NOT NULL DEFAULT 'PENDING',
        "progressPercentage" integer NOT NULL DEFAULT 0,
        "compliant" boolean,
        "action" "violation_action_enum",
        "resultDetails" jsonb,
        "errorMessage" text,
        "triggeredBy" uuid,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_policy_evaluations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_policy_evaluations_scanId_projectId" UNIQUE ("scanId", "projectId")
      )
    `);

    // Create indexes for policy_evaluations
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_evaluations_scanId" ON "policy_evaluations" ("scanId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_evaluations_projectId" ON "policy_evaluations" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_evaluations_organizationId" ON "policy_evaluations" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_policy_evaluations_status" ON "policy_evaluations" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "policy_evaluations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "policy_violations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_policies"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "evaluation_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "violation_severity_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "violation_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "policy_scope_enum"`);
  }
}
