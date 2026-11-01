import type { EntityManager } from '@mikro-orm/postgresql';
import { type Expression, type Kysely, sql, type SqlBool } from 'kysely';

/**
 * The schema hand-written queries are typed against. They name tables and columns in SQL rather
 * than through the entities, so every column reads as `unknown` and each query states the shape
 * of the rows it returns.
 */
export type SqlDatabase = Record<string, Record<string, unknown>>;

/**
 * Kysely on the EntityManager's connection, for queries the ORM cannot express.
 *
 * It runs inside the EntityManager's transaction when there is one, and outside any ORM filter:
 * a query over tenant data carries its own tenant, privacy and `deleted_at` predicates.
 *
 * Postgres `date`, `timestamp` and `timestamptz` columns come back as the strings Postgres sends,
 * not as `Date` objects (MikroORM installs those type parsers on its pool); read them with
 * {@link toDate}. `numeric` comes back as a number (`connectDatabase` installs that parser).
 */
export function sqlQuery(em: EntityManager): Kysely<SqlDatabase> {
  return em.getKysely<SqlDatabase>();
}

/** A `date`/`timestamptz` value from a hand-written query as a `Date`. */
export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * `column = any(values)`: true for a row whose column is one of `values`, and false for every
 * row when `values` is empty (where `column in ()` would be a syntax error).
 */
export function anyOf(column: string, values: readonly (number | string)[]): Expression<SqlBool> {
  return sql<SqlBool>`${sql.ref(column)} = any(${[...values]})`;
}
