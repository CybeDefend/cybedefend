import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValue } from '@cybedefend/db-dialect';

/**
 * Adds `cicd` to the scanner type enum (`scanner.scannerType`).
 *
 * A CI/CD scan looks up the scanners of its type to weigh its progress.
 * Without the value, PostgreSQL refuses that lookup on every CI/CD scan
 * (`invalid input value for enum`), where MySQL only finds no row.
 *
 * Common migration: `addEnumValue` extends the PostgreSQL enum type
 * (`ADD VALUE IF NOT EXISTS`) and rewrites the MySQL column from its live
 * definition with the new value last, so stored rows keep their index. Both
 * are no-ops when the value is already there.
 *
 * `down` keeps the value: PostgreSQL cannot drop a value from an enum type,
 * and an extra value harms nothing.
 */
export class AddCicdScannerType1778600000000 implements MigrationInterface {
  name = 'AddCicdScannerType1778600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addEnumValue(queryRunner, 'scanner', 'scannerType', ['cicd']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The value stays: see the class comment.
    void queryRunner;
  }
}
