import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { types } from 'pg';

import logger from '@utils/logger';

export const DI = {} as {
  em: EntityManager;
  orm: MikroORM | null;
};

export async function closeDatabase() {
  if (!DI.orm) return;
  const orm = DI.orm;
  DI.orm = null;
  await orm.close().catch((error) => { logger.error({ error }, '🚨 Could not close the database'); });
}

export async function connectDatabase() {
  try {
    const { default: mikroOrmConfig } = await import('@app/mikro-orm.config');
    DI.orm = await MikroORM.init(mikroOrmConfig);
    DI.em = DI.orm.em;
    types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
    const migrations = await DI.orm.migrator.getPendingMigrations();
    if (migrations.length > 0) logger.warn({ migrations: migrations.map((migration) => migration.name) }, 'Database has pending migrations');
    else logger.info('Database migrations are up to date');
    return DI.orm;
  } catch (error) {
    logger.error({ error }, '🚨 Could not connect to the database');
    throw error;
  }
}
