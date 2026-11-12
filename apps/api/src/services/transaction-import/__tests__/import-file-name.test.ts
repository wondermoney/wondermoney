import { describe, expect, it } from 'vitest';

import { IMPORT_FILE_NAME_MAX_LENGTH, importFileName } from '../import-file-name';

/*
 * The name a file had on the person's device, as an import keeps it for their history: the name
 * alone, without a folder, control characters or direction overrides, and short enough to store.
 */
describe('the file name an import keeps', () => {
  it('keeps a name in any script as it was given', () => {
    expect(importFileName('Extrato março 2026 – Caixa Geral.csv')).toBe('Extrato março 2026 – Caixa Geral.csv');
    expect(importFileName('銀行明細_2026年10月.ofx')).toBe('銀行明細_2026年10月.ofx');
    expect(importFileName('конто 🏦 октябрь.qif')).toBe('конто 🏦 октябрь.qif');
  });

  it('stores one spelling of an accented name, however the device composed it', () => {
    expect(importFileName('Extrato marc\u0327o.csv')).toBe('Extrato março.csv');
  });

  it('drops the folder a browser or device put in front of the name', () => {
    expect(importFileName('C:\\Users\\ana\\Downloads\\statement.csv')).toBe('statement.csv');
    expect(importFileName('/storage/emulated/0/Download/statement.csv')).toBe('statement.csv');
  });

  it('drops control characters and direction overrides, which could disguise the name', () => {
    expect(importFileName('state\u0000ment\u0007.csv')).toBe('statement.csv');
    expect(importFileName('invoice\u202Evsc.exe')).toBe('invoicevsc.exe');
    expect(importFileName('  two   spaces\t.csv  ')).toBe('two spaces .csv');
  });

  it('caps a very long name, keeping its extension and never splitting a character', () => {
    const long = importFileName(`${'🏦'.repeat(400)}.csv`) ?? '';
    expect(Array.from(long)).toHaveLength(IMPORT_FILE_NAME_MAX_LENGTH);
    expect(long.endsWith('….csv')).toBe(true);
    expect(long.startsWith('🏦🏦')).toBe(true);
    expect(long).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);

    // A family emoji is one character to a reader but several code points: it is kept whole or not at all.
    const family = '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}';
    const families = importFileName(`${family.repeat(100)}.csv`) ?? '';
    expect(Array.from(families).length).toBeLessThanOrEqual(IMPORT_FILE_NAME_MAX_LENGTH);
    expect(families.replace('….csv', '').split(family).every((part) => part === '')).toBe(true);

    const noExtension = importFileName('x'.repeat(1000)) ?? '';
    expect(Array.from(noExtension)).toHaveLength(IMPORT_FILE_NAME_MAX_LENGTH);
    expect(noExtension.endsWith('…')).toBe(true);
  });

  it('keeps no name when nothing readable is left', () => {
    for (const raw of [undefined, '', '   ', '\u0000\u0007', 'C:\\folder\\', '..', '.']) expect(importFileName(raw)).toBeUndefined();
  });
});
