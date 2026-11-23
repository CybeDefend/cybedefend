// CLI configuration for TypeORM migrations
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { buildTypeOrmOptions, connectionFromEnv } from '../db/typeorm-options';

dotenv.config({ path: '.env.migration' });

export const AppDataSource = new DataSource(
  buildTypeOrmOptions(connectionFromEnv(), { context: 'cli' }),
);
