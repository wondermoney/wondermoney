import { BlobReader, ERR_INVALID_PASSWORD, type FileEntry, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { ENCRYPTED_EXPORT_README_PATH } from './export-format';

/**
 * Opens a WonderMoney export (`export-format.ts`), protected or not, for reading back: the entry
 * point for restore (wondermoney/wondermoney#67).
 *
 * It answers whether the archive is protected, checks the password, and decrypts and
 * authenticates each file as it is read. It does not check the manifest's counts and SHA-256
 * against the files; restore does that before it writes anything.
 */

/** An opened export. Close it when done. */
export interface ExportArchive {
  close(): Promise<void>;
  /** Whether the archive is password protected. */
  encrypted: boolean;
  /** Every file but the README of a protected archive, in archive order. */
  paths: string[];
  /** One file's bytes, decrypted and authenticated. Throws `ExportArchiveError` (`corrupt`). */
  read(path: string): Promise<Uint8Array>;
  /**
   * A file's uncompressed size as its zip header states it, so a reader can refuse an oversized
   * file before inflating it. Undefined for a path the archive does not hold.
   */
  size(path: string): number | undefined;
}

export type ExportArchiveErrorCode =
  /** Not a zip, truncated, a changed byte, or a protected archive with an unprotected file in it. */
  | 'corrupt'
  /** A zip without `manifest.json`. */
  | 'not_an_export'
  | 'password_incorrect'
  | 'password_required'
  /** A file larger than the caller's `maxFileBytes`, by its header or once inflated. */
  | 'too_large';

export class ExportArchiveError extends Error {
  constructor(readonly code: ExportArchiveErrorCode, message: string) {
    super(message);
    this.name = 'ExportArchiveError';
  }
}

const MANIFEST_PATH = 'manifest.json';
/** WinZip AES strength 3: a 256-bit key. */
const AES_256 = 3;

export interface OpenExportArchiveOptions {
  /**
   * Refuse (`too_large`) any file whose header states more than this many bytes, and stop inflating
   * one that turns out bigger than this however small its header says it is: a zip that inflates a
   * few megabytes into gigabytes never reaches memory whole.
   */
  maxFileBytes?: number;
  password?: string;
}

/**
 * Open `source`. A protected archive needs `password`, which is checked here (against the
 * manifest) before anything else is read. The password is never part of an error message.
 */
export async function openExportArchive(source: Blob | Uint8Array, options: OpenExportArchiveOptions = {}): Promise<ExportArchive> {
  const reader = new ZipReader(source instanceof Uint8Array ? new Uint8ArrayReader(source) : new BlobReader(source), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries().catch((error: unknown) => {
      throw corrupt(error);
    });
    const files = new Map<string, FileEntry>();
    for (const entry of entries) {
      if (entry.directory) continue;
      if (files.has(entry.filename)) throw new ExportArchiveError('corrupt', `The archive holds ${entry.filename} twice`);
      files.set(entry.filename, entry);
    }
    const manifest = files.get(MANIFEST_PATH);
    if (!manifest) throw new ExportArchiveError('not_an_export', 'The archive has no manifest.json');

    const encrypted = manifest.encrypted;
    if (encrypted) files.delete(ENCRYPTED_EXPORT_README_PATH);
    for (const entry of files.values()) {
      // All or nothing: a protected archive with a clear (or weakly encrypted) file has been altered.
      const aes = entry.encrypted && !entry.zipCrypto && entry.extraFieldAES?.strength === AES_256;
      if (aes !== encrypted || (!encrypted && entry.encrypted)) throw new ExportArchiveError('corrupt', `${entry.filename} is not protected like the rest of the archive`);
    }
    const maxFileBytes = options.maxFileBytes ?? Number.POSITIVE_INFINITY;
    for (const entry of files.values()) {
      if (entry.uncompressedSize > maxFileBytes) throw new ExportArchiveError('too_large', `${entry.filename} is larger than ${maxFileBytes} bytes`);
    }
    if (encrypted && !options.password) throw new ExportArchiveError('password_required', 'The archive is password protected');

    const read = async (path: string): Promise<Uint8Array> => {
      const entry = files.get(path);
      if (!entry) throw new ExportArchiveError('corrupt', `The archive has no ${path}`);
      const readOptions = { ...(encrypted ? { password: options.password! } : {}), checkSignature: true, useWebWorkers: false };
      try {
        if (!Number.isFinite(maxFileBytes)) return await entry.getData(new Uint8ArrayWriter(), readOptions);
        const collector = cappedCollector(path, maxFileBytes);
        await entry.getData(collector.writable, readOptions);
        return collector.bytes();
      } catch (error) {
        if (error instanceof Error && error.message === ERR_INVALID_PASSWORD) throw new ExportArchiveError('password_incorrect', 'The password is incorrect');
        throw corrupt(error);
      }
    };
    // Checks the password, and that the manifest is intact, before the caller reads anything.
    await read(MANIFEST_PATH);

    return { close: () => reader.close(), encrypted, paths: [...files.keys()], read, size: (path) => files.get(path)?.uncompressedSize };
  } catch (error) {
    await reader.close().catch(() => undefined);
    throw error;
  }
}

/** A sink that keeps what it is given and fails once it passes `limit` bytes. */
function cappedCollector(path: string, limit: number) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      total += chunk.length;
      if (total > limit) throw new ExportArchiveError('too_large', `${path} is larger than ${limit} bytes`);
      chunks.push(chunk);
    },
  });
  const bytes = () => {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  return { bytes, writable };
}

function corrupt(error: unknown): ExportArchiveError {
  if (error instanceof ExportArchiveError) return error;
  const reason = error instanceof Error ? error.message : 'unreadable';
  return new ExportArchiveError('corrupt', `The archive is damaged or was changed (${reason})`);
}

