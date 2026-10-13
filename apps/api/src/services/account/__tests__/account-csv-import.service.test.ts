import { beforeEach, describe, expect, it, vi } from 'vitest';

const { balancePlanMock, categorizeMock, createTransactionMock, getBankParserMock, getObjectBufferMock, getObjectTextMock, parseExcelMock, recurringDetectionMock, s3GetObjectBufferMock } = vi.hoisted(() => ({ balancePlanMock: vi.fn(), categorizeMock: vi.fn(), createTransactionMock: vi.fn(), getBankParserMock: vi.fn(), getObjectBufferMock: vi.fn(), getObjectTextMock: vi.fn(), parseExcelMock: vi.fn(), recurringDetectionMock: vi.fn().mockResolvedValue(undefined), s3GetObjectBufferMock: vi.fn() }));
vi.mock('@wondermoney/shared', () => ({ csv: { getBankParser: getBankParserMock, parseExcel: parseExcelMock } }));
vi.mock('@service/account/account-csv-balance-recalculation.service', () => ({ default: { planBankBalances: balancePlanMock } }));
vi.mock('@service/account/account-csv-categorization.service', () => ({ default: { categorizeTransaction: categorizeMock } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: recurringDetectionMock }));
vi.mock('@service/storage/s3', () => ({ default: { getObjectBuffer: s3GetObjectBufferMock } }));
vi.mock('@service/transaction/transaction-creation.service', () => ({ transactionCreationService: { createTransaction: createTransactionMock } }));

import AccountCsvImportService from '@service/account/account-csv-import.service';

type ImportDeps = NonNullable<Parameters<InstanceType<typeof AccountCsvImportService>['importAccountCsv']>[1]>;
type ImportEm = NonNullable<ImportDeps['em']>;

describe('account csv import service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    balancePlanMock.mockReturnValue({ accountBalance: 0, items: [] });
    categorizeMock.mockResolvedValue(false);
    recurringDetectionMock.mockResolvedValue(undefined);
  });

  const safeObjectSize = vi.fn((_bucket: string, _key: string) => Promise.resolve(undefined as number | undefined));

  function withSafeCsvDeps(overrides: Record<string, unknown> = {}) {
    return { getObjectBuffer: getObjectBufferMock, getObjectSize: safeObjectSize, getObjectText: getObjectTextMock, ...overrides };
  }

  it('imports quoted csv rows using default transaction service', async () => {
    const em = { findOne: vi.fn((entity) => (entity.name === 'Account' ? Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } }) : Promise.resolve(null))), flush: vi.fn() };
    createTransactionMock.mockResolvedValue({ nordigenInternalTransactionId: undefined });
    const svc = new AccountCsvImportService();
    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue('date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,-10,3,"Shop, Inc.",Desc,int-1,4') }))).resolves.toMatchObject({ failed: 0, imported: 1, skipped: 0 });
    expect(createTransactionMock).toHaveBeenCalledWith(expect.objectContaining({ nordigenInternalTransactionId: 'int-1' }));
  });

  it('marks invalid rows as failed and duplicates as skipped', async () => {
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => (entity.name === 'Account' ? Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } }) : entity.name === 'Transaction' && criteria ? Promise.resolve({ transactionKey: 1 }) : Promise.resolve(null))), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    const svc = new AccountCsvImportService();
    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue('date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,,,,,,\n2025-01-01,-10,3,M,Desc,int-1,4') }))).resolves.toMatchObject({ failed: 1, skipped: 1, skippedRows: [{ reason: 'Duplicate internalTransactionId', row: 3 }] });
  });

  it('skips duplicate imports when the same csv is imported twice', async () => {
    const transactionLookups = vi.fn().mockReturnValueOnce(0).mockReturnValue(1);
    const em = { findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(transactionLookups() === 0 ? null : { transactionKey: 1 });
      return Promise.resolve(null);
    }), flush: vi.fn() };
    createTransactionMock.mockResolvedValue({ nordigenInternalTransactionId: 'int-1' });
    const svc = new AccountCsvImportService();
    const input = { accountKey: 1, bucket: 'b', key: 'k' };
    const getObjectText = vi.fn().mockResolvedValue('date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,-10,3,M,Desc,int-1,4');

    await expect(svc.importAccountCsv(input, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText }))).resolves.toMatchObject({ imported: 1, skipped: 0 });
    await expect(svc.importAccountCsv(input, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText }))).resolves.toMatchObject({ imported: 0, skipped: 1, skippedRows: [{ reason: 'Duplicate internalTransactionId', row: 2 }] });
    expect(createTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('skips soft-deleted generic duplicates without creating a transaction', async () => {
    const transactionCriteria: Record<string, unknown>[] = [];
    const findOne = vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'Transaction') {
        transactionCriteria.push(criteria);
        return Promise.resolve({ deletedAt: new Date(), transactionKey: 1 });
      }
      return Promise.resolve(null);
    });
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: { findOne } as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue('date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,-10,3,M,Desc,int-soft-deleted,4') }))).resolves.toMatchObject({ imported: 0, skipped: 1, skippedRows: [{ reason: 'Duplicate internalTransactionId', row: 2 }] });
    expect(transactionCriteria).toEqual([{ accountKey: expect.objectContaining({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } }), nordigenInternalTransactionId: 'int-soft-deleted' }]);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('skips soft-deleted bank duplicates without creating a transaction', async () => {
    const transactionCriteria: Record<string, unknown>[] = [];
    const findOne = vi.fn((entity: { name: string }, criteria: Record<string, unknown>) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'Transaction') {
        transactionCriteria.push(criteria);
        return Promise.resolve({ deletedAt: new Date(), transactionKey: 1 });
      }
      if (entity.name === 'TransactionType') return Promise.resolve({ transactionTypeKey: 4 });
      if (entity.name === 'Currency') return Promise.resolve({ currencyKey: 3 });
      return Promise.resolve(null);
    });
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-soft-deleted', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    const svc = new AccountCsvImportService();
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne, flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }))).resolves.toMatchObject({ imported: 0, skipped: 1, skippedRows: [{ reason: 'Duplicate internalTransactionId', row: 1 }] });
    expect(transactionCriteria).toEqual([expect.objectContaining({ $or: [{ internalTransactionId: 'bank-soft-deleted' }, { nordigenInternalTransactionId: 'bank-soft-deleted' }], accountKey: expect.objectContaining({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, balance: 0, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } }) })]);
    expect(transactionCriteria[0]).not.toHaveProperty('deletedAt');
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('parses supported bank CSV files when bankName is provided', async () => {
    const transactionalMock = vi.fn(async (fn: (em: ImportEm) => Promise<void>) => fn(em as unknown as ImportEm));
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }), transactional: transactionalMock };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    balancePlanMock.mockReturnValue({ accountAppuserBalance: 10, accountBalance: 10, items: [{ balance: 10, imported: true, transaction: { balance: 10 } }] });
    categorizeMock.mockResolvedValue(true);
    const svc = new AccountCsvImportService();

    const binaryCsv = Buffer.from('raw,csv');

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(binaryCsv), getObjectText: vi.fn().mockResolvedValue('raw,csv') }))).resolves.toMatchObject({ failed: 0, imported: 1, skipped: 0, skippedRows: [] });

    expect(parseExcelMock).toHaveBeenCalledWith(binaryCsv);
    expect(getBankParserMock).toHaveBeenCalledWith('bcp');
    expect(createTransactionMock).not.toHaveBeenCalled();
    expect(em.create).not.toHaveBeenCalled();
    expect(transactionalMock).toHaveBeenCalledTimes(1);
    expect(balancePlanMock).toHaveBeenCalled();
    const [, , importedTransactions] = balancePlanMock.mock.calls[0] ?? [];
    expect(importedTransactions).toHaveLength(1);
    expect(importedTransactions[0]).toEqual(expect.objectContaining({
      appuserCurrencyKey: { currencyKey: 2 },
      appuserKey: { appuserKey: 9 },
      internalTransactionId: 'bank-int-1',
      nordigenInternalTransactionId: 'bank-int-1',
      settlementAmount: -10.5,
      tenantKey: { tenantKey: 1 },
      transactionMerchantKey: expect.objectContaining({ name: 'Shop' }),
      transactionStatusKey: expect.objectContaining({ name: 'BOOKED' }),
    }));
    expect(categorizeMock).toHaveBeenCalledWith(em as unknown as ImportEm, expect.anything(), expect.anything());
    expect(recurringDetectionMock).toHaveBeenCalledWith(1, 'transaction-import');
  });

  it('falls back to direct execution when transactional is unavailable', async () => {
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    balancePlanMock.mockReturnValue({ accountBalance: 10, items: [{ balance: 10, imported: true, transaction: { balance: 10 } }] });
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));

    expect(recurringDetectionMock).toHaveBeenCalledWith(1, 'transaction-import');
  });

  it('does not trigger recurring detection when all bank rows are skipped', async () => {
    const transactionalMock = vi.fn(async (fn: (em: ImportEm) => Promise<void>) => fn(em as unknown as ImportEm));
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve({ transactionKey: 1 });
      return Promise.resolve(null);
    }), persist: vi.fn(function () { return em; }), transactional: transactionalMock };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }))).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(recurringDetectionMock).not.toHaveBeenCalled();
    expect(transactionalMock).toHaveBeenCalledTimes(1);
  });

  it('skips bank duplicates when only internalTransactionId matches', async () => {
    const findOne = vi.fn((entity: { name: string }) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'Transaction') return Promise.resolve({ internalTransactionId: 'bank-int-1', nordigenInternalTransactionId: undefined, transactionKey: 1 });
      if (entity.name === 'TransactionType') return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency') return Promise.resolve({ currencyKey: 3 });
      return Promise.resolve(null);
    });
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    const svc = new AccountCsvImportService();
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne, flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }))).resolves.toMatchObject({ imported: 0, skipped: 1, skippedRows: [{ reason: 'Duplicate internalTransactionId', row: 1 }] });
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('categorizes imported rows only when plan includes existing rows', async () => {
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9, currencyKey: { currencyKey: 2 } }, currencyKey: { currencyKey: 2 } });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    balancePlanMock.mockReturnValue({ accountBalance: 10, items: [{ balance: 10, imported: true, transaction: { balance: 10 } }, { balance: 20, imported: false, transaction: { balance: 20 } }] });
    categorizeMock.mockResolvedValue(true);
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));

    expect(categorizeMock).toHaveBeenCalledTimes(1);
  });

  it('uses exchange rates for appuser settlement when currencies differ', async () => {
    const exchangeRate = { rate: 1.1 };
    const account = { accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 5 } }, currencyKey: { code: 'EUR', currencyKey: 2 } } as { accountKey: number; accountOwnerAppuserKey: { appuserKey: number; currencyKey: { code: string; currencyKey: number } }; appuserCurrencyBalance?: number; currencyKey: { code: string; currencyKey: number } };
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve(account);
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria?.code === 'USD') return Promise.resolve({ code: 'USD', currencyKey: 5 });
      if (entity.name === 'Currency' && criteria?.code === 'EUR') return Promise.resolve({ code: 'EUR', currencyKey: 3 });
      if (entity.name === 'ExchangeRate') return Promise.resolve(exchangeRate);
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ internalTransactionId: 'bank-int-1', originalAmount: '10.00', originalCurrency: 'USD', settlementAmount: '-10.00', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    balancePlanMock.mockReturnValue({ accountAppuserBalance: 10, accountBalance: 10, items: [{ balance: 10, imported: true, transaction: { balance: 10 } }] });
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));

    expect(em.create).not.toHaveBeenCalled();
    expect(account.appuserCurrencyBalance).toBe(10);
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { accountKey: 1, deletedAt: undefined }, { populate: ['accountOwnerAppuserKey.currencyKey', 'currencyKey'] });
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ date: { $lte: new Date('2025-01-01') }, fromCurrency: { code: 'EUR', currencyKey: 3 }, toCurrency: { code: 'USD', currencyKey: 5 } }), expect.objectContaining({ orderBy: { date: 'DESC', toCurrency: 'ASC' } }));
  });

  it('reselects an existing merchant after insert-ignore on conflict', async () => {
    const merchant = { name: 'Shop' };
    const onConflictIgnore = vi.fn().mockResolvedValue(undefined);
    const into = vi.fn().mockReturnValue({ onConflict: vi.fn().mockReturnValue({ ignore: onConflictIgnore }) });
    let merchantLookups = 0;
    const findOne = vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 }, tenantKey: { tenantKey: 1 } });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant') return merchantLookups++ === 0 ? Promise.resolve(null) : Promise.resolve(merchant);
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne, flush: vi.fn().mockResolvedValue(undefined), getKnex: vi.fn(() => ({ insert: vi.fn().mockReturnValue({ into }) })), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }))).resolves.toMatchObject({ imported: 1 });
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { name: 'Shop' });
    expect(onConflictIgnore).toHaveBeenCalled();
  });

  it('falls back to oldest exchange rate and signed settlement amount when no historical rate exists', async () => {
    const account = { accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 5 } }, currencyKey: { code: 'EUR', currencyKey: 2 } } as { accountKey: number; accountOwnerAppuserKey: { appuserKey: number; currencyKey: { code: string; currencyKey: number } }; appuserCurrencyBalance?: number; currencyKey: { code: string; currencyKey: number } };
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve(account);
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ name: 'CARD_PAYMENT', transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria?.code === 'USD') return Promise.resolve({ code: 'USD', currencyKey: 5 });
      if (entity.name === 'Currency' && criteria?.code === 'EUR') return Promise.resolve({ code: 'EUR', currencyKey: 3 });
      if (entity.name === 'ExchangeRate' && criteria?.date) return Promise.resolve(null);
      if (entity.name === 'ExchangeRate') return Promise.resolve({ rate: 1.25 });
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ internalTransactionId: 'bank-int-1', originalAmount: '10.00', originalCurrency: 'USD', settlementAmount: '-10.00', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    balancePlanMock.mockReturnValue({ accountAppuserBalance: 10, accountBalance: 10, items: [{ balance: 10, imported: true, transaction: { balance: 10 } }] });
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));

    expect(em.create).not.toHaveBeenCalled();
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ fromCurrency: { code: 'EUR', currencyKey: 3 }, toCurrency: { code: 'USD', currencyKey: 5 } }), expect.objectContaining({ orderBy: { date: 'ASC', toCurrency: 'ASC' } }));
  });

  it('allows extra fields from bank parsers', async () => {
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ balance: '100.00', descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', originalAmount: '10.50', originalCurrency: 'USD', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionStatus: 'SETTLED', transactionType: 'CARD_PAYMENT' }]);
    createTransactionMock.mockResolvedValue({ transactionKey: 99 });
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('uses the default S3 buffer reader for bank imports when deps omit getObjectBuffer', async () => {
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve({ name: 'Shop' });
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: '-10.50', settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    createTransactionMock.mockResolvedValue({ transactionKey: 99 });
    const svc = new AccountCsvImportService();
    const csvBuffer = Buffer.from([0xff, 0x00, 0x61]);

    s3GetObjectBufferMock.mockResolvedValueOnce(csvBuffer);

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, { em: em as unknown as ImportEm, getObjectSize: vi.fn().mockResolvedValue(undefined) });

    expect(parseExcelMock).toHaveBeenCalledWith(csvBuffer);
    expect(s3GetObjectBufferMock).toHaveBeenCalledWith('b', 'k');
  });

  it('accepts Big-like settlement amounts from bank parsers', async () => {
    const em = { create: vi.fn((_: unknown, value: unknown) => value), find: vi.fn().mockResolvedValue([]), findOne: vi.fn((entity, criteria) => {
      if (entity.name === 'Account') return Promise.resolve({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } });
      if (entity.name === 'Transaction' && criteria) return Promise.resolve(null);
      if (entity.name === 'TransactionType' && criteria) return Promise.resolve({ transactionTypeKey: 4 });
      if (entity.name === 'Currency' && criteria) return Promise.resolve({ currencyKey: 3 });
      if (entity.name === 'TransactionStatus' && criteria) return Promise.resolve({ name: 'BOOKED', transactionStatusKey: 1 });
      if (entity.name === 'TransactionMerchant' && criteria) return Promise.resolve(null);
      return Promise.resolve(null);
    }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'Raw description', internalTransactionId: 'bank-int-1', settlementAmount: { toString: () => '-10.50' }, settlementCurrency: 'EUR', transactionDate: new Date('2025-01-01'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    createTransactionMock.mockResolvedValue({ transactionKey: 99 });
    const svc = new AccountCsvImportService();

    await svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }));
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects partial garbage ids', async () => {
    const em = { create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }) };
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue('date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,-10,3,M,Desc,int-1,4abc') }))).resolves.toMatchObject({ failed: 1, imported: 0, skipped: 0 });
  });

  it('rejects oversized account csv objects before download', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectSize: vi.fn().mockResolvedValue(5 * 1024 * 1024 + 1), getObjectText: vi.fn() }))).rejects.toThrow('CSV object exceeds max size');
  });

  it('rejects oversized bank csv objects before download', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn(), getObjectSize: vi.fn().mockResolvedValue(5 * 1024 * 1024 + 1) }))).rejects.toThrow('CSV object exceeds max size');
  });

  it('rejects oversized bank csv buffers after download', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.alloc(5 * 1024 * 1024 + 1)), getObjectSize: vi.fn().mockResolvedValue(5 * 1024 * 1024) }))).rejects.toThrow('CSV object exceeds max size');
  });

  it('rejects oversized account csv row counts before parsing', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();
    const csvText = `date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n${Array.from({ length: 10_001 }, (_, index) => `2025-01-01,-10,3,M,Desc,int-${index},4`).join('\n')}`;

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue(csvText) }))).rejects.toThrow('CSV exceeds max row count');
  });

  it('rejects malformed rows without importing them', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue(`date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\nnot-a-date,Infinity,-1,${'x'.repeat(300)},Desc,int-1,0`) }))).resolves.toMatchObject({ failed: 1, imported: 0, skipped: 0 });
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects malformed bank rows without importing them', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    parseExcelMock.mockResolvedValueOnce([['raw-bank-row']]);
    getBankParserMock.mockReturnValueOnce(() => [{ descriptionDirty: 'x'.repeat(600), internalTransactionId: 'bank-int-1', settlementAmount: Number.POSITIVE_INFINITY, settlementCurrency: 'EUR', transactionDate: new Date('invalid'), transactionMerchant: 'Shop', transactionType: 'CARD_PAYMENT' }]);
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bankName: 'bcp', bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectBuffer: vi.fn().mockResolvedValue(Buffer.from('raw,csv')) }))).resolves.toMatchObject({ failed: 1, imported: 0, skipped: 0 });
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects oversized account csv field lengths before parsing', async () => {
    const em = { findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();
    const csvText = `date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey\n2025-01-01,-10,3,${'M'.repeat(1001)},Desc,int-1,4`;

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue(csvText) }))).rejects.toThrow('CSV field exceeds max length');
  });

  it('rejects oversized account csv column counts before parsing', async () => {
    const em = { findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const svc = new AccountCsvImportService();
    const header = Array.from({ length: 101 }, (_, index) => `c${index}`).join(',');

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectText: vi.fn().mockResolvedValue(`${header}\n1`) }))).rejects.toThrow('CSV exceeds max column count');
  });

  it('does not download oversized account objects after headobject rejection', async () => {
    const em = { findOne: vi.fn().mockResolvedValueOnce({ accountKey: 1, accountOwnerAppuserKey: { appuserKey: 9 }, currencyKey: { currencyKey: 2 } }), flush: vi.fn() };
    const getObjectText = vi.fn();
    const svc = new AccountCsvImportService();

    await expect(svc.importAccountCsv({ accountKey: 1, bucket: 'b', key: 'k' }, withSafeCsvDeps({ em: em as unknown as ImportEm, getObjectSize: vi.fn().mockResolvedValue(5 * 1024 * 1024 + 1), getObjectText }))).rejects.toThrow('CSV object exceeds max size');
    expect(getObjectText).not.toHaveBeenCalled();
  });
});
