import { ColumnOptions, ColumnType } from 'typeorm';
import { Dialect, currentDialect } from './dialect';
import { Sql, SqlExpr, identSql, inListSql, paramSql, sqlTag } from './sql';
import { ciTextFor, columnTypeFor, UpdatedAtColumnFor, UuidPrimaryColumnFor } from './columns';
import {
  anyValueFor,
  caseSensitiveEqualsFor,
  castIntFor,
  dateBucketFor,
  diffDaysFor,
  diffSecondsFor,
  ifThenFor,
  ilikeFor,
  inCsvFor,
  intervalAgoFor,
  jsonArrayLengthFor,
  jsonRemoveKeyFor,
  nowPreciseFor,
  uuidExprFor,
} from './fragments';
import {
  Row,
  deleteBatchFor,
  insertIgnoreFor,
  updateBatchFor,
  updateJoinFor,
  upsertFor,
} from './builders';

export type { Dialect } from './dialect';
export { parseDialect, currentDialect } from './dialect';
export type { Sql, SqlExpr } from './sql';
export type { Row } from './builders';
export { run } from './run';
export type { QueryTarget, RunResult } from './run';
export { withAdvisoryLock, AdvisoryLockTimeoutError } from './locks';
export { isUniqueViolation, isDeadlock, isLockTimeout } from './errors';
export { withSavepoint } from './transactions';
export { addEnumValue, createUpdatedAtTrigger, ensureExtension } from './migration-helpers';
export { registerPostgresTypeParsers } from './type-parsers';
export type { PgTypeRegistry } from './type-parsers';
export { findMysqlOnlySql, MYSQL_ONLY_PATTERNS } from './mysql-only-sql';
export type { MysqlOnlyHit } from './mysql-only-sql';
export { findUnquotedCamelCaseSql } from './unquoted-identifiers';
export { findPostgresStrictSql } from './postgres-strict-sql';
export type {
  PostgresStrictHit,
  PostgresStrictKind,
  PostgresStrictOptions,
} from './postgres-strict-sql';
export type {
  UnquotedIdentifierHit,
  UnquotedIdentifierKind,
} from './unquoted-identifiers';
export {
  readSchema,
  diffSchemas,
  normaliseColumnType,
  normaliseDefault,
} from './testing/schema-parity';
export type {
  NormalisedColumn,
  NormalisedTable,
  NormalisedSchema,
  ParityAllowance,
  ParityAspect,
} from './testing/schema-parity';

export interface DialectApi {
  dialect: Dialect;
  /** a value is a parameter; an Sql (ident, inList, param, fragment) is spliced and renumbered */
  sql(strings: TemplateStringsArray, ...values: unknown[]): Sql;
  /** 'createdAt' → `createdAt` / "createdAt"; 's.createdAt' → `s`.`createdAt` / "s"."createdAt" */
  ident(name: string): Sql;
  /** (?, ?, ?) / ($1, $2, $3); refuses an empty list */
  inList(values: readonly unknown[]): Sql;
  /** one parameter, to pass a value where an SqlExpr is expected */
  param(value: unknown): Sql;
  columnType(t: string): ColumnType;
  ciText(): ColumnType;
  UuidPrimaryColumn(options?: { name?: string }): PropertyDecorator;
  UpdatedAtColumn(options: ColumnOptions): PropertyDecorator;
  dateBucket(expr: SqlExpr, unit: 'day' | 'month'): Sql;
  nowPrecise(p: 0 | 3 | 6): Sql;
  intervalAgo(n: number, unit: 'day' | 'hour' | 'minute'): Sql;
  diffDays(a: SqlExpr, b: SqlExpr): Sql;
  diffSeconds(a: SqlExpr, b: SqlExpr): Sql;
  ifThen(c: SqlExpr, a: SqlExpr, b: SqlExpr): Sql;
  jsonArrayLength(expr: SqlExpr): Sql;
  jsonRemoveKey(expr: SqlExpr, key: string): Sql;
  inCsv(expr: SqlExpr, csv: SqlExpr): Sql;
  ilike(expr: SqlExpr, pattern: SqlExpr): Sql;
  caseSensitiveEquals(a: SqlExpr, b: SqlExpr): Sql;
  anyValue(expr: SqlExpr): Sql;
  uuidExpr(): Sql;
  castInt(expr: SqlExpr): Sql;
  upsert(
    table: string,
    rows: Row | Row[],
    opts: { conflict: string[]; update: Record<string, 'excluded' | SqlExpr> },
  ): Sql;
  insertIgnore(table: string, rows: Row | Row[], conflict?: string[]): Sql;
  deleteBatch(table: string, where: Sql, limit: number): Sql;
  updateBatch(table: string, set: Row, where: Sql, limit: number): Sql;
  updateJoin(q: {
    table: string;
    alias: string;
    join: { table: string; alias: string; on: Sql };
    set: Row;
    where: Sql;
  }): Sql;
}

export function dialectApi(d: Dialect): DialectApi {
  return {
    dialect: d,
    sql: (strings, ...values) => sqlTag(d, strings, values),
    ident: (name) => identSql(d, name),
    inList: (values) => inListSql(d, values),
    param: (value) => paramSql(d, value),
    columnType: (t) => columnTypeFor(d, t),
    ciText: () => ciTextFor(d),
    UuidPrimaryColumn: (options) => UuidPrimaryColumnFor(d, options),
    UpdatedAtColumn: (options) => UpdatedAtColumnFor(d, options),
    dateBucket: (expr, unit) => dateBucketFor(d, expr, unit),
    nowPrecise: (p) => nowPreciseFor(d, p),
    intervalAgo: (n, unit) => intervalAgoFor(d, n, unit),
    diffDays: (a, b) => diffDaysFor(d, a, b),
    diffSeconds: (a, b) => diffSecondsFor(d, a, b),
    ifThen: (c, a, b) => ifThenFor(d, c, a, b),
    jsonArrayLength: (expr) => jsonArrayLengthFor(d, expr),
    jsonRemoveKey: (expr, key) => jsonRemoveKeyFor(d, expr, key),
    inCsv: (expr, csv) => inCsvFor(d, expr, csv),
    ilike: (expr, pattern) => ilikeFor(d, expr, pattern),
    caseSensitiveEquals: (a, b) => caseSensitiveEqualsFor(d, a, b),
    anyValue: (expr) => anyValueFor(d, expr),
    uuidExpr: () => uuidExprFor(d),
    castInt: (expr) => castIntFor(d, expr),
    upsert: (table, rows, opts) => upsertFor(d, table, rows, opts),
    insertIgnore: (table, rows, conflict) => insertIgnoreFor(d, table, rows, conflict),
    deleteBatch: (table, where, limit) => deleteBatchFor(d, table, where, limit),
    updateBatch: (table, set, where, limit) => updateBatchFor(d, table, set, where, limit),
    updateJoin: (q) => updateJoinFor(d, q),
  };
}

// Every DialectApi member is also exported at top level, bound to currentDialect().
const api = dialectApi(currentDialect());
export const {
  sql,
  ident,
  inList,
  param,
  columnType,
  ciText,
  UuidPrimaryColumn,
  UpdatedAtColumn,
  dateBucket,
  nowPrecise,
  intervalAgo,
  diffDays,
  diffSeconds,
  ifThen,
  jsonArrayLength,
  jsonRemoveKey,
  inCsv,
  ilike,
  caseSensitiveEquals,
  anyValue,
  uuidExpr,
  castInt,
  upsert,
  insertIgnore,
  deleteBatch,
  updateBatch,
  updateJoin,
} = api;
