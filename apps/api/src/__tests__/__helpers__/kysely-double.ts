/**
 * A Kysely that compiles Postgres SQL and never connects, for tests of code that builds queries
 * with `sqlQuery(em)`. Every query it executes is recorded, and `respond` decides the rows it
 * returns (none by default), so a test can assert on the SQL and parameters as well as the outcome.
 */
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from 'kysely';

import type { SqlDatabase } from '@app/database/sql';

export interface KyselyDouble {
  db: Kysely<SqlDatabase>;
  /** The queries executed so far, in order. */
  queries: CompiledQuery[];
}

export type KyselyResponder = (query: CompiledQuery) => unknown[];

export function kyselyDouble(respond: KyselyResponder = () => []): KyselyDouble {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query);
      return Promise.resolve({ rows: respond(query) as R[] });
    },
    // eslint-disable-next-line require-yield
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      await Promise.resolve();
      throw new Error('kyselyDouble does not stream');
    },
  };
  const driver: Driver = {
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    init: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
  };
  const db = new Kysely<SqlDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, queries };
}

/** Lower-cased SQL with whitespace collapsed, for `toContain` assertions. */
export function normalizedSql(query: { sql: string }): string {
  return query.sql.replace(/\s+/g, ' ').toLowerCase();
}
