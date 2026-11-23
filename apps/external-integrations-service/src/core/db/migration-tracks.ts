// The migration tracks of external-integrations. This file
// imports nothing, so a spec or a script can read it without loading TypeORM.

/** The last MySQL migration: src/core/migrations/ takes no newer file. */
export const MYSQL_TRACK_FROZEN_AT = 1792100000000;

/** The one PostgreSQL baseline; every common migration is above it. */
export const POSTGRES_BASELINE_AT = 1792150000000;
