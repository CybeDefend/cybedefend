import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViolationAcknowledgeFields1737100000000 implements MigrationInterface {
  name = 'AddViolationAcknowledgeFields1737100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new acknowledged fields to policy_violations table
    await queryRunner.query(`
      ALTER TABLE "policy_violations"
      ADD COLUMN IF NOT EXISTS "acknowledged" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "acknowledgedBy" uuid,
      ADD COLUMN IF NOT EXISTS "acknowledgementReason" text,
      ADD COLUMN IF NOT EXISTS "affectedVulnerabilitiesCount" integer NOT NULL DEFAULT 1
    `);

    // Create index on acknowledged column
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_violations_acknowledged" 
      ON "policy_violations" ("acknowledged")
    `);

    // Drop legacy columns and severity
    await queryRunner.query(`
      ALTER TABLE "policy_violations"
      DROP COLUMN IF EXISTS "resolved",
      DROP COLUMN IF EXISTS "resolvedAt",
      DROP COLUMN IF EXISTS "resolvedBy",
      DROP COLUMN IF EXISTS "resolutionReason",
      DROP COLUMN IF EXISTS "severity"
    `);

    // Drop index on resolved column if it exists
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_policy_violations_resolved"
    `);

    // Drop the severity enum type if it exists
    await queryRunner.query(`
      DROP TYPE IF EXISTS "policy_violations_severity_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the severity enum type
    await queryRunner.query(`
      CREATE TYPE "policy_violations_severity_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    `);

    // Recreate legacy columns and severity
    await queryRunner.query(`
      ALTER TABLE "policy_violations"
      ADD COLUMN IF NOT EXISTS "resolved" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "resolvedBy" uuid,
      ADD COLUMN IF NOT EXISTS "resolutionReason" text,
      ADD COLUMN IF NOT EXISTS "severity" "policy_violations_severity_enum" NOT NULL DEFAULT 'MEDIUM'
    `);

    // Recreate index on resolved
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_violations_resolved" ON "policy_violations" ("resolved")
    `);

    // Drop index on acknowledged
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_policy_violations_acknowledged"
    `);

    // Remove the new columns
    await queryRunner.query(`
      ALTER TABLE "policy_violations"
      DROP COLUMN IF EXISTS "acknowledged",
      DROP COLUMN IF EXISTS "acknowledgedAt",
      DROP COLUMN IF EXISTS "acknowledgedBy",
      DROP COLUMN IF EXISTS "acknowledgementReason",
      DROP COLUMN IF EXISTS "affectedVulnerabilitiesCount"
    `);
  }
}
