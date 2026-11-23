import { dialectApi } from '../index';

describe('builders', () => {
  for (const d of ['mysql', 'postgres'] as const) {
    describe(d, () => {
      const a = dialectApi(d);

      it('upsert names its conflict columns on PostgreSQL', () => {
        const q = a.upsert(
          'organization_statistics',
          { organization_id: 'o', stats: '{}' },
          { conflict: ['organization_id'], update: { stats: 'excluded', computed_at: a.nowPrecise(3) } },
        );
        expect(q.text).toBe(
          d === 'mysql'
            ? 'INSERT INTO `organization_statistics` (`organization_id`, `stats`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `stats` = VALUES(`stats`), `computed_at` = NOW(3)'
            : 'INSERT INTO "organization_statistics" ("organization_id", "stats") VALUES ($1, $2) ON CONFLICT ("organization_id") DO UPDATE SET "stats" = EXCLUDED."stats", "computed_at" = CURRENT_TIMESTAMP(3)',
        );
        expect(q.params).toEqual(['o', '{}']);
      });

      it('upsert writes several rows', () => {
        const q = a.upsert(
          't',
          [
            { a: 1, b: 'x' },
            { a: 2, b: 'y' },
          ],
          { conflict: ['a'], update: { b: 'excluded' } },
        );
        expect(q.text).toBe(
          d === 'mysql'
            ? 'INSERT INTO `t` (`a`, `b`) VALUES (?, ?), (?, ?) ON DUPLICATE KEY UPDATE `b` = VALUES(`b`)'
            : 'INSERT INTO "t" ("a", "b") VALUES ($1, $2), ($3, $4) ON CONFLICT ("a") DO UPDATE SET "b" = EXCLUDED."b"',
        );
        expect(q.params).toEqual([1, 'x', 2, 'y']);
      });

      it('upsert splices Sql values and update expressions', () => {
        const q = a.upsert(
          't',
          { id: 'x', n: a.castInt(a.param('7')) },
          { conflict: ['id'], update: { n: a.sql`n + ${1}` } },
        );
        expect(q.text).toBe(
          d === 'mysql'
            ? 'INSERT INTO `t` (`id`, `n`) VALUES (?, CAST(? AS SIGNED)) ON DUPLICATE KEY UPDATE `n` = n + ?'
            : 'INSERT INTO "t" ("id", "n") VALUES ($1, CAST($2 AS integer)) ON CONFLICT ("id") DO UPDATE SET "n" = n + $3',
        );
        expect(q.params).toEqual(['x', '7', 1]);
      });

      it('upsert refuses rows with different keys', () => {
        expect(() =>
          a.upsert('t', [{ a: 1 }, { a: 1, b: 2 }], { conflict: ['a'], update: { a: 'excluded' } }),
        ).toThrow('DB_DIALECT_ROW_SHAPE');
        expect(() => a.upsert('t', [], { conflict: ['a'], update: {} })).toThrow(
          'DB_DIALECT_ROW_SHAPE',
        );
      });

      it('upsert refuses an empty conflict list', () => {
        expect(() => a.upsert('t', { a: 1 }, { conflict: [], update: { a: 'excluded' } })).toThrow(
          'DB_DIALECT_CONFLICT_REQUIRED',
        );
      });

      it('insertIgnore', () => {
        const q = a.insertIgnore('t', { a: 'x' });
        expect(q.text).toBe(
          d === 'mysql'
            ? 'INSERT IGNORE INTO `t` (`a`) VALUES (?)'
            : 'INSERT INTO "t" ("a") VALUES ($1) ON CONFLICT DO NOTHING',
        );
        expect(q.params).toEqual(['x']);
        const q2 = a.insertIgnore('t', { a: 'x' }, ['a']);
        expect(q2.text).toBe(
          d === 'mysql'
            ? 'INSERT IGNORE INTO `t` (`a`) VALUES (?)'
            : 'INSERT INTO "t" ("a") VALUES ($1) ON CONFLICT ("a") DO NOTHING',
        );
        const q3 = a.insertIgnore('t', [{ a: 1 }, { a: 2 }], ['a', 'b']);
        expect(q3.text).toBe(
          d === 'mysql'
            ? 'INSERT IGNORE INTO `t` (`a`) VALUES (?), (?)'
            : 'INSERT INTO "t" ("a") VALUES ($1), ($2) ON CONFLICT ("a", "b") DO NOTHING',
        );
        expect(q3.params).toEqual([1, 2]);
      });

      it('deleteBatch', () => {
        const q = a.deleteBatch('scan', a.sql`${a.ident('projectId')} = ${'p'}`, 1000);
        expect(q.text).toBe(
          d === 'mysql'
            ? 'DELETE FROM `scan` WHERE `projectId` = ? LIMIT ?'
            : 'DELETE FROM "scan" WHERE ctid IN (SELECT ctid FROM "scan" WHERE "projectId" = $1 LIMIT $2)',
        );
        expect(q.params).toEqual(['p', 1000]);
        expect(() => a.deleteBatch('scan', a.sql`1 = 1`, 0)).toThrow('DB_DIALECT_INVALID_LIMIT');
        expect(() => a.deleteBatch('scan', a.sql`1 = 1`, 1.5)).toThrow('DB_DIALECT_INVALID_LIMIT');
        expect(() => a.deleteBatch('scan', a.sql`1 = 1`, -3)).toThrow('DB_DIALECT_INVALID_LIMIT');
      });

      it('updateBatch', () => {
        const q = a.updateBatch(
          'scan',
          { projectId: null },
          a.sql`${a.ident('id')} = ${'x'}`,
          10,
        );
        expect(q.text).toBe(
          d === 'mysql'
            ? 'UPDATE `scan` SET `projectId` = ? WHERE `id` = ? LIMIT ?'
            : 'UPDATE "scan" SET "projectId" = $1 WHERE ctid IN (SELECT ctid FROM "scan" WHERE "id" = $2 LIMIT $3)',
        );
        expect(q.params).toEqual([null, 'x', 10]);
        expect(() => a.updateBatch('scan', { a: 1 }, a.sql`1 = 1`, 0)).toThrow(
          'DB_DIALECT_INVALID_LIMIT',
        );
      });

      it('updateJoin qualifies SET on MySQL only', () => {
        const q = a.updateJoin({
          table: 'data_purge_step',
          alias: 's',
          join: {
            table: 'data_purge_job',
            alias: 'j',
            on: a.sql`${a.ident('j.id')} = ${a.ident('s.jobId')}`,
          },
          set: { status: 'done' },
          where: a.sql`${a.ident('s.jobId')} = ${'j1'}`,
        });
        expect(q.text).toBe(
          d === 'mysql'
            ? 'UPDATE `data_purge_step` `s` INNER JOIN `data_purge_job` `j` ON `j`.`id` = `s`.`jobId` SET `s`.`status` = ? WHERE `s`.`jobId` = ?'
            : 'UPDATE "data_purge_step" AS "s" SET "status" = $1 FROM "data_purge_job" AS "j" WHERE "j"."id" = "s"."jobId" AND "s"."jobId" = $2',
        );
        expect(q.params).toEqual(['done', 'j1']);
      });
    });
  }
});
