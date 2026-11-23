import { existsSync } from 'node:fs';
import { isCommunityEdition } from './edition';
import * as eeMigrations from './ee-migrations';

/**
 * The engine whose migration track runs. Declared here, never imported from
 * libs/db-dialect: gateway, policy-management and mcp-service keep their
 * one-argument calls and never load that library.
 */
export type MigrationDialect = 'mysql' | 'postgres';

const MYSQL_SEGMENT = '/migrations/';

/**
 * `coreGlob` with its last `/migrations/` segment replaced by `/<folder>/`,
 * or null when it has none.
 */
function siblingGlob(coreGlob: string, folder: string): string | null {
  const at = coreGlob.lastIndexOf(MYSQL_SEGMENT);
  if (at < 0) return null;
  return `${coreGlob.slice(0, at)}/${folder}/${coreGlob.slice(at + MYSQL_SEGMENT.length)}`;
}

/** The common track's glob, only once its folder exists. */
function commonGlob(coreGlob: string): string[] {
  const at = coreGlob.lastIndexOf(MYSQL_SEGMENT);
  if (at < 0) return [];
  const folder = `${coreGlob.slice(0, at)}/migrations-common`;
  if (!existsSync(folder)) return [];
  return [siblingGlob(coreGlob, 'migrations-common') as string];
}

// The TypeORM CLI loads this file through the data-source.ts files without
// tsconfig-paths, so it imports only relative modules and nothing from
// libs/db-dialect. The engine is the explicit `dialect` parameter, never
// DB_TYPE: its default is 'mysql', and only the five services that run on
// both engines pass one.
//
// mysql:    the MySQL track, the common folder once it exists, then the ee
//           MySQL migrations outside the Community Edition.
// postgres: the PostgreSQL baseline, the common folder once it exists, then
//           EE_POSTGRES_MIGRATIONS (an optional export) outside the Community
//           Edition.
export function editionMigrations(
  coreGlob: string,
  dialect: MigrationDialect = 'mysql',
): string[] {
  const community = isCommunityEdition();
  if (dialect === 'postgres') {
    const postgres = siblingGlob(coreGlob, 'migrations-postgres');
    if (postgres === null) {
      throw new Error(
        `EDITION_MIGRATIONS_BAD_GLOB: no '/migrations/' segment in ${coreGlob}`,
      );
    }
    const ee =
      (eeMigrations as { EE_POSTGRES_MIGRATIONS?: string[] })
        .EE_POSTGRES_MIGRATIONS ?? [];
    return [postgres, ...commonGlob(coreGlob), ...(community ? [] : ee)];
  }
  return [
    coreGlob,
    ...commonGlob(coreGlob),
    ...(community ? [] : eeMigrations.EE_MIGRATIONS),
  ];
}
