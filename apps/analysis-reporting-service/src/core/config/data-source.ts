// CLI configuration for TypeORM migrations
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config({ path: '.env.migration' });

// Imported after dotenv so that DB_TYPE from .env.migration reaches
// @cybedefend/db-dialect, which reads it once, at import.
const { buildTypeOrmOptions, connectionFromEnv } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../db/typeorm-options') as typeof import('../db/typeorm-options');

export const AppDataSource = new DataSource(
  buildTypeOrmOptions(connectionFromEnv(), { context: 'cli' }),
);
