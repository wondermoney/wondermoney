import { createHash } from 'node:crypto';

import { type ExportArchive, ExportArchiveError, type ExportArchiveErrorCode, openExportArchive } from '@service/data-export/export-archive-reader';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from '@service/data-export/export-format';

import { DATA_FILES, type DataFileName, type DataRows, manifestSchema, MINOR_MIGRATIONS, REFERENCES, RESTORE_LIMITS, RESTORE_MAJOR_VERSION, type RestoreLimits, type RestoreManifest } from './restore-format';

/**
 * Reads an uploaded export back into checked rows, writing nothing: every check a restore makes
 * on the file itself happens here, before the database is touched.
 *
 * In order: the archive opens (and the password, when it is protected, is right); `manifest.json`
 * is a WonderMoney export of a major version this server reads; the archive holds exactly the
 * files the manifest lists, each with the listed size, SHA-256 and row count; every row of every
 * data file matches its schema (`restore-format.ts`); ids are unique within a file; and every
 * reference between files points at a row that is there. Anything else fails with a
 * {@link RestoreError} whose code says what to tell the person.
 */
export interface ParsedExport {
  encrypted: boolean;
  manifest: RestoreManifest;
  rows: DataRows;
}

export type RestoreErrorCode =
  | ExportArchiveErrorCode
  /** The household to restore into already has accounts, portfolios, budgets, goals or loans. */
  | 'household_not_empty'
  /** A row that does not match its schema, a duplicate id, or a reference to a row that is not there. */
  | 'invalid_data'
  /** A currency code this server does not have (`detail.values`). */
  | 'unknown_currency'
  /** A transaction type or status name this server does not have (`detail.values`). */
  | 'unknown_type'
  /** An export of a major format version this server does not read. */
  | 'unsupported_version';

export interface RestoreErrorDetail {
  field?: string;
  file?: string;
  /** 1-based row number within the file. */
  row?: number;
  /** The unknown codes or names, for the person to see. */
  values?: string[];
}

export class RestoreError extends Error {
  constructor(readonly code: RestoreErrorCode, message: string, readonly detail: RestoreErrorDetail = {}) {
    super(message);
    this.name = 'RestoreError';
  }
}

const MANIFEST_PATH = 'manifest.json';
const [CURRENT_MAJOR, CURRENT_MINOR] = EXPORT_FORMAT_VERSION.split('.').map(Number) as [number, number];

/** Open, verify and parse `source`. The password, when given, is never part of an error. */
export async function readRestoreArchive(source: Uint8Array, options: { limits?: Partial<RestoreLimits>; password?: string } = {}): Promise<ParsedExport> {
  const limits = { ...RESTORE_LIMITS, ...options.limits };
  if (source.length > limits.maxArchiveBytes) throw new RestoreError('too_large', `The file is larger than ${limits.maxArchiveBytes} bytes`);
  let archive: ExportArchive;
  try {
    archive = await openExportArchive(source, { maxFileBytes: limits.maxFileBytes, ...(options.password ? { password: options.password } : {}) });
  } catch (error) {
    throw fromArchiveError(error);
  }
  try {
    const manifest = parseManifest(await readFile(archive, MANIFEST_PATH));
    const listed = new Map(manifest.files.map((file) => [file.path, file]));
    if (listed.size !== manifest.files.length) throw new RestoreError('corrupt', 'The manifest lists a file twice');
    const held = archive.paths.filter((path) => path !== MANIFEST_PATH);
    if (held.length > limits.maxFiles) throw new RestoreError('too_large', `The archive holds more than ${limits.maxFiles} files`);
    for (const path of held) if (!listed.has(path)) throw new RestoreError('corrupt', `${path} is not in the manifest`, { file: path });
    for (const path of listed.keys()) if (!held.includes(path)) throw new RestoreError('corrupt', `${path} is missing`, { file: path });
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    if (total > limits.maxTotalBytes) throw new RestoreError('too_large', `The files add up to more than ${limits.maxTotalBytes} bytes`);

    const raw: Partial<Record<DataFileName, unknown[]>> = {};
    for (const file of manifest.files) {
      const bytes = await readFile(archive, file.path);
      if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
        throw new RestoreError('corrupt', `${file.path} does not match the manifest`, { file: file.path });
      }
      const name = dataFileName(file.path);
      if (!name) continue;
      const rows = parseJsonArray(bytes, file.path);
      if (rows.length !== file.rows) throw new RestoreError('corrupt', `${file.path} does not hold the rows the manifest lists`, { file: file.path });
      if (rows.length > limits.maxRows) throw new RestoreError('too_large', `${file.path} holds more than ${limits.maxRows} rows`, { file: file.path });
      raw[name] = rows;
    }

    const minor = Number(manifest.formatVersion.split('.')[1]);
    for (let from = minor; from < CURRENT_MINOR; from += 1) MINOR_MIGRATIONS[from]?.(raw);

    const rows = checkRows(raw);
    checkIds(rows);
    checkReferences(rows);
    if (!rows.members.some((member) => member.id === manifest.exportedBy.memberId)) {
      throw new RestoreError('invalid_data', 'The member who made the export is not in members.json', { field: 'exportedBy', file: MANIFEST_PATH });
    }
    return { encrypted: archive.encrypted, manifest, rows };
  } finally {
    await archive.close().catch(() => undefined);
  }
}

function checkIds(rows: DataRows): void {
  for (const [name, list] of Object.entries(rows) as [DataFileName, { id?: number }[]][]) {
    const seen = new Set<number>();
    list.forEach((row, index) => {
      if (row.id === undefined) return;
      if (seen.has(row.id)) throw new RestoreError('invalid_data', `data/${name}.json holds id ${row.id} twice`, { field: 'id', file: `data/${name}.json`, row: index + 1 });
      seen.add(row.id);
    });
  }
}

function checkReferences(rows: DataRows): void {
  const ids = new Map<DataFileName, Set<number>>();
  const idsOf = (name: DataFileName) => {
    let set = ids.get(name);
    if (!set) {
      set = new Set((rows[name] as { id?: number }[]).map((row) => row.id).filter((value): value is number => value !== undefined));
      ids.set(name, set);
    }
    return set;
  };
  for (const { field, file, target } of REFERENCES) {
    const known = idsOf(target);
    (rows[file] as Record<string, unknown>[]).forEach((row, index) => {
      const value = row[field];
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item === null || item === undefined) continue;
        if (!known.has(item as number)) throw new RestoreError('invalid_data', `data/${file}.json row ${index + 1} refers to a missing ${target} row`, { field, file: `data/${file}.json`, row: index + 1 });
      }
    });
  }
}

function checkRows(raw: Partial<Record<DataFileName, unknown[]>>): DataRows {
  const rows: Partial<Record<DataFileName, unknown[]>> = {};
  for (const name of Object.keys(DATA_FILES) as DataFileName[]) {
    const schema = DATA_FILES[name];
    const file = `data/${name}.json`;
    rows[name] = (raw[name] ?? []).map((row, index) => {
      const parsed = schema.safeParse(row);
      if (!parsed.success) throw new RestoreError('invalid_data', `${file} row ${index + 1} is not valid`, { field: parsed.error.issues[0]?.path.join('.'), file, row: index + 1 });
      return parsed.data;
    });
  }
  return rows as DataRows;
}

function dataFileName(path: string): DataFileName | null {
  const match = /^data\/([a-z-]+)\.json$/u.exec(path);
  return match && Object.hasOwn(DATA_FILES, match[1]!) ? (match[1] as DataFileName) : null;
}

function fromArchiveError(error: unknown): RestoreError {
  if (error instanceof RestoreError) return error;
  if (error instanceof ExportArchiveError) return new RestoreError(error.code, error.message);
  return new RestoreError('corrupt', 'The archive could not be read');
}

function parseJsonArray(bytes: Uint8Array, path: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RestoreError('corrupt', `${path} is not JSON`, { file: path });
  }
  if (!Array.isArray(value)) throw new RestoreError('invalid_data', `${path} is not a list of rows`, { file: path });
  return value;
}

function parseManifest(bytes: Uint8Array): RestoreManifest {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RestoreError('corrupt', 'manifest.json is not JSON', { file: MANIFEST_PATH });
  }
  const header = value as null | { format?: unknown; formatVersion?: unknown };
  if (typeof header !== 'object' || header?.format !== EXPORT_FORMAT) throw new RestoreError('not_an_export', 'The archive is not a WonderMoney export');
  const major = typeof header.formatVersion === 'string' ? Number(header.formatVersion.split('.')[0]) : Number.NaN;
  if (major !== RESTORE_MAJOR_VERSION || major !== CURRENT_MAJOR) throw new RestoreError('unsupported_version', `Export format ${String(header.formatVersion)} is not supported`, { file: MANIFEST_PATH });
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new RestoreError('invalid_data', 'manifest.json is not valid', { field: parsed.error.issues[0]?.path.join('.'), file: MANIFEST_PATH });
  return parsed.data;
}

async function readFile(archive: ExportArchive, path: string): Promise<Uint8Array> {
  try {
    return await archive.read(path);
  } catch (error) {
    throw fromArchiveError(error);
  }
}
