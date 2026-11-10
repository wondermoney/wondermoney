import { PassThrough } from 'node:stream';

import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { type ExportFileSource, writeExportArchive } from '../export-archive';
import { ExportArchiveError, openExportArchive } from '../export-archive-reader';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type ExportManifest } from '../export-format';

/*
 * The archive itself, with and without a password. A password-protected export is a standard
 * WinZip AES-256 zip (what 7-Zip, Keka and WinRAR open): every file is encrypted and authenticated,
 * so it cannot be read without the password and a changed byte is caught, while a plain README says
 * how to open it.
 */
describe('export archive', () => {
  const PASSWORD = 'correct horse battery staple';

  const files: ExportFileSource[] = [
    { format: 'json', path: 'data/accounts.json', rows: () => [{ id: 1, name: 'MARKER-ACCOUNT-NAME' }, { id: 2, name: 'Savings' }] },
    { format: 'csv', header: ['date', 'amount'], path: 'csv/transactions.csv', rows: () => [['2026-10-01', '-12.5']] },
  ];
  const manifest: Omit<ExportManifest, 'files'> = {
    appVersion: 'test',
    currency: 'EUR',
    exportedAt: '2026-11-08T10:00:00.000Z',
    exportedBy: { memberId: 1 },
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    household: { id: 1, ownerMemberId: 1 },
    scope: 'member-visible',
  };

  async function write(password?: string, sources: readonly ExportFileSource[] = files): Promise<Buffer> {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    await writeExportArchive({ files: sources, manifest, ...(password === undefined ? {} : { password }) }, output);
    return Buffer.concat(chunks);
  }

  async function readAll(bytes: Uint8Array, password?: string): Promise<Record<string, string>> {
    const archive = await openExportArchive(bytes, password === undefined ? {} : { password });
    try {
      const out: Record<string, string> = {};
      for (const path of archive.paths) out[path] = strFromU8(await archive.read(path));
      return out;
    } finally {
      await archive.close();
    }
  }

  /** Central-directory records, read straight off the bytes rather than through any zip library. */
  function centralDirectory(bytes: Buffer) {
    const records: { aes?: { strength: number; vendor: string; vendorVersion: number }; encrypted: boolean; method: number; name: string }[] = [];
    let at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (at >= 0 && bytes.readUInt32LE(at) === 0x02014b50) {
      const flags = bytes.readUInt16LE(at + 8);
      const method = bytes.readUInt16LE(at + 10);
      const nameLength = bytes.readUInt16LE(at + 28);
      const extraLength = bytes.readUInt16LE(at + 30);
      const commentLength = bytes.readUInt16LE(at + 32);
      const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      let aes: undefined | { strength: number; vendor: string; vendorVersion: number };
      for (let offset = 0; offset + 4 <= extra.length;) {
        const id = extra.readUInt16LE(offset);
        const size = extra.readUInt16LE(offset + 2);
        if (id === 0x9901) aes = { strength: extra[offset + 8]!, vendor: extra.subarray(offset + 6, offset + 8).toString('latin1'), vendorVersion: extra.readUInt16LE(offset + 4) };
        offset += 4 + size;
      }
      records.push({ ...(aes ? { aes } : {}), encrypted: (flags & 1) === 1, method, name });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return records;
  }

  /** Flip one bit inside the stored (encrypted) data of `path`. */
  function tamper(bytes: Buffer, path: string): Buffer {
    const copy = Buffer.from(bytes);
    const name = Buffer.from(path, 'utf8');
    let at = copy.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    while (at >= 0) {
      const nameLength = copy.readUInt16LE(at + 26);
      const extraLength = copy.readUInt16LE(at + 28);
      if (copy.subarray(at + 30, at + 30 + nameLength).equals(name)) {
        // Past the 16-byte salt and 2-byte password verifier of AES-256: the ciphertext.
        const data = at + 30 + nameLength + extraLength + 18;
        copy[data + 2] = copy[data + 2]! ^ 0x01;
        return copy;
      }
      at = copy.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), at + 4);
    }
    throw new Error(`no entry ${path}`);
  }

  describe('without a password', () => {
    it('is a plain zip any tool opens, with no README and nothing encrypted', async () => {
      const bytes = await write();

      const entries = unzipSync(new Uint8Array(bytes));
      expect(Object.keys(entries).sort()).toEqual(['csv/transactions.csv', 'data/accounts.json', 'manifest.json']);
      expect(centralDirectory(bytes).every((record) => !record.encrypted)).toBe(true);
      await expect(readAll(bytes)).resolves.toMatchObject({ 'data/accounts.json': expect.stringContaining('MARKER-ACCOUNT-NAME') });
    });
  });

  describe('with a password', () => {
    it('encrypts every file with WinZip AES-256 and leaves only the README readable', async () => {
      const bytes = await write(PASSWORD);

      const records = centralDirectory(bytes);
      expect(records.map((record) => record.name)).toEqual(['README.txt', 'data/accounts.json', 'csv/transactions.csv', 'manifest.json']);
      expect(records[0]).toEqual({ encrypted: false, method: expect.any(Number), name: 'README.txt' });
      for (const record of records.slice(1)) {
        // Method 99 with an AE-2 extra field of strength 3: the WinZip AES-256 format 7-Zip reads.
        expect(record).toEqual({ aes: { strength: 3, vendor: 'AE', vendorVersion: 2 }, encrypted: true, method: 99, name: record.name });
      }
      expect(bytes.includes(Buffer.from('MARKER-ACCOUNT-NAME'))).toBe(false);
      expect(bytes.includes(Buffer.from(PASSWORD))).toBe(false);
    });

    it('holds the same files and manifest as an unprotected export, readable with the password', async () => {
      const plain = await readAll(await write());
      const bytes = await write(PASSWORD);
      const encrypted = await readAll(bytes, PASSWORD);

      expect(encrypted).toEqual(plain);
      expect(JSON.parse(encrypted['manifest.json']!)).toEqual(expect.objectContaining({ format: 'wondermoney-export', formatVersion: EXPORT_FORMAT_VERSION }));
      // The README opens in any zip tool, without the password.
      const readme = unzipSync(new Uint8Array(bytes), { filter: (file) => file.name === 'README.txt' })['README.txt']!;
      expect(strFromU8(readme)).toMatch(/7-Zip/u);
    });

    it('says the archive is protected, and asks for the password, before reading anything', async () => {
      const bytes = await write(PASSWORD);

      await expect(openExportArchive(bytes)).rejects.toMatchObject({ code: 'password_required' });
      const archive = await openExportArchive(bytes, { password: PASSWORD });
      expect(archive.encrypted).toBe(true);
      await archive.close();
    });

    it('refuses a wrong password', async () => {
      const bytes = await write(PASSWORD);

      for (const wrong of ['correct horse battery stapl', 'Correct horse battery staple', `${PASSWORD} `]) {
        const error = await openExportArchive(bytes, { password: wrong }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ExportArchiveError);
        expect(error).toMatchObject({ code: 'password_incorrect' });
        expect((error as Error).message).not.toContain(wrong);
      }
    });

    it('catches a single changed byte in any file', async () => {
      const bytes = await write(PASSWORD);

      for (const path of ['data/accounts.json', 'csv/transactions.csv', 'manifest.json']) {
        const tampered = tamper(bytes, path);
        await expect(readAll(tampered, PASSWORD)).rejects.toMatchObject({ code: 'corrupt' });
      }
    });

    it('rejects a truncated file', async () => {
      const bytes = await write(PASSWORD);

      await expect(readAll(bytes.subarray(0, Math.floor(bytes.length / 2)), PASSWORD)).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('gives each archive its own salt, so two exports of the same data differ', async () => {
      const first = await write(PASSWORD);
      const second = await write(PASSWORD);

      expect(first.equals(second)).toBe(false);
    });

    it('fails, and closes the output, when a file cannot be read', async () => {
      const broken: ExportFileSource[] = [
        ...files,
        {
          format: 'json',
          path: 'data/broken.json',
          rows: async function* rows() {
            yield { id: 1 };
            throw new Error('database went away');
          },
        },
      ];
      const output = new PassThrough();
      output.resume();

      await expect(writeExportArchive({ files: broken, manifest, password: PASSWORD }, output)).rejects.toThrow('database went away');
      expect(output.destroyed).toBe(true);
    });
  });

  describe('reading', () => {
    it('rejects a zip that is not an export', async () => {
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (chunk: Buffer) => chunks.push(chunk));
      const { ZipFile } = await import('yazl');
      const zip = new ZipFile();
      zip.addBuffer(Buffer.from('hello'), 'hello.txt');
      zip.end();
      await new Promise<void>((resolve) => { zip.outputStream.pipe(output).on('finish', resolve); });

      await expect(openExportArchive(Buffer.concat(chunks))).rejects.toMatchObject({ code: 'not_an_export' });
      await expect(openExportArchive(Buffer.from('not a zip at all'))).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('rejects a protected export with a file swapped for an unencrypted one', async () => {
      const { TextReader, Uint8ArrayWriter, ZipWriter } = await import('@zip.js/zip.js');
      const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
      await writer.add('data/accounts.json', new TextReader('[{"id":1,"name":"Planted"}]\n'));
      await writer.add('manifest.json', new TextReader(JSON.stringify({ ...manifest, files: [] })), { encryptionStrength: 3, password: PASSWORD });
      const bytes = await writer.close();

      await expect(openExportArchive(bytes, { password: PASSWORD })).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('refuses a file over the size limit before inflating it, protected or not', async () => {
      const big: ExportFileSource[] = [{ format: 'json', path: 'data/accounts.json', rows: () => Array.from({ length: 2000 }, (_, id) => ({ id, name: 'x'.repeat(50) })) }];

      for (const password of [undefined, PASSWORD]) {
        const bytes = await write(password, big);
        await expect(openExportArchive(bytes, { maxFileBytes: 10_000, ...(password ? { password } : {}) })).rejects.toMatchObject({ code: 'too_large' });
        const archive = await openExportArchive(bytes, { maxFileBytes: 1_000_000, ...(password ? { password } : {}) });
        expect((await archive.read('data/accounts.json')).length).toBeGreaterThan(10_000);
        await archive.close();
      }
    });

    it('refuses a file whose header understates its size, without inflating it into memory', async () => {
      const bytes = Buffer.from(await write(undefined, [{ format: 'json', path: 'data/accounts.json', rows: () => Array.from({ length: 2000 }, (_, id) => ({ id, name: 'x'.repeat(50) })) }]));
      // Claim 100 bytes for data/accounts.json in its local (offset 22) and central (offset 24) headers.
      for (const { nameAt, nameLengthAt, signature, sizeAt } of [
        { nameAt: 30, nameLengthAt: 26, signature: [0x50, 0x4b, 0x03, 0x04], sizeAt: 22 },
        { nameAt: 46, nameLengthAt: 28, signature: [0x50, 0x4b, 0x01, 0x02], sizeAt: 24 },
      ]) {
        for (let at = bytes.indexOf(Buffer.from(signature)); at >= 0; at = bytes.indexOf(Buffer.from(signature), at + 4)) {
          const name = bytes.subarray(at + nameAt, at + nameAt + bytes.readUInt16LE(at + nameLengthAt)).toString('utf8');
          if (name === 'data/accounts.json') bytes.writeUInt32LE(100, at + sizeAt);
        }
      }

      const archive = await openExportArchive(bytes, { maxFileBytes: 10_000 });

      // zip.js notices the mismatch itself or the size cap stops it: either way it is never read whole.
      await expect(archive.read('data/accounts.json')).rejects.toMatchObject({ code: expect.stringMatching(/^(corrupt|too_large)$/u) });
      await archive.close();
    });
  });
});
