import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveViolationAcknowledgeFields1737200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop index on acknowledged
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_policy_violations_acknowledged"
    `);

    // Remove acknowledged fields from policy_violations table
    await queryRunner.query(`
      ALTER TABLE "policy_violations" 
      DROP COLUMN IF EXISTS "acknowledged",
      DROP COLUMN IF EXISTS "acknowledgedAt",
      DROP COLUMN IF EXISTS "acknowledgedBy",
      DROP COLUMN IF EXISTS "acknowledgementReason"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add acknowledged fields back to policy_violations table
    await queryRunner.query(`
      ALTER TABLE "policy_violations" 
      ADD COLUMN IF NOT EXISTS "acknowledged" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "acknowledgedBy" uuid,
      ADD COLUMN IF NOT EXISTS "acknowledgementReason" text
    `);

    // Create index on acknowledged column
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_violations_acknowledged" 
      ON "policy_violations" ("acknowledged")
    `);
  }
}
