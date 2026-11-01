import { describe, expect, it, vi } from 'vitest';

import {
  assertCsvTextLimits,
  buildCsvObjectKey,
  DEFAULT_CSV_UPLOAD_LIMITS,
  getLimitedCsvObjectBuffer,
  getLimitedCsvObjectText,
  parseCsvRows,
  validateCsvObjectKey,
} from '@service/account/csv-upload-boundary.service';

describe('csv upload boundary service', () => {
  it('builds csv object keys that pass shared validation from unsafe display names', () => {
    const accountKey = buildCsvObjectKey({ maxLength: 170, name: 'NORD LB Demo Bank', prefix: 'account-123-', uniqueId: 'upload-id' });
    const portfolioKey = buildCsvObjectKey({ maxLength: 200, name: 'Sparkasse Feldkirchen Kärnten', prefix: 'portfolio-7-', uniqueId: 'upload-id' });
    const sanitizedKey = buildCsvObjectKey({ maxLength: 200, name: 'bad:/\x01name\x1F\x7F', prefix: 'portfolio-7-', uniqueId: 'upload-id' });

    expect(accountKey).toBe('account-123-NORD LB Demo Bank-upload-id.csv');
    expect(validateCsvObjectKey({ key: accountKey, maxLength: 170, prefix: 'account-123-' })).toBe(true);
    expect(validateCsvObjectKey({ key: portfolioKey, maxLength: 200, prefix: 'portfolio-7-' })).toBe(true);
    expect(sanitizedKey).toBe('portfolio-7-bad___name__-upload-id.csv');
    expect(validateCsvObjectKey({ key: sanitizedKey, maxLength: 200, prefix: 'portfolio-7-' })).toBe(true);
  });

  it('validates csv object keys with domain prefix and safe characters', () => {
    expect(validateCsvObjectKey({ key: 'account-123-bank-name-id.csv', maxLength: 170, prefix: 'account-123-' })).toBe(true);
    expect(validateCsvObjectKey({ key: 'portfolio-7-broker_id.abc-123.csv', maxLength: 200, prefix: 'portfolio-7-' })).toBe(true);

    expect(validateCsvObjectKey({ key: 'other-123-bank-name-id.csv', maxLength: 170, prefix: 'account-123-' })).toBe(false);
    expect(validateCsvObjectKey({ key: 'account-123-bank-name-id.txt', maxLength: 170, prefix: 'account-123-' })).toBe(false);
    expect(validateCsvObjectKey({ key: `account-123-${'x'.repeat(160)}.csv`, maxLength: 170, prefix: 'account-123-' })).toBe(false);
  });

  it('rejects path separators, control characters, and colon in csv object keys', () => {
    const prefix = 'portfolio-7-';
    const invalidKeys = [
      'portfolio-7-folder/file.csv',
      'portfolio-7-folder\\file.csv',
      'portfolio-7-broker:file.csv',
      'portfolio-7-broker\0file.csv',
      'portfolio-7-broker\x01file.csv',
      'portfolio-7-broker\x1Ffile.csv',
      'portfolio-7-broker\x7Ffile.csv',
      'portfolio-7-broker\rfile.csv',
      'portfolio-7-broker\nfile.csv',
      'portfolio-7-broker\tfile.csv',
    ];

    for (const key of invalidKeys) {
      expect(validateCsvObjectKey({ key, maxLength: 200, prefix })).toBe(false);
    }
  });

  it('rejects oversized csv objects before downloading the body', async () => {
    const getObjectText = vi.fn();

    await expect(
      getLimitedCsvObjectText(
        { bucket: 'bucket', key: 'key.csv' },
        {
          getObjectSize: vi.fn().mockResolvedValue(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes + 1),
          getObjectText,
        },
      ),
    ).rejects.toThrow('CSV object exceeds max size');

    expect(getObjectText).not.toHaveBeenCalled();
  });

  it('rejects csv text that exceeds byte limits after download', async () => {
    await expect(
      getLimitedCsvObjectText(
        { bucket: 'bucket', key: 'key.csv' },
        {
          getObjectSize: vi.fn().mockResolvedValue(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes),
          getObjectText: vi.fn().mockResolvedValue('x'.repeat(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes + 1)),
        },
      ),
    ).rejects.toThrow('CSV object exceeds max size');
  });

  it('rejects oversized csv objects before downloading the buffer', async () => {
    const getObjectBuffer = vi.fn();

    await expect(
      getLimitedCsvObjectBuffer(
        { bucket: 'bucket', key: 'key.csv' },
        {
          getObjectBuffer,
          getObjectSize: vi.fn().mockResolvedValue(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes + 1),
        },
      ),
    ).rejects.toThrow('CSV object exceeds max size');

    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it('rejects oversized csv buffers after download', async () => {
    await expect(
      getLimitedCsvObjectBuffer(
        { bucket: 'bucket', key: 'key.csv' },
        {
          getObjectBuffer: vi.fn().mockResolvedValue(Buffer.alloc(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes + 1)),
          getObjectSize: vi.fn().mockResolvedValue(DEFAULT_CSV_UPLOAD_LIMITS.maxBytes),
        },
      ),
    ).rejects.toThrow('CSV object exceeds max size');
  });

  it('enforces csv text limits before parsing rows', () => {
    expect(() => { assertCsvTextLimits(''); }).not.toThrow();
    expect(() => { assertCsvTextLimits('a\nb'); }).not.toThrow();
    expect(() => { assertCsvTextLimits('a\nb\n'); }).not.toThrow();
    expect(() => { assertCsvTextLimits('a,"b\nc"\nd'); }).not.toThrow();
    expect(() => { assertCsvTextLimits(Array.from({ length: DEFAULT_CSV_UPLOAD_LIMITS.maxRows }, () => '1').join('\n') + '\n'); }).not.toThrow();
    expect(() => { assertCsvTextLimits(`a\n${Array.from({ length: DEFAULT_CSV_UPLOAD_LIMITS.maxRows }, () => '1').join('\n')}`); }).toThrow('CSV exceeds max row count');
    expect(() => { assertCsvTextLimits(Array.from({ length: DEFAULT_CSV_UPLOAD_LIMITS.maxRows + 1 }, () => '1').join('\n')); }).toThrow('CSV exceeds max row count');
    expect(() => { assertCsvTextLimits(`${Array.from({ length: DEFAULT_CSV_UPLOAD_LIMITS.maxColumns + 1 }, (_, index) => `c${index}`).join(',')}\n1`); }).toThrow('CSV exceeds max column count');
    expect(() => { assertCsvTextLimits(`a\n${'x'.repeat(DEFAULT_CSV_UPLOAD_LIMITS.maxFieldLength + 1)}`); }).toThrow('CSV field exceeds max length');
  });

  it('parses csv rows with shared parser options', () => {
    const rows = parseCsvRows<{ amount: string; description: string }>('amount,description\n10,"Shop, Inc."');

    expect(rows).toEqual([{ amount: '10', description: 'Shop, Inc.' }]);
  });

  it('parses a bank export: header row as keys, trimmed cells, quoted newlines, blank lines skipped', () => {
    const csv = 'date , amount,description\r\n2026-01-02, -12.50 ,"Coffee\nshop"\r\n\r\n2026-01-03,100,"Salary, ACME"\r\n';

    expect(parseCsvRows<Record<string, string>>(csv)).toEqual([
      { amount: '-12.50', date: '2026-01-02', description: 'Coffee\nshop' },
      { amount: '100', date: '2026-01-03', description: 'Salary, ACME' },
    ]);
  });

  it('rejects a row whose column count does not match the header', () => {
    expect(() => parseCsvRows('a,b\n1,2,3')).toThrow();
  });
});
