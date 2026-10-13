/**
 * Builds a Postgres `text[]` array literal string (e.g. `{"a","b"}`) from a JS
 * array, escaping `\` and `"` so each element survives as a distinct value.
 *
 * Why this exists: MikroORM's raw `connection.execute()` never sends real bind
 * parameters to Postgres — `PostgreSqlPlatform#escape` client-side interpolates
 * every `?` placeholder into the SQL string before it is sent over the wire
 * (see `AbstractSqlConnection#execute` -> `Platform#formatQuery`). A JS array
 * bound to a single `?` is serialized as a bare comma-separated list of scalar
 * literals (e.g. `'a', 'b'`), which is NOT a valid Postgres array literal. That
 * breaks `any(?)` (accepts exactly one array expression) and `&& ?` (array
 * overlap), throwing a 42601 syntax / malformed-array-literal error against a
 * real database. Building the literal ourselves and casting it (`?::text[]`)
 * sidesteps this: the whole array arrives as a single escaped string parameter.
 *
 * This is SQL-injection-sensitive escaping — keep it as the ONE shared
 * implementation rather than duplicating it per call site (RAD-266, RAD-273).
 */
export function toPgTextArrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}
