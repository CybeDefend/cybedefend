import * as fs from 'fs';
import * as path from 'path';

it('the library never loads a driver nor uses instanceof on a TypeORM class', () => {
  const srcDir = path.join(__dirname, '..');
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  expect(files).toEqual([
    'builders.ts',
    'columns.ts',
    'dialect.ts',
    'errors.ts',
    'fragments.ts',
    'index.ts',
    'locks.ts',
    'migration-helpers.ts',
    'mysql-only-sql.ts',
    'postgres-strict-sql.ts',
    'run.ts',
    'sql.ts',
    'transactions.ts',
    'type-parsers.ts',
    'unquoted-identifiers.ts',
  ]);
  const driverRe = /from ['"](pg|mysql2)['"]|require\(['"](pg|mysql2)['"]\)/;
  const instanceofRe = /instanceof\s+(DataSource|EntityManager|QueryFailedError|QueryRunner)/;
  for (const f of files) {
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    expect([f, driverRe.test(content)]).toEqual([f, false]);
    expect([f, instanceofRe.test(content)]).toEqual([f, false]);
  }
});
