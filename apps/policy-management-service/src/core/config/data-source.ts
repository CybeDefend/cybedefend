import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { editionMigrations } from '../../edition/edition-migrations';

dotenv.config({ path: '.env.migration' });

/**
 * The migration CLI has no default password: a missing one stops it with a
 * clear message instead of trying a well-known value.
 */
const password = process.env.POLICY_DB_PASSWORD;
if (!password) {
  throw new Error(
    'POLICY_DB_PASSWORD is not set: export it or put it in .env.migration',
  );
}

/**
 * TypeORM DataSource configuration for PostgreSQL migrations.
 * Used by TypeORM CLI commands for migration generation and execution.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POLICY_DB_HOST || 'localhost',
  port: Number(process.env.POLICY_DB_PORT) || 5433,
  username: process.env.POLICY_DB_USERNAME || 'policy_user',
  password,
  database: process.env.POLICY_DB_DATABASE || 'cybedefend_policy',
  entities: [join(__dirname, '../../entities/*.entity.{ts,js}')],
  migrations: editionMigrations(join(__dirname, '../migrations/*.{ts,js}')),
  synchronize: false,
  logging: true,
});
