// CLI configuration for TypeORM migrations
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { parseDialect } from '@cybedefend/db-dialect';
import { buildTypeOrmOptions, connectionFromEnv } from '../db/typeorm-options';

dotenv.config({ path: '.env.migration' });

// The engine is read after dotenv so that DB_TYPE in .env.migration counts
// too; the entity decorators read DB_TYPE at import, hence the explicit
// dialect instead of the module-level currentDialect().
export const AppDataSource = new DataSource(
  buildTypeOrmOptions(connectionFromEnv(), {
    context: 'cli',
    dialect: parseDialect(process.env.DB_TYPE),
  }),
);
