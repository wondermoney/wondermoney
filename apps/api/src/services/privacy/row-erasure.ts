import { ForeignKeyConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { STORAGE_OCR_PREFIX } from '@utils/constants';

/**
 * Deletes a set of rows and every row that depends on them, across every table, reading the
 * dependencies from the database's own foreign keys rather than from a list kept by hand. A table
 * added later is erased with its parents without anyone having to remember it here.
 *
 * Erasing is two passes inside the caller's transaction:
 *
 * 1. **Mark.** The root rows are recorded by primary key in a temporary table, then, round by
 *    round, every row that references a marked row through a foreign key that would block or
 *    cascade the delete (`no action`, `restrict`, `cascade`). A reference to a household
 *    (`public.tenant`) marks the row whatever its delete rule: a household's categories, merchants
 *    and transactions point at it `on delete set null`, and they are the household's data, not
 *    something to keep with the household key blanked.
 * 2. **Check, then delete.** Before anything is deleted, the marked rows are held to the rule
 *    that erasing touches no household other than the ones named (`allowedTenantKeys`): a marked
 *    row of a household table outside them, or a row outside them that a delete would set to
 *    null, refuses the whole erasure ({@link ErasureRefused}) and nothing is deleted. Then each
 *    table's marked rows are deleted, a table's dependants before the table.
 *
 * Files kept in storage for the marked rows (attachments, receipt images, imported files) are
 * listed before the rows go, so the caller can remove them before it commits.
 */

export interface ErasureResult {
  files: StoredFile[];
  rows: number;
  /** Rows deleted per table. */
  tables: Record<string, number>;
}

export interface ErasureRoot {
  params: unknown[];
  table: string;
  /** A condition on the root table, aliased `r`: `r.tenant_key = ?`. */
  where: string;
}

export interface ErasureSchema {
  foreignKeys: ForeignKey[];
  primaryKeys: Map<string, KeyColumn[]>;
  /** Household tables: those with a foreign key to `public.tenant`, and the columns it uses. */
  tenantColumns: Map<string, string[]>;
}

export interface ForeignKey {
  childColumns: string[];
  /** Qualified, quoted as SQL needs it: `public."transaction"`. */
  childTable: string;
  name: string;
  onDelete: ForeignKeyAction;
  parentColumns: string[];
  parentTable: string;
}

export type ForeignKeyAction = 'cascade' | 'no action' | 'restrict' | 'set default' | 'set null';

/** A primary key column and its SQL type, to read a marked key back as the column's own type. */
export interface KeyColumn {
  name: string;
  type: string;
}

export interface StoredFile {
  bucket: null | string;
  key: string;
}

/** The erasure would touch another household (or a table it cannot track); nothing was deleted. */
export class ErasureRefused extends Error {
  constructor(readonly reason: string) {
    super(`Erasure refused: ${reason}`);
    this.name = 'ErasureRefused';
  }
}

export const TENANT_TABLE = 'public.tenant';

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema', 'pg_toast')`;
const MAX_ROUNDS = 50;
const MARKS = 'wm_erasure_mark';

const ACTIONS: Record<string, ForeignKeyAction> = { a: 'no action', c: 'cascade', d: 'set default', n: 'set null', r: 'restrict' };

/** Where files are kept for rows: each lists the stored object of a marked row of its table. */
const FILE_COLUMNS: { bucket?: string; key: string; table: string; url?: string }[] = [
  { key: 'storage_key', table: 'public.transaction_attachment' },
  { key: 'file_key', table: 'public.transaction_ocr_import', url: 'file_url' },
  { bucket: 's3_bucket', key: 's3_key', table: 'public.portfolio_import_session' },
  { bucket: 's3_bucket', key: 's3_key', table: 'public.transaction_import_session' },
];

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const columnList = (alias: string, columns: string[]) => columns.map((column) => `${alias}.${quote(column)}`).join(', ');
const pkJson = (alias: string, key: KeyColumn[]) => `jsonb_build_array(${columnList(alias, key.map((column) => column.name))})`;
/** Joins a marked key to its row through the table's own primary key index. */
const pkMatch = (alias: string, key: KeyColumn[], marks: string) =>
  key.map((column, index) => `${alias}.${quote(column.name)} = (${marks}.pk ->> ${index})::${column.type}`).join(' and ');

type Method = 'all' | 'get' | 'run';

function run<T = unknown>(tx: EntityManager, sql: string, params: unknown[] = [], method: Method = 'all'): Promise<T> {
  return tx.getConnection().execute(sql, params, method, tx.getTransactionContext()) as Promise<T>;
}

const affected = (result: unknown) => {
  const value = result as { affectedRows?: number; rowCount?: number };
  return value.affectedRows ?? value.rowCount ?? 0;
};

/** The foreign keys, primary keys and household tables of every application schema. */
export async function loadErasureSchema(tx: EntityManager): Promise<ErasureSchema> {
  const fkRows = await run<{ child_columns: string[]; child_table: string; name: string; on_delete: string; parent_columns: string[]; parent_table: string }[]>(tx, `
    select con.conname as name,
           format('%I.%I', cn.nspname, cl.relname) as child_table,
           format('%I.%I', pn.nspname, pl.relname) as parent_table,
           con.confdeltype::text as on_delete,
           (select array_agg(a.attname::text order by k.i) from unnest(con.conkey) with ordinality k(n, i)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n) as child_columns,
           (select array_agg(a.attname::text order by k.i) from unnest(con.confkey) with ordinality k(n, i)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n) as parent_columns
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid join pg_namespace cn on cn.oid = cl.relnamespace
      join pg_class pl on pl.oid = con.confrelid join pg_namespace pn on pn.oid = pl.relnamespace
     where con.contype = 'f' and cn.nspname not in ${SYSTEM_SCHEMAS} and pn.nspname not in ${SYSTEM_SCHEMAS}
     order by 2, 1`);
  const pkRows = await run<{ columns: string[]; table_name: string; types: string[] }[]>(tx, `
    select format('%I.%I', n.nspname, c.relname) as table_name,
           array_agg(a.attname::text order by k.i) as columns,
           array_agg(format_type(a.atttypid, a.atttypmod) order by k.i) as types
      from pg_index i
      join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral unnest(i.indkey::int2[]) with ordinality k(n, i)
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.n
     where i.indisprimary and n.nspname not in ${SYSTEM_SCHEMAS}
     group by 1`);

  const foreignKeys = fkRows.map((row) => ({
    childColumns: row.child_columns,
    childTable: row.child_table,
    name: row.name,
    onDelete: ACTIONS[row.on_delete] ?? 'no action',
    parentColumns: row.parent_columns,
    parentTable: row.parent_table,
  }));
  const tenantColumns = new Map<string, string[]>();
  for (const fk of foreignKeys) {
    if (fk.parentTable !== TENANT_TABLE || fk.childColumns.length !== 1) continue;
    tenantColumns.set(fk.childTable, [...(tenantColumns.get(fk.childTable) ?? []), ...fk.childColumns]);
  }
  tenantColumns.set(TENANT_TABLE, ['tenant_key']);
  const primaryKeys = new Map(pkRows.map((row) => [row.table_name, row.columns.map((name, index) => ({ name, type: row.types[index] ?? 'text' }))]));
  return { foreignKeys, primaryKeys, tenantColumns };
}

/**
 * Erases the root rows and everything that depends on them, or refuses and deletes nothing. Runs
 * in the caller's transaction; a refusal or a failure leaves it to the caller to roll back.
 */
export async function eraseRows(
  tx: EntityManager,
  schema: ErasureSchema,
  root: ErasureRoot,
  options: { allowedTenantKeys: number[] },
): Promise<ErasureResult> {
  await run(tx, `create temp table if not exists ${MARKS} (tbl text not null, pk jsonb not null, round int not null, primary key (tbl, pk)) on commit drop`, [], 'run');
  await run(tx, `truncate ${MARKS}`, [], 'run');

  const marked = await mark(tx, schema, root);
  await check(tx, schema, marked, options.allowedTenantKeys);
  const files = await listFiles(tx, schema, marked);
  const tables = await deleteMarked(tx, schema, marked);
  return { files, rows: Object.values(tables).reduce((sum, count) => sum + count, 0), tables };
}

function primaryKeyOf(schema: ErasureSchema, table: string): KeyColumn[] {
  const columns = schema.primaryKeys.get(table);
  if (!columns?.length) throw new ErasureRefused(`${table} has rows to erase but no primary key to track them by`);
  return columns;
}

/** Marks the root rows and, round by round, the rows that depend on rows marked the round before. */
async function mark(tx: EntityManager, schema: ErasureSchema, root: ErasureRoot): Promise<Set<string>> {
  const marked = new Set<string>();
  const seeded = await run(tx, `insert into ${MARKS} (tbl, pk, round)
    select ${literal(root.table)}, ${pkJson('r', primaryKeyOf(schema, root.table))}, 0 from ${root.table} r where ${root.where}
    on conflict do nothing`, root.params, 'run');
  if (affected(seeded) === 0) return marked;
  marked.add(root.table);

  let frontier = new Set([root.table]);
  for (let round = 1; frontier.size > 0; round += 1) {
    if (round > MAX_ROUNDS) throw new ErasureRefused(`dependencies go deeper than ${MAX_ROUNDS} levels`);
    const next = new Set<string>();
    for (const fk of schema.foreignKeys) {
      if (!frontier.has(fk.parentTable) || !followsDelete(fk)) continue;
      const parentKey = primaryKeyOf(schema, fk.parentTable);
      const referencing = `(${columnList('c', fk.childColumns)}) in (
          select ${columnList('p', fk.parentColumns)} from ${fk.parentTable} p
            join ${MARKS} m on m.tbl = ${literal(fk.parentTable)} and m.round = ? and ${pkMatch('p', parentKey, 'm')})`;
      if (!schema.primaryKeys.get(fk.childTable)?.length) {
        const found = await run<unknown[]>(tx, `select 1 from ${fk.childTable} c where ${referencing} limit 1`, [round - 1]);
        if (found.length > 0) primaryKeyOf(schema, fk.childTable);
        continue;
      }
      const inserted = await run(tx, `insert into ${MARKS} (tbl, pk, round)
        select ${literal(fk.childTable)}, ${pkJson('c', primaryKeyOf(schema, fk.childTable))}, ? from ${fk.childTable} c where ${referencing}
        on conflict do nothing`, [round, round - 1], 'run');
      if (affected(inserted) > 0) {
        next.add(fk.childTable);
        marked.add(fk.childTable);
      }
    }
    frontier = next;
  }
  return marked;
}

/** Whether a row referencing a deleted row goes with it: it would block or cascade, or it is a household's. */
function followsDelete(fk: ForeignKey): boolean {
  return fk.parentTable === TENANT_TABLE || (fk.onDelete !== 'set null' && fk.onDelete !== 'set default');
}

/** A condition true for a row whose household is set and is not one of `allowed`. */
function outsideHouseholds(alias: string, columns: string[], allowed: number[]): string {
  const list = allowed.map((key) => String(Math.trunc(key))).join(', ');
  return columns
    .map((column) => {
      const ref = `${alias}.${quote(column)}`;
      return allowed.length > 0 ? `(${ref} is not null and ${ref} not in (${list}))` : `${ref} is not null`;
    })
    .join(' or ');
}

/** Refuses an erasure that would delete or change a row of any household it was not asked to erase. */
async function check(tx: EntityManager, schema: ErasureSchema, marked: Set<string>, allowed: number[]): Promise<void> {
  for (const table of marked) {
    const columns = schema.tenantColumns.get(table);
    if (!columns) continue;
    const found = await run<unknown[]>(tx, `select 1 from ${table} t
      join ${MARKS} m on m.tbl = ${literal(table)} and ${pkMatch('t', primaryKeyOf(schema, table), 'm')}
      where (${outsideHouseholds('t', columns, allowed)}) limit 1`);
    if (found.length > 0) throw new ErasureRefused(`${table} holds rows of a household that is not being erased`);
  }
  // A delete sets these references to null: refused when the row belongs to another household.
  for (const fk of schema.foreignKeys) {
    if (followsDelete(fk) || !marked.has(fk.parentTable)) continue;
    const columns = schema.tenantColumns.get(fk.childTable);
    if (!columns) continue;
    const childKey = schema.primaryKeys.get(fk.childTable);
    const unmarked = childKey?.length && marked.has(fk.childTable)
      ? ` and not exists (select 1 from ${MARKS} n where n.tbl = ${literal(fk.childTable)} and n.pk = ${pkJson('c', childKey)})`
      : '';
    const found = await run<unknown[]>(tx, `select 1 from ${fk.childTable} c
      where (${columnList('c', fk.childColumns)}) in (
          select ${columnList('p', fk.parentColumns)} from ${fk.parentTable} p
            join ${MARKS} m on m.tbl = ${literal(fk.parentTable)} and ${pkMatch('p', primaryKeyOf(schema, fk.parentTable), 'm')})
        ${unmarked} and (${outsideHouseholds('c', columns, allowed)}) limit 1`);
    if (found.length > 0) throw new ErasureRefused(`${fk.childTable} (${fk.name}) has rows of a household that is not being erased`);
  }
}

async function listFiles(tx: EntityManager, schema: ErasureSchema, marked: Set<string>): Promise<StoredFile[]> {
  const files = new Map<string, StoredFile>();
  for (const source of FILE_COLUMNS) {
    if (!marked.has(source.table)) continue;
    const rows = await run<{ bucket: null | string; key: null | string; url: null | string }[]>(tx, `
      select ${source.bucket ? `t.${quote(source.bucket)}` : 'null'} as bucket, t.${quote(source.key)} as key,
             ${source.url ? `t.${quote(source.url)}` : 'null'} as url
        from ${source.table} t
        join ${MARKS} m on m.tbl = ${literal(source.table)} and ${pkMatch('t', primaryKeyOf(schema, source.table), 'm')}`);
    for (const row of rows) {
      const key = row.key ?? (row.url ? storageKeyFromUrl(row.url) : null);
      if (!key) continue;
      files.set(`${row.bucket ?? ''}\u0000${key}`, { bucket: row.bucket, key });
    }
  }
  return [...files.values()];
}

/**
 * The object key in a stored receipt's URL (`…/<bucket>/wmocr/<name>` or
 * `https://<bucket>.s3…/wmocr/<name>`), for a receipt stored before its key was recorded too.
 */
export function storageKeyFromUrl(url: string): null | string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const index = path.indexOf(`/${STORAGE_OCR_PREFIX}/`);
    return index >= 0 ? path.slice(index + 1) : null;
  } catch {
    return null;
  }
}

/** Deletes each table's marked rows, dependants first; a cycle is broken by retrying what a reference held back. */
async function deleteMarked(tx: EntityManager, schema: ErasureSchema, marked: Set<string>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let pending = deleteOrder(schema, marked);
  while (pending.length > 0) {
    const heldBack: string[] = [];
    for (const table of pending) {
      await run(tx, 'savepoint wm_erasure_step', [], 'run');
      try {
        const deleted = await run(tx, `delete from ${table} t using ${MARKS} m
          where m.tbl = ${literal(table)} and ${pkMatch('t', primaryKeyOf(schema, table), 'm')}`, [], 'run');
        await run(tx, 'release savepoint wm_erasure_step', [], 'run');
        counts[table] = (counts[table] ?? 0) + affected(deleted);
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        await run(tx, 'rollback to savepoint wm_erasure_step', [], 'run');
        heldBack.push(table);
      }
    }
    if (heldBack.length === pending.length) throw new ErasureRefused(`rows of ${heldBack.join(', ')} are still referenced`);
    pending = heldBack;
  }
  return counts;
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof ForeignKeyConstraintViolationException || (error as null | { code?: string })?.code === '23503';
}

/** Marked tables ordered so that a table comes after every marked table whose rows reference it. */
export function deleteOrder(schema: ErasureSchema, marked: Set<string>): string[] {
  const blockers = new Map<string, Set<string>>([...marked].map((table) => [table, new Set<string>()]));
  for (const fk of schema.foreignKeys) {
    if (fk.childTable === fk.parentTable || !marked.has(fk.childTable) || !marked.has(fk.parentTable)) continue;
    if (fk.onDelete === 'no action' || fk.onDelete === 'restrict') blockers.get(fk.parentTable)?.add(fk.childTable);
  }
  const order: string[] = [];
  const remaining = new Set(marked);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => [...(blockers.get(table) ?? [])].every((child) => !remaining.has(child))).sort();
    // A cycle: take the rest in name order and let the retry in `deleteMarked` sort it out.
    const batch = ready.length > 0 ? ready : [...remaining].sort();
    for (const table of batch) {
      order.push(table);
      remaining.delete(table);
    }
  }
  return order;
}
