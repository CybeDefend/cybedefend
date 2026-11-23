import 'reflect-metadata';
import { PrimaryGeneratedColumn, getMetadataArgsStorage } from 'typeorm';
import { dialectApi } from '../index';

describe('columns', () => {
  for (const d of ['mysql', 'postgres'] as const) {
    describe(d, () => {
      const a = dialectApi(d);

      it.each([
        ['datetime', 'timestamp'],
        ['longtext', 'text'],
        ['mediumtext', 'text'],
        ['tinyint', 'smallint'],
        ['mediumblob', 'bytea'],
        ['json', 'jsonb'],
        ['float', 'double precision'],
        ['double', 'double precision'],
        ['varchar', 'varchar'],
        ['int', 'int'],
        ['enum', 'enum'],
        ['simple-array', 'simple-array'],
      ])('columnType(%s) -> %s', (input, pgExpected) => {
        expect(a.columnType(input)).toBe(d === 'mysql' ? input : pgExpected);
      });

      it('ciText is varchar on MySQL and citext on PostgreSQL', () => {
        expect(a.ciText()).toBe(d === 'mysql' ? 'varchar' : 'citext');
      });
    });
  }

  it('UuidPrimaryColumn keeps the MySQL metadata of PrimaryGeneratedColumn(uuid)', () => {
    class A {
      @PrimaryGeneratedColumn('uuid')
      id!: string;
    }
    class B {
      @(dialectApi('mysql').UuidPrimaryColumn())
      id!: string;
    }
    const storage = getMetadataArgsStorage();
    const colA = storage.columns.filter((c) => c.target === A);
    const colB = storage.columns.filter((c) => c.target === B);
    expect(colA).toHaveLength(1);
    expect(colB).toHaveLength(1);
    expect({ ...colB[0], target: null }).toEqual({ ...colA[0], target: null });
    const genA = storage.generations.filter((g) => g.target === A);
    const genB = storage.generations.filter((g) => g.target === B);
    expect(genA).toHaveLength(1);
    expect(genB).toHaveLength(1);
    expect({ ...genB[0], target: null }).toEqual({ ...genA[0], target: null });
  });

  it('UuidPrimaryColumn on PostgreSQL is a varchar(36) primary with a database default', () => {
    class C {
      @(dialectApi('postgres').UuidPrimaryColumn())
      id!: string;
    }
    const storage = getMetadataArgsStorage();
    const col = storage.columns.find((c) => c.target === C);
    expect(col).toBeDefined();
    expect(col!.mode).toBe('regular');
    expect(col!.options.primary).toBe(true);
    expect(col!.options.type).toBe('varchar');
    expect(col!.options.length).toBe(36);
    expect((col!.options.default as () => string)()).toBe('gen_random_uuid()::text');
    expect(storage.generations.filter((g) => g.target === C)).toHaveLength(0);
  });

  it('UuidPrimaryColumn forwards the name option', () => {
    class D {
      @(dialectApi('postgres').UuidPrimaryColumn({ name: 'uid' }))
      id!: string;
    }
    class E {
      @(dialectApi('mysql').UuidPrimaryColumn({ name: 'uid' }))
      id!: string;
    }
    const storage = getMetadataArgsStorage();
    expect(storage.columns.find((c) => c.target === D)!.options.name).toBe('uid');
    expect(storage.columns.find((c) => c.target === E)!.options.name).toBe('uid');
  });

  it('UpdatedAtColumn sets onUpdate only on MySQL', () => {
    const mysql = dialectApi('mysql');
    const pg = dialectApi('postgres');
    class F {
      @mysql.UpdatedAtColumn({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
      updatedAt!: Date;
    }
    class G {
      @mysql.UpdatedAtColumn({ type: 'datetime' })
      updatedAt!: Date;
    }
    class H {
      @pg.UpdatedAtColumn({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
      updatedAt!: Date;
    }
    const cols = getMetadataArgsStorage().columns;
    const f = cols.find((c) => c.target === F)!;
    const g = cols.find((c) => c.target === G)!;
    const h = cols.find((c) => c.target === H)!;
    expect(f.options.onUpdate).toBe('CURRENT_TIMESTAMP(6)');
    expect(f.options.type).toBe('datetime');
    expect(g.options.onUpdate).toBe('CURRENT_TIMESTAMP');
    expect(h.options.onUpdate).toBeUndefined();
    expect(h.options.type).toBe('timestamp');
  });
});
