import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';

import { TextReader, ZipWriter } from '@zip.js/zip.js';
import { ZipFile } from 'yazl';

import { csvEscape } from '@service/reports/csv';

import { ENCRYPTED_EXPORT_README, ENCRYPTED_EXPORT_README_PATH, type ExportManifest, type ExportManifestFile } from './export-format';

/**
 * One file of the archive. `rows` is pulled lazily, a batch at a time, while the zip is being
 * written, so a household with years of transactions never sits in memory at once.
 */
export type ExportFileSource =
  | { format: 'csv'; header: readonly string[]; path: string; rows: () => AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]> }
  | { format: 'json'; path: string; rows: () => AsyncIterable<unknown> | Iterable<unknown> };

/** Text is handed to the zip in chunks of about this size rather than row by row. */
const CHUNK_BYTES = 64 * 1024;

export interface ExportArchiveInput {
  files: readonly ExportFileSource[];
  manifest: Omit<ExportManifest, 'files'>;
  /**
   * Encrypt the archive with this password (`export-format.ts`, "Password protection"). It is
   * used in memory only, to derive each file's key while the archive is written.
   */
  password?: string;
}

/**
 * Write the archive to `output`: every file in order, then `manifest.json` with each file's row
 * count, size and SHA-256. Resolves once the last byte is written; rejects (and destroys
 * `output`) if a file's rows fail, so a half-written zip is never mistaken for a finished one.
 *
 * With a password every file is encrypted as it is written, so no unencrypted copy of the
 * archive exists anywhere, not even in a temporary file.
 */
export async function writeExportArchive(input: ExportArchiveInput, output: Writable): Promise<ExportManifest> {
  if (input.password !== undefined) return writeEncryptedArchive(input.files, input.manifest, input.password, output);
  const zip = new ZipFile();
  const mtime = new Date(input.manifest.exportedAt);
  const written: ExportManifestFile[] = [];
  let failed: Error | undefined;

  const done = new Promise<void>((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
    zip.outputStream.once('error', reject);
  });

  const fail = (error: unknown) => {
    failed ??= error instanceof Error ? error : new Error(String(error));
    output.destroy(failed);
  };

  for (const file of input.files) {
    const stream = Readable.from(fileChunks(file, (entry) => written.push(entry)));
    stream.once('error', fail);
    zip.addReadStream(stream, file.path, { mtime });
  }

  const manifest = (): ExportManifest => ({ ...input.manifest, files: written });
  // Lazy: yazl reads an entry's stream only when every entry before it is fully written, so
  // by the time this generator runs the counts and hashes above are complete.
  const manifestStream = Readable.from((function* manifestChunks() {
    yield Buffer.from(`${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');
  })());
  zip.addReadStream(manifestStream, 'manifest.json', { mtime });

  zip.outputStream.pipe(output);
  zip.end();
  await done;
  if (failed) throw failed;
  return manifest();
}

async function* fileChunks(file: ExportFileSource, onDone: (entry: ExportManifestFile) => void): AsyncGenerator<Buffer> {
  const hash = createHash('sha256');
  let bytes = 0;
  let rows = 0;
  let pending = '';

  const take = (): Buffer => {
    const chunk = Buffer.from(pending, 'utf8');
    pending = '';
    hash.update(chunk);
    bytes += chunk.length;
    return chunk;
  };

  if (file.format === 'json') {
    pending = '[';
    for await (const row of file.rows()) {
      pending += `${rows === 0 ? '\n' : ',\n'}${JSON.stringify(row)}`;
      rows += 1;
      if (pending.length >= CHUNK_BYTES) yield take();
    }
    pending += rows === 0 ? ']\n' : '\n]\n';
  } else {
    // A UTF-8 byte-order mark so Excel opens accented text correctly, as the report CSVs do.
    pending = `\uFEFF${file.header.map(csvEscape).join(',')}\n`;
    for await (const row of file.rows()) {
      pending += `${row.map(csvEscape).join(',')}\n`;
      rows += 1;
      if (pending.length >= CHUNK_BYTES) yield take();
    }
  }
  yield take();
  onDone({ bytes, path: file.path, rows, sha256: hash.digest('hex') });
}

/**
 * The same archive as a WinZip AES-256 zip: a plain `README.txt` first, then every file and the
 * manifest encrypted (AE-2, see `export-format.ts`).
 */
async function writeEncryptedArchive(files: readonly ExportFileSource[], header: Omit<ExportManifest, 'files'>, password: string, output: Writable): Promise<ExportManifest> {
  const written: ExportManifestFile[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
  });
  // Awaited only on success; a failure is thrown from the loop below instead.
  finished.catch(() => undefined);
  const zip = new ZipWriter(Writable.toWeb(output), { lastModDate: new Date(header.exportedAt), useWebWorkers: false });
  const encrypted = { encryptionStrength: 3, password } as const;

  try {
    await zip.add(ENCRYPTED_EXPORT_README_PATH, new TextReader(ENCRYPTED_EXPORT_README));
    // One file at a time, in order, so the manifest below sees every count and hash.
    for (const file of files) {
      const content = Readable.toWeb(Readable.from(fileChunks(file, (entry) => written.push(entry)))) as ReadableStream<Uint8Array>;
      await zip.add(file.path, content, encrypted);
    }
    const manifest: ExportManifest = { ...header, files: written };
    await zip.add('manifest.json', new TextReader(`${JSON.stringify(manifest, null, 2)}\n`), encrypted);
    await zip.close();
    await finished;
    return manifest;
  } catch (error) {
    output.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
