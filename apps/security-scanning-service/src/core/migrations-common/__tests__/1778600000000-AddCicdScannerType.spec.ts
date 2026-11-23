import { QueryRunner } from 'typeorm';
import { AddCicdScannerType1778600000000 as Migration } from '../1778600000000-AddCicdScannerType';
import { ScannerTypeValues } from '../../../entities/scanner.entity';

/**
 * A CI/CD scan reads the scanners of type `cicd` (their progress weights).
 * The scanner type enum lacked that value, so PostgreSQL refused the lookup
 * on every CI/CD scan (invalid input value for enum). The migration adds it
 * on both engines through `addEnumValue`; the fake runner records the SQL it
 * sends.
 */
type Engine = 'mysql' | 'postgres';

const MYSQL_ENUM = "enum('sast','iac','sca','container','secret','aibom')";

const fakeRunner = (engine: Engine, columnType = MYSQL_ENUM) => {
  const queries: string[] = [];
  const connection = { options: { type: engine } };
  const runner = {
    connection,
    manager: { connection },
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [
          {
            columnType,
            isNullable: 'NO',
            columnDefault: null,
            charset: 'utf8mb4',
            collation: 'utf8mb4_0900_ai_ci',
            comment: '',
            extra: '',
          },
        ];
      }
      return [];
    }),
  };
  return { runner: runner as unknown as QueryRunner, queries };
};

describe('AddCicdScannerType1778600000000', () => {
  it('lists cicd among the scanner types of the entity', () => {
    expect(ScannerTypeValues).toContain('cicd');
  });

  it('adds cicd to the PostgreSQL enum type, idempotently', async () => {
    const { runner, queries } = fakeRunner('postgres');

    await new Migration().up(runner);

    expect(queries).toEqual([
      `ALTER TYPE "scanner_scannerType_enum" ADD VALUE IF NOT EXISTS 'cicd'`,
    ]);
  });

  it('appends cicd to the MySQL enum, after the existing values', async () => {
    const { runner, queries } = fakeRunner('mysql');

    await new Migration().up(runner);

    const alter = queries.filter((q) => q.startsWith('ALTER TABLE'));
    expect(alter).toEqual([
      "ALTER TABLE `scanner` MODIFY `scannerType` ENUM('sast','iac','sca','container','secret','aibom','cicd') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL",
    ]);
  });

  it('does nothing on MySQL when cicd is already there', async () => {
    const { runner, queries } = fakeRunner(
      'mysql',
      "enum('sast','iac','sca','container','secret','aibom','cicd')",
    );

    await new Migration().up(runner);

    expect(queries.some((q) => q.startsWith('ALTER'))).toBe(false);
  });

  it('keeps the value on the way down: a PostgreSQL enum value cannot be dropped', async () => {
    const { runner, queries } = fakeRunner('postgres');

    await new Migration().down(runner);

    expect(queries).toEqual([]);
  });
});
