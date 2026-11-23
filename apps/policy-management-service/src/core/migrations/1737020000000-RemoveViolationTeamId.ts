import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveViolationTeamId1737020000000 implements MigrationInterface {
  name = 'RemoveViolationTeamId1737020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the index on teamId
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_policy_violations_teamId"`,
    );

    // Drop the teamId column
    await queryRunner.query(
      `ALTER TABLE "policy_violations" DROP COLUMN IF EXISTS "teamId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the teamId column
    await queryRunner.query(
      `ALTER TABLE "policy_violations" ADD COLUMN "teamId" uuid NULL`,
    );

    // Re-create the index
    await queryRunner.query(
      `CREATE INDEX "IDX_policy_violations_teamId" ON "policy_violations" ("teamId")`,
    );
  }
}
