import { PassThrough } from 'node:stream';

import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { type ExportFileSource, writeExportArchive } from '@service/data-export/export-archive';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type ExportManifest } from '@service/data-export/export-format';

import { readRestoreArchive } from '../restore-reader';

/*
 * Reading an uploaded export back: only an intact WonderMoney export of a supported version, with
 * every row valid and every reference resolvable, gets through. Everything else is refused with a
 * code the person can act on, before anything is written.
 */
describe('restore reader', () => {
  const PASSWORD = 'a long enough backup password';

  const header: Omit<ExportManifest, 'files'> = {
    appVersion: 'test',
    currency: 'EUR',
    exportedAt: '2026-11-08T10:00:00.000Z',
    exportedBy: { memberId: 1 },
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    household: { id: 1, ownerMemberId: 1 },
    scope: 'member-visible',
  };

  const member = { email: 'me@example.test', firstName: 'Me', id: 1, isExporter: true, lastName: null, role: 'owner' };
  const account = { accountNumber: null, balance: '10.5', bankLinked: false, closed: false, createdAt: '2026-01-01T00:00:00.000Z', currency: 'EUR', holderName: null, id: 1, institution: null, isPrivate: false, name: 'Current', openingBalance: '0', openingBalanceDate: null, ownerMemberId: 1, type: null };
  const transaction = {
    accountId: 1, balance: '10.5', bankSynced: false, createdAt: null, date: '2026-02-01T12:00:00.000Z', description: 'Salary', descriptionEditedByUser: false, descriptionRaw: null, editedSettlementAmount: null,
    hidden: false, id: 1, memberId: 1, merchantEditedByUser: false, merchantId: null, notes: null, originalAmount: '10.5', originalCurrency: 'EUR', reviewed: false, settlementAmount: '10.5',
    settlementCurrency: 'EUR', settlementExchangeRate: null, status: 'BOOKED', transferCounterpartId: null, transferDestinationAccountId: null, transferDestinationGoalId: null,
    transferDestinationPortfolioId: null, type: 'income', uneditedSettlementAmount: null, userAmount: '10.5', userCurrency: 'EUR', userExchangeRate: null,
  };

  function sources(overrides: Record<string, unknown[]> = {}): ExportFileSource[] {
    const data: Record<string, unknown[]> = { accounts: [account], members: [member], transactions: [transaction], ...overrides };
    return Object.entries(data).map(([name, rows]) => ({ format: 'json', path: `data/${name}.json`, rows: () => rows }));
  }

  async function archive(options: { files?: ExportFileSource[]; manifest?: Partial<ExportManifest>; password?: string } = {}): Promise<Uint8Array> {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    await writeExportArchive({ files: options.files ?? sources(), manifest: { ...header, ...options.manifest }, ...(options.password ? { password: options.password } : {}) }, output);
    return new Uint8Array(Buffer.concat(chunks));
  }

  /** The same archive with `path` replaced (and the manifest left as it was). */
  function replace(bytes: Uint8Array, path: string, content: string): Uint8Array {
    const entries = unzipSync(bytes);
    entries[path] = strToU8(content);
    return zipSync(entries);
  }

  it('reads an intact export into checked rows', async () => {
    const parsed = await readRestoreArchive(await archive());

    expect(parsed.encrypted).toBe(false);
    expect(parsed.manifest.exportedBy.memberId).toBe(1);
    expect(parsed.rows.accounts).toEqual([expect.objectContaining({ balance: '10.5', name: 'Current' })]);
    expect(parsed.rows.transactions).toHaveLength(1);
    // A file an older export does not have reads as empty.
    expect(parsed.rows.loans).toEqual([]);
  });

  describe('password protection', () => {
    it('reads a protected export with its password', async () => {
      const parsed = await readRestoreArchive(await archive({ password: PASSWORD }), { password: PASSWORD });

      expect(parsed.encrypted).toBe(true);
      expect(parsed.rows.accounts).toHaveLength(1);
    });

    it('asks for the password, and refuses a wrong one without echoing it', async () => {
      const bytes = await archive({ password: PASSWORD });

      await expect(readRestoreArchive(bytes)).rejects.toMatchObject({ code: 'password_required' });
      const error = await readRestoreArchive(bytes, { password: 'not the right password' }).then(() => new Error('read'), (caught: unknown) => caught as Error);
      expect(error).toMatchObject({ code: 'password_incorrect' });
      expect(error.message).not.toContain('not the right password');
    });
  });

  describe('a damaged or altered file', () => {
    it('refuses a data file changed after export', async () => {
      const bytes = await archive();
      const tampered = replace(bytes, 'data/accounts.json', JSON.stringify([{ ...account, balance: '1000000' }]));

      await expect(readRestoreArchive(tampered)).rejects.toMatchObject({ code: 'corrupt', detail: { file: 'data/accounts.json' } });
    });

    it('refuses a file added to, or removed from, the archive', async () => {
      const bytes = await archive();
      const added = unzipSync(bytes);
      added['data/extra.json'] = strToU8('[]');
      const removed = unzipSync(bytes);
      delete removed['data/transactions.json'];

      await expect(readRestoreArchive(zipSync(added))).rejects.toMatchObject({ code: 'corrupt' });
      await expect(readRestoreArchive(zipSync(removed))).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('refuses a truncated archive', async () => {
      const bytes = await archive();

      await expect(readRestoreArchive(bytes.subarray(0, Math.floor(bytes.length * 0.6)))).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('refuses something that is not an export', async () => {
      await expect(readRestoreArchive(zipSync({ 'notes.txt': strToU8('hello') }))).rejects.toMatchObject({ code: 'not_an_export' });
      await expect(readRestoreArchive(zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'other' })) }))).rejects.toMatchObject({ code: 'not_an_export' });
      await expect(readRestoreArchive(strToU8('plain text'))).rejects.toMatchObject({ code: 'corrupt' });
    });
  });

  describe('versions', () => {
    it('refuses another major version', async () => {
      await expect(readRestoreArchive(await archive({ manifest: { formatVersion: '2.0' } as unknown as Partial<ExportManifest> }))).rejects.toMatchObject({ code: 'unsupported_version' });
    });

    it('reads a newer minor version, ignoring fields it does not know', async () => {
      const files = sources({ accounts: [{ ...account, colour: 'blue' }] });

      const parsed = await readRestoreArchive(await archive({ files, manifest: { formatVersion: '1.7' } as unknown as Partial<ExportManifest> }));

      expect(parsed.rows.accounts[0]).not.toHaveProperty('colour');
    });
  });

  describe('merchants', () => {
    const merchant = { global: false, id: 1, name: 'Corner Shop' };

    it('reads a merchant from before websites and logos as having neither', async () => {
      const parsed = await readRestoreArchive(await archive({ files: sources({ merchants: [merchant] }), manifest: { formatVersion: '1.3' } as unknown as Partial<ExportManifest> }));

      expect(parsed.rows.merchants[0]?.website ?? null).toBeNull();
      expect(parsed.rows.merchants[0]?.logoUrl ?? null).toBeNull();
    });

    it('keeps an https website and logo URL', async () => {
      const files = sources({ merchants: [{ ...merchant, logoUrl: 'https://cdn.example.com/shop.png', website: 'https://shop.example.com' }] });

      const parsed = await readRestoreArchive(await archive({ files }));

      expect(parsed.rows.merchants[0]).toMatchObject({ logoUrl: 'https://cdn.example.com/shop.png', website: 'https://shop.example.com' });
    });

    it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://shop.example.com/logo.png'])('refuses a logo URL of %s, which other members\' browsers would load', async (logoUrl) => {
      const files = sources({ merchants: [{ ...merchant, logoUrl }] });

      await expect(readRestoreArchive(await archive({ files }))).rejects.toMatchObject({ code: 'invalid_data', detail: { field: 'logoUrl', file: 'data/merchants.json', row: 1 } });
    });
  });

  describe('rows', () => {
    it('refuses a row that does not match its schema, saying where', async () => {
      const files = sources({ transactions: [{ ...transaction, settlementAmount: 12.5 }] });

      await expect(readRestoreArchive(await archive({ files }))).rejects.toMatchObject({ code: 'invalid_data', detail: { field: 'settlementAmount', file: 'data/transactions.json', row: 1 } });
    });

    it('refuses a reference to a row that is not in the export', async () => {
      const files = sources({ transactions: [{ ...transaction, accountId: 7 }] });

      await expect(readRestoreArchive(await archive({ files }))).rejects.toMatchObject({ code: 'invalid_data', detail: { field: 'accountId', file: 'data/transactions.json' } });
    });

    it('refuses an id used twice in one file', async () => {
      const files = sources({ accounts: [account, { ...account, name: 'Twin' }] });

      await expect(readRestoreArchive(await archive({ files }))).rejects.toMatchObject({ code: 'invalid_data', detail: { field: 'id', file: 'data/accounts.json', row: 2 } });
    });

    it('refuses a transaction with two transfer destinations', async () => {
      const files = sources({ accounts: [account, { ...account, id: 2 }], transactions: [{ ...transaction, transferDestinationAccountId: 2, transferDestinationGoalId: 1 }] });

      await expect(readRestoreArchive(await archive({ files }))).rejects.toMatchObject({ code: 'invalid_data', detail: { file: 'data/transactions.json' } });
    });
  });

  describe('card settings, installment plans and overrides', () => {
    const card = { accountId: 1, creditLimit: '1500', minimumPaymentPercent: null, paymentDueDay: 10, statementCloseDay: 25 };
    const plan = { accountId: 1, categoryId: null, createdAt: null, createdByMemberId: 1, description: 'Sofa', id: 1, installmentCount: 3, purchaseDate: '2026-01-20', totalAmount: '300' };
    const installment = { amount: '100', dueDate: null, installmentNumber: 1, planId: 1, scheduledDate: '2026-01-20', statementDate: null };
    const rate = { createdByMemberId: 1, date: '2026-02-06', fromCurrency: 'USD', rate: '0.92', toCurrency: 'EUR' };
    const price = { asset: { currency: 'USD', exchange: null, isin: null, name: 'Apple', symbol: 'AAPL', type: 'Stock' }, createdByMemberId: 1, currency: 'USD', date: '2026-03-31', note: null, price: '158.4' };
    const linked = { ...transaction, installmentNumber: 2, installmentPlanId: 1 };
    const tomorrowPlusOne = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    it('reads a plan, its schedule, the transaction that pays it, the card and the overrides', async () => {
      const files = sources({ 'credit-cards': [card], 'exchange-rate-overrides': [rate], 'installment-plans': [plan], installments: [installment], 'price-overrides': [price], transactions: [linked] });

      const parsed = await readRestoreArchive(await archive({ files }));

      expect(parsed.rows.transactions[0]).toMatchObject({ installmentNumber: 2, installmentPlanId: 1 });
      expect(parsed.rows['credit-cards']).toEqual([card]);
      expect(parsed.rows['installment-plans']).toEqual([plan]);
      expect(parsed.rows['exchange-rate-overrides']).toEqual([rate]);
      expect(parsed.rows['price-overrides']).toEqual([price]);
    });

    it.each([
      ['an installment past its plan\'s count', { 'installment-plans': [plan], installments: [{ ...installment, installmentNumber: 4 }] }, { field: 'installmentNumber', file: 'data/installments.json' }],
      ['the same installment twice', { 'installment-plans': [plan], installments: [installment, installment] }, { file: 'data/installments.json', row: 2 }],
      ['a transaction paying an installment on another card', { accounts: [account, { ...account, id: 2 }], 'installment-plans': [{ ...plan, accountId: 2 }], transactions: [linked] }, { field: 'accountId', file: 'data/transactions.json' }],
      ['two transactions paying one installment', { 'installment-plans': [plan], transactions: [linked, { ...transaction, id: 2 }, { ...linked, id: 3 }] }, { file: 'data/transactions.json', row: 3 }],
      ['an installment number without its plan', { transactions: [{ ...transaction, installmentNumber: 2 }] }, { file: 'data/transactions.json' }],
      ['a plan of one installment', { 'installment-plans': [{ ...plan, installmentCount: 1 }] }, { field: 'installmentCount', file: 'data/installment-plans.json' }],
      ['a card statement closing on day 32', { 'credit-cards': [{ ...card, statementCloseDay: 32 }] }, { field: 'statementCloseDay', file: 'data/credit-cards.json' }],
      ['two settings for one card', { 'credit-cards': [card, card] }, { file: 'data/credit-cards.json', row: 2 }],
      ['a rate from a currency to itself', { 'exchange-rate-overrides': [{ ...rate, toCurrency: 'USD' }] }, { file: 'data/exchange-rate-overrides.json' }],
      ['a rate of zero', { 'exchange-rate-overrides': [{ ...rate, rate: '0' }] }, { field: 'rate', file: 'data/exchange-rate-overrides.json' }],
      ['a rate for a day after tomorrow', { 'exchange-rate-overrides': [{ ...rate, date: tomorrowPlusOne }] }, { field: 'date', file: 'data/exchange-rate-overrides.json' }],
      ['two rates for one pair and day', { 'exchange-rate-overrides': [rate, rate] }, { file: 'data/exchange-rate-overrides.json', row: 2 }],
      ['a negative price', { 'price-overrides': [{ ...price, price: '-1' }] }, { field: 'price', file: 'data/price-overrides.json' }],
      ['two prices for one security and day', { 'price-overrides': [price, price] }, { file: 'data/price-overrides.json', row: 2 }],
    ])('refuses %s, before anything is written', async (_case, overrides, detail) => {
      await expect(readRestoreArchive(await archive({ files: sources(overrides) }))).rejects.toMatchObject({ code: 'invalid_data', detail });
    });

    it('reads a 1.7 export, which has none of them, with what the app gives a new row', async () => {
      const budget = { currency: 'EUR', description: null, id: 1, memberId: 1, name: 'Home', numAdults: 1, numDependents: 0 };
      const files = sources({ budgets: [budget] });

      const parsed = await readRestoreArchive(await archive({ files, manifest: { formatVersion: '1.7' } as unknown as Partial<ExportManifest> }));

      expect(parsed.rows['installment-plans']).toEqual([]);
      expect(parsed.rows['credit-cards']).toEqual([]);
      expect(parsed.rows['exchange-rate-overrides']).toEqual([]);
      expect(parsed.rows.budgets[0]).toMatchObject({ rolloverCarriesOverspend: true });
      expect(parsed.rows.transactions[0]?.installmentPlanId ?? null).toBeNull();
      expect(parsed.rows.accounts[0]?.position ?? null).toBeNull();
    });
  });

  describe('size', () => {
    it('refuses an archive, a file or a row count over the limits', async () => {
      const bytes = await archive();

      await expect(readRestoreArchive(bytes, { limits: { maxArchiveBytes: 100 } })).rejects.toMatchObject({ code: 'too_large' });
      await expect(readRestoreArchive(bytes, { limits: { maxFileBytes: 200 } })).rejects.toMatchObject({ code: 'too_large' });
      await expect(readRestoreArchive(bytes, { limits: { maxTotalBytes: 500 } })).rejects.toMatchObject({ code: 'too_large' });
      await expect(readRestoreArchive(bytes, { limits: { maxRows: 0 } })).rejects.toMatchObject({ code: 'too_large' });
    });
  });
});
