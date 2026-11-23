import type { QueryRunner } from 'typeorm';
import { addEnumValue, createUpdatedAtTrigger, ensureExtension } from '../index';

type FakeRunner = {
  query: jest.Mock;
  manager: { connection: { options: { type: string } } };
  getTable?: jest.Mock;
  changeColumn?: jest.Mock;
};

function fakeRunner(type: 'mysql' | 'postgres', extra: Partial<FakeRunner> = {}): FakeRunner {
  return {
    query: jest.fn(async () => ({})),
    manager: { connection: { options: { type } } },
    ...extra,
  };
}

describe('migration helpers', () => {
  it('ensureExtension creates citext on postgres only', async () => {
    const pg = fakeRunner('postgres');
    await ensureExtension(pg as unknown as QueryRunner, 'citext');
    expect(pg.query).toHaveBeenCalledTimes(1);
    expect(pg.query.mock.calls[0][0]).toBe('CREATE EXTENSION IF NOT EXISTS "citext"');
    const my = fakeRunner('mysql');
    await ensureExtension(my as unknown as QueryRunner, 'citext');
    expect(my.query).not.toHaveBeenCalled();
  });

  it('createUpdatedAtTrigger issues the function and the trigger on postgres, nothing on mysql', async () => {
    const pg = fakeRunner('postgres');
    await createUpdatedAtTrigger(pg as unknown as QueryRunner, 'scan', 'updatedAt');
    expect(pg.query).toHaveBeenCalledTimes(2);
    const fn = pg.query.mock.calls[0][0] as string;
    expect(fn).toContain('CREATE OR REPLACE FUNCTION "cd_touch_updatedAt"()');
    expect(fn).toContain(
      'IF NEW."updatedAt" IS NOT DISTINCT FROM OLD."updatedAt" AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN NEW."updatedAt" = CURRENT_TIMESTAMP; END IF;',
    );
    expect(fn).toContain('RETURN NEW;');
    expect(pg.query.mock.calls[1][0]).toBe(
      'CREATE TRIGGER "trg_scan_updatedAt" BEFORE UPDATE ON "scan" FOR EACH ROW EXECUTE FUNCTION "cd_touch_updatedAt"()',
    );
    const my = fakeRunner('mysql');
    await createUpdatedAtTrigger(my as unknown as QueryRunner, 'scan', 'updatedAt');
    expect(my.query).not.toHaveBeenCalled();
  });

  it('addEnumValue alters the enum type on postgres, one statement per value', async () => {
    const pg = fakeRunner('postgres');
    await addEnumValue(pg as unknown as QueryRunner, 'scan', 'scanType', ['x', 'y']);
    expect(pg.query).toHaveBeenCalledTimes(2);
    expect(pg.query.mock.calls[0][0]).toBe(
      `ALTER TYPE "scan_scanType_enum" ADD VALUE IF NOT EXISTS 'x'`,
    );
    expect(pg.query.mock.calls[1][0]).toBe(
      `ALTER TYPE "scan_scanType_enum" ADD VALUE IF NOT EXISTS 'y'`,
    );
  });

  describe('addEnumValue on mysql', () => {
    type ColumnRow = {
      columnType: string;
      isNullable: 'YES' | 'NO';
      columnDefault: string | null;
      charset: string | null;
      collation: string | null;
      comment: string;
      extra: string;
    };
    const enumColumn = (over: Partial<ColumnRow> = {}): ColumnRow => ({
      columnType: "enum('github','gitlab','jira')",
      isNullable: 'NO',
      columnDefault: null,
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
      comment: '',
      extra: '',
      ...over,
    });
    // a runner whose INFORMATION_SCHEMA read answers `rows`; every other statement is recorded
    const mysqlRunner = (rows: ColumnRow[]) =>
      fakeRunner('mysql', {
        query: jest.fn(async (text: string) =>
          text.includes('INFORMATION_SCHEMA.COLUMNS') ? rows : {},
        ),
        getTable: jest.fn(),
        changeColumn: jest.fn(),
      });

    it('reads the live column in the current database only', async () => {
      const my = mysqlRunner([enumColumn()]);
      await addEnumValue(my as unknown as QueryRunner, 'vulnerability_issue_mapping', 'platform', ['linear']);
      const [text, params] = my.query.mock.calls[0] as [string, unknown[]];
      expect(text).toContain('INFORMATION_SCHEMA.COLUMNS');
      expect(text).toContain('TABLE_SCHEMA = DATABASE()');
      expect(params).toEqual(['vulnerability_issue_mapping', 'platform']);
    });

    it('appends the value with one MODIFY that keeps the character set and the collation', async () => {
      const my = mysqlRunner([enumColumn()]);
      await addEnumValue(my as unknown as QueryRunner, 'vulnerability_issue_mapping', 'platform', ['linear']);
      expect(my.query).toHaveBeenCalledTimes(2);
      expect(my.query.mock.calls[1][0]).toBe(
        "ALTER TABLE `vulnerability_issue_mapping` MODIFY `platform` ENUM('github','gitlab','jira','linear') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL",
      );
      expect(my.changeColumn).not.toHaveBeenCalled();
      expect(my.getTable).not.toHaveBeenCalled();
    });

    it('keeps NULL, the default and the comment', async () => {
      const my = mysqlRunner([
        enumColumn({ isNullable: 'YES', columnDefault: 'gitlab', comment: 'where the issue lives' }),
      ]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ['linear']);
      expect(my.query.mock.calls[1][0]).toBe(
        "ALTER TABLE `t` MODIFY `c` ENUM('github','gitlab','jira','linear') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'gitlab' COMMENT 'where the issue lives'",
      );
    });

    it('omits CHARACTER SET and COLLATE when the column reports none', async () => {
      const my = mysqlRunner([enumColumn({ charset: null, collation: null })]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ['linear']);
      expect(my.query.mock.calls[1][0]).toBe(
        "ALTER TABLE `t` MODIFY `c` ENUM('github','gitlab','jira','linear') NOT NULL",
      );
    });

    it('is a no-op when every value is already in the enum', async () => {
      const my = mysqlRunner([enumColumn()]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ['gitlab', 'jira']);
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it('adds only the missing values, once each, after the existing ones', async () => {
      const my = mysqlRunner([enumColumn()]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ['jira', 'linear', 'linear', 'azure']);
      expect(my.query.mock.calls[1][0]).toContain("ENUM('github','gitlab','jira','linear','azure')");
    });

    it('parses and re-escapes quotes, commas, parentheses and backslashes', async () => {
      const my = mysqlRunner([
        enumColumn({
          columnType: "enum('it''s','a,b','back\\\\slash','x)y')",
          columnDefault: "it's",
          comment: "c'm\\t",
        }),
      ]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ["o'k\\"]);
      expect(my.query.mock.calls[1][0]).toBe(
        "ALTER TABLE `t` MODIFY `c` ENUM('it''s','a,b','back\\\\slash','x)y','o''k\\\\') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'it''s' COMMENT 'c''m\\\\t'",
      );
    });

    it('recognises an existing value written with quotes or backslashes', async () => {
      const my = mysqlRunner([enumColumn({ columnType: "enum('it''s','back\\\\slash')" })]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ["it's", 'back\\slash']);
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it('refuses an expression default rather than rewrite it', async () => {
      const my = mysqlRunner([
        enumColumn({ columnDefault: "_latin1\\'github\\'", extra: 'DEFAULT_GENERATED' }),
      ]);
      await expect(addEnumValue(my as unknown as QueryRunner, 't', 'c', ['linear'])).rejects.toThrow(
        'DB_DIALECT_UNSUPPORTED_DEFAULT: t.c',
      );
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it.each(['INVISIBLE', 'VIRTUAL GENERATED', 'STORED GENERATED'])(
      'refuses a column whose EXTRA (%s) a MODIFY would drop',
      async (extra) => {
        const my = mysqlRunner([enumColumn({ extra })]);
        await expect(addEnumValue(my as unknown as QueryRunner, 't', 'c', ['linear'])).rejects.toThrow(
          `DB_DIALECT_UNSUPPORTED_COLUMN: t.c has ${extra}`,
        );
        expect(my.query).toHaveBeenCalledTimes(1);
      },
    );

    it('still treats a value already present as a no-op on such a column', async () => {
      const my = mysqlRunner([enumColumn({ extra: 'INVISIBLE' })]);
      await addEnumValue(my as unknown as QueryRunner, 't', 'c', ['jira']);
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it('throws DB_DIALECT_UNKNOWN_COLUMN when the column does not exist', async () => {
      const my = mysqlRunner([]);
      await expect(addEnumValue(my as unknown as QueryRunner, 't', 'missing', ['x'])).rejects.toThrow(
        'DB_DIALECT_UNKNOWN_COLUMN: t.missing',
      );
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it('refuses a column that is not an ENUM', async () => {
      const my = mysqlRunner([enumColumn({ columnType: 'varchar(16)' })]);
      await expect(addEnumValue(my as unknown as QueryRunner, 't', 'c', ['x'])).rejects.toThrow(
        'DB_DIALECT_NOT_AN_ENUM: t.c is varchar(16)',
      );
      expect(my.query).toHaveBeenCalledTimes(1);
    });

    it('refuses a backtick in the table or column name', async () => {
      const my = mysqlRunner([enumColumn()]);
      await expect(addEnumValue(my as unknown as QueryRunner, 't`x', 'c', ['x'])).rejects.toThrow(
        'DB_DIALECT_BAD_IDENTIFIER',
      );
      expect(my.query).not.toHaveBeenCalled();
    });
  });
});
