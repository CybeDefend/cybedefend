export interface PgTypeRegistry {
  setTypeParser(oid: number, parser: (value: string) => unknown): void;
}

/**
 * PostgreSQL type parsers, registered on the caller's own pg module (the
 * service's driver), never on a copy of pg the library would load itself:
 * timestamp (1114) is parsed as UTC, int8 (20) and numeric (1700) stay
 * strings, like mysql2 returns them.
 */
export function registerPostgresTypeParsers(types: PgTypeRegistry): void {
  types.setTypeParser(1114, (value: string) => new Date(value + 'Z'));
  types.setTypeParser(20, (value: string) => value);
  types.setTypeParser(1700, (value: string) => value);
}
