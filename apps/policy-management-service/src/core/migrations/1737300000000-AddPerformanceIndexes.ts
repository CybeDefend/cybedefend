import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds missing performance indexes for the Policy Management Service.
 *
 * PostgreSQL does NOT auto-index foreign keys, and existing indexes do not
 * cover several hot query shapes:
 *
 * 1. policy_violations (organizationId, actionTaken, createdAt)
 *    - Existing (organizationId, createdAt) does not cover the actionTaken
 *      equality predicate sitting between the org filter and the createdAt
 *      sort/range.
 * 2. policy_evaluations (projectId, status)
 *    - Existing single (projectId) index covers the leftmost prefix only;
 *      the status filter is uncovered. The UNIQUE (scanId, projectId) has
 *      scanId leftmost, so projectId is not usable as a leading column there.
 * 3. security_policies GIN (projectIds) — jsonb containment (@>) lookups.
 * 4. security_policies GIN (teamIds)    — jsonb containment (@>) lookups.
 *
 * NOTE (operations): these use plain CREATE INDEX (brief table lock).
 * TypeORM wraps each migration in a transaction by default, and
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction. If a lock-free
 * rebuild is required on a large production table, re-run the equivalent
 * `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` statements manually, outside
 * a transaction, during a maintenance window.
 */
export class AddPerformanceIndexes1737300000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1737300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. policy_violations (organizationId, actionTaken, createdAt)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_violations_org_action_createdAt"
      ON "policy_violations" ("organizationId", "actionTaken", "createdAt")
    `);

    // 2. policy_evaluations (projectId, status)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_evaluations_projectId_status"
      ON "policy_evaluations" ("projectId", "status")
    `);

    // 3. security_policies GIN (projectIds) — jsonb containment
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_policies_projectIds_gin"
      ON "security_policies" USING GIN ("projectIds")
    `);

    // 4. security_policies GIN (teamIds) — jsonb containment
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_policies_teamIds_gin"
      ON "security_policies" USING GIN ("teamIds")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_security_policies_teamIds_gin"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_security_policies_projectIds_gin"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_policy_evaluations_projectId_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_policy_violations_org_action_createdAt"
    `);
  }
}
