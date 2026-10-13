import { TransactionPropagation, UniqueConstraintViolationException } from '@mikro-orm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';

const assetPriceServiceMock = vi.hoisted(() => ({ ensureRecentAssetPrice: vi.fn() }));
const historicalBackfillClientMock = vi.hoisted(() => ({ trigger: vi.fn() }));
const portfolioSnapshotServiceMock = vi.hoisted(() => ({ backfillSnapshotsForPortfolio: vi.fn() }));
const resolveOrCreateFinancialAssetMock = vi.hoisted(() => vi.fn());
const syncStockSplitsForAssetMock = vi.hoisted(() => vi.fn());

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('../asset-price.service', () => ({ default: assetPriceServiceMock }));
vi.mock('../historical-asset-price-backfill-client', () => ({
  default: historicalBackfillClientMock,
  toYmd: (date: Date) => date.toISOString().slice(0, 10),
}));
vi.mock('../financial-asset.service', () => ({ resolveOrCreateFinancialAsset: resolveOrCreateFinancialAssetMock }));
vi.mock('../portfolio-snapshot.service', () => ({ default: portfolioSnapshotServiceMock }));
vi.mock('../stock-split-sync.service', () => ({ syncStockSplitsForAsset: syncStockSplitsForAssetMock }));

import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { CertificadoAforroSubscriptionDetail } from '@entity/CertificadoAforroSubscriptionDetail';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { BadRequestError, ConflictError } from '@utils/errors';

import portfolioTransactionService from '../portfolio-transaction.service';

interface TimelineTransaction {
  deletedAt?: Date | null;
  financialAssetKey?: FinancialAsset;
  financialTransactionTypeKey?: FinancialTransactionType;
  portfolioKey?: Portfolio;
  quantity: number;
  settlementAmount?: number;
  settlementCurrencyKey?: Currency;
  settlementUnitAmount?: number;
  transactionDate?: Date;
  transactionKey: number;
}

describe('portfolio transaction service', () => {
  const currency = { code: 'EUR', currencyKey: 1 } as Currency;
  const appuser = { appuserKey: 1, currencyKey: currency } as Appuser;
  const portfolio = { portfolioKey: 11 } as Portfolio;
  const asset = { financialAssetKey: 7, symbol: 'AAPL' } as FinancialAsset;
  const savingsCertificateAsset = {
    financialAssetKey: 20,
    financialAssetTypeKey: { name: 'Savings Certificate' },
    symbol: 'CA-SERIE-F',
  } as FinancialAsset;
  // Static-valuation series (RAD-446): perpetual, legacy, no accrual/tax-exempt concept.
  const staticSavingsCertificateAsset = {
    financialAssetKey: 21,
    financialAssetTypeKey: { name: 'Savings Certificate' },
    symbol: 'CA-SERIE-A',
  } as FinancialAsset;
  const buyType = { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.BUY, name: 'BUY' } as FinancialTransactionType;
  type TransactionDeps = NonNullable<Parameters<typeof portfolioTransactionService.createPortfolioTransaction>[3]>;
  const backfillDeps: TransactionDeps = { enqueue: { send: vi.fn(), sendAfter: vi.fn() } };
  const sellType = { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.SELL, name: 'SELL' } as FinancialTransactionType;
  const dividendType = {
    financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.DIVIDEND,
    name: 'DIVIDEND',
  } as FinancialTransactionType;

  const createTransaction = (
    appuser: Appuser,
    params: Parameters<typeof portfolioTransactionService.createPortfolioTransaction>[1],
    entityManager?: Parameters<typeof portfolioTransactionService.createPortfolioTransaction>[2],
    deps: TransactionDeps = backfillDeps,
  ) => portfolioTransactionService.createPortfolioTransaction(appuser, params, entityManager, deps);

  const updateTransaction = (
    appuser: Appuser,
    portfolioId: number,
    transactionId: number,
    params: Parameters<typeof portfolioTransactionService.updatePortfolioTransaction>[3],
    deps: TransactionDeps = backfillDeps,
  ) => portfolioTransactionService.updatePortfolioTransaction(appuser, portfolioId, transactionId, params, deps);

  function transaction(overrides: Partial<TimelineTransaction>): TimelineTransaction {
    return {
      financialAssetKey: asset,
      financialTransactionTypeKey: buyType,
      portfolioKey: portfolio,
      quantity: 10,
      settlementAmount: 1000,
      settlementCurrencyKey: currency,
      settlementUnitAmount: 100,
      transactionDate: new Date('2026-01-01'),
      transactionKey: 1,
      ...overrides,
    };
  }

  function setupEntityManager(options: {
    findRows?: TimelineTransaction[];
    splitRows?: Partial<FinancialAssetStockAdjustment>[];
    transactionForUpdate?: TimelineTransaction;
    transactionType?: FinancialTransactionType;
  } = {}) {
    const flushMock = vi.fn().mockResolvedValue(undefined);
    const findMock = vi.fn().mockImplementation((entity, criteria) => {
      if (entity === FinancialAssetStockAdjustment) {
        const rows = (options.splitRows ?? []).filter((row) => {
          const date = row.date?.getTime() ?? 0;
          const from = criteria?.date?.$gte?.getTime?.();
          const to = criteria?.date?.$lte?.getTime?.();
          const assetKey = row.financialAssetKey?.financialAssetKey;
          const assetFilter = criteria?.financialAssetKey?.financialAssetKey?.$in;
          if (from && date && date < from) return false;
          if (to && date && date > to) return false;
          if (assetFilter && !assetFilter.includes(assetKey)) return false;
          return true;
        });
        return Promise.resolve(rows);
      }
      const rows = (options.findRows ?? []).filter((row) => {
        const date = row.transactionDate?.getTime() ?? 0;
        const from = criteria?.transactionDate?.$gte?.getTime?.();
        const to = criteria?.transactionDate?.$lte?.getTime?.();
        const ticker = criteria?.financialAssetKey?.symbol;
        const portfolioFilter = criteria?.portfolioKey?.portfolioKey;
        const typeFilter = criteria?.financialTransactionTypeKey?.financialTransactionTypeKey?.$in;
        if (from && date && date < from) return false;
        if (to && date && date > to) return false;
        if (ticker && row.financialAssetKey?.symbol !== ticker) return false;
        if (portfolioFilter && row.portfolioKey?.portfolioKey !== portfolioFilter) return false;
        if (typeFilter && !typeFilter.includes(row.financialTransactionTypeKey?.financialTransactionTypeKey)) return false;
        return true;
      });
      return Promise.resolve(rows);
    });
    const persistMock = vi.fn();
    const createMock = vi.fn();
    const populateMock = vi.fn().mockResolvedValue(undefined);
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const getTransactionContextMock = vi.fn();
    const transactionalMock = vi.fn(async (callback: (entityManager: typeof DI.em) => Promise<void>) => callback(DI.em));
    const transactionType = options.transactionType ?? buyType;

    Object.assign(DI.em, {
      create: createMock,
      find: findMock,
      findOne: vi.fn().mockImplementation((entity) => {
        if (entity === AppuserTenant) return { tenantKey: 1 };
        if (entity === Portfolio) return portfolio;
        if (entity === FinancialTransaction) return options.transactionForUpdate ?? null;
        if (entity === FinancialTransactionType) return transactionType;
        if (entity === Currency) return currency;
        return null;
      }),
      flush: flushMock,
      getConnection: () => ({ execute: executeMock }),
      getTransactionContext: getTransactionContextMock,
      persist: persistMock,
      populate: populateMock,
      transactional: transactionalMock,
    });

    return { createMock, executeMock, findMock, flushMock, persistMock, populateMock, transactionalMock };
  }

  beforeEach(() => {
    resolveOrCreateFinancialAssetMock.mockResolvedValue(asset);
    syncStockSplitsForAssetMock.mockResolvedValue({ inserted: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a BUY transaction', async () => {
    const { flushMock } = setupEntityManager();

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    }, undefined, backfillDeps);

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            financialAssetId: asset.financialAssetKey,
            symbol: asset.symbol,
            transactionDate: '2026-05-20',
          }),
        ],
        portfolioId: portfolio.portfolioKey,
      }),
      { enqueue: backfillDeps.enqueue },
    );
  });

  it('requires enqueue before persisting a maintenance-enabled transaction', async () => {
    const { persistMock } = setupEntityManager();

    await expect(portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    })).rejects.toThrow('Enqueue capability is required for portfolio transaction maintenance');

    expect(persistMock).not.toHaveBeenCalled();
  });

  it('generates a random manual internalTransactionId with no undefined component, unique across identical inputs', async () => {
    const { persistMock: firstPersist } = setupEntityManager();
    const identicalInputs = {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    };
    await createTransaction(appuser, identicalInputs);
    const firstId = (firstPersist.mock.calls[0]?.[0] as FinancialTransaction).internalTransactionId;

    const { persistMock: secondPersist } = setupEntityManager();
    // Two different tenants entering the same symbol/amount/timestamp used to collide on a
    // DB-global unique constraint (RAD-603) because the key had no tenant/portfolio component.
    await createTransaction(appuser, identicalInputs);
    const secondId = (secondPersist.mock.calls[0]?.[0] as FinancialTransaction).internalTransactionId;

    expect(firstId).not.toContain('undefined');
    expect(secondId).not.toContain('undefined');
    expect(firstId).not.toBe(secondId);
  });

  it('maps a unique-constraint violation on create to a 409 Conflict instead of an unhandled 500', async () => {
    const { transactionalMock } = setupEntityManager();
    transactionalMock.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('duplicate key')));

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not fail the request when post-commit price/snapshot maintenance throws', async () => {
    const { flushMock } = setupEntityManager();
    assetPriceServiceMock.ensureRecentAssetPrice.mockRejectedValueOnce(new Error('provider unavailable'));

    // The transaction itself already committed by this point (RAD-603) — a maintenance
    // hiccup must not report the write as failed and invite a retry that then hits the
    // unique constraint on a transaction that was never actually missing.
    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalled();
  });

  it('creates a paired CertificadoAforroSubscriptionDetail row for a Savings Certificate BUY with taxExempt', async () => {
    const { flushMock, persistMock, populateMock } = setupEntityManager();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(savingsCertificateAsset);

    await portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: 'CA-SERIE-F',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      // A CA subscription is `quantity` = principal in euros at `unitPrice` = 1 (1 unit = EUR 1,
      // IGCP's own convention). These two fields are NOT interchangeable here — the accrual engine
      // reads the principal off the quantity — so the endpoint rejects any other unitPrice.
      quantity: 5000,
      settlementCurrencyId: currency.currencyKey,
      taxExempt: true,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 1,
    }, undefined, backfillDeps);

    expect(populateMock).toHaveBeenCalledWith(savingsCertificateAsset, ['financialAssetTypeKey']);
    expect(flushMock).toHaveBeenCalled();
    expect(persistMock).toHaveBeenCalledWith(expect.any(FinancialTransaction));
    const persistedEntities: unknown[] = persistMock.mock.calls.map(([entity]) => entity as unknown);
    const persistedDetail = persistedEntities.find(
      (entity): entity is CertificadoAforroSubscriptionDetail => entity instanceof CertificadoAforroSubscriptionDetail,
    );
    expect(persistedDetail).toBeDefined();
    expect(persistedDetail?.taxExempt).toBe(true);
    expect(persistedDetail?.transactionKey).toBeInstanceOf(FinancialTransaction);
  });

  it('does not write a CertificadoAforroSubscriptionDetail row for a static-mode series (CA-SERIE-A) BUY with taxExempt: true', async () => {
    const { flushMock, persistMock, populateMock } = setupEntityManager();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(staticSavingsCertificateAsset);

    await createTransaction(appuser, {
      assetSymbol: 'CA-SERIE-A',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 5000,
      settlementCurrencyId: currency.currencyKey,
      // Séries A/B are static-valuation and have no accrual/tax-exempt concept. Per the
      // established "field doesn't apply here" pattern, taxExempt must be silently ignored —
      // no error, no detail row — exactly like it already is for non-Savings-Certificate assets.
      taxExempt: true,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 1,
    });

    expect(populateMock).toHaveBeenCalledWith(staticSavingsCertificateAsset, ['financialAssetTypeKey']);
    expect(flushMock).toHaveBeenCalled();
    expect(persistMock).toHaveBeenCalledWith(expect.any(FinancialTransaction));
    expect(persistMock.mock.calls.some(([entity]) => entity instanceof CertificadoAforroSubscriptionDetail)).toBe(false);
  });

  it('rejects a Savings Certificate transaction whose unitPrice is not exactly 1', async () => {
    const { persistMock } = setupEntityManager();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(savingsCertificateAsset);

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'CA-SERIE-F',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        // The plausible-but-wrong shaping a client would reach for: 1 "certificate" at EUR 5,000.
        // Accepted, this would book a EUR 5,000 settlement while the accrual engine valued a EUR 1
        // principal — wrong in two directions at once, and invisible in the response.
        quantity: 1,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 5000,
      }),
    ).rejects.toThrow(BadRequestError);

    expect(persistMock).not.toHaveBeenCalled();
  });

  it('does not reject a non-Savings-Certificate transaction for having a unitPrice other than 1', async () => {
    const { flushMock } = setupEntityManager();

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    });

    expect(flushMock).toHaveBeenCalled();
  });

  it('does not write a CertificadoAforroSubscriptionDetail row or error for a regular stock BUY with taxExempt omitted', async () => {
    const { flushMock, persistMock } = setupEntityManager();

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalled();
    expect(persistMock.mock.calls.some(([entity]) => entity instanceof CertificadoAforroSubscriptionDetail)).toBe(false);
  });

  it('ignores an explicit taxExempt: false for a regular stock BUY without erroring or writing a detail row', async () => {
    const { flushMock, persistMock } = setupEntityManager();

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        taxExempt: false,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalled();
    expect(persistMock.mock.calls.some(([entity]) => entity instanceof CertificadoAforroSubscriptionDetail)).toBe(false);
  });

  it('skips stock-split sync for a Savings Certificate BUY but still runs it for a regular stock BUY', async () => {
    setupEntityManager();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(savingsCertificateAsset);

    await createTransaction(appuser, {
      assetSymbol: 'CA-SERIE-F',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      // A CA subscription is `quantity` = principal in euros at `unitPrice` = 1 (1 unit = EUR 1,
      // IGCP's own convention). These two fields are NOT interchangeable here — the accrual engine
      // reads the principal off the quantity — so the endpoint rejects any other unitPrice.
      quantity: 5000,
      settlementCurrencyId: currency.currencyKey,
      taxExempt: true,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 1,
    });

    expect(syncStockSplitsForAssetMock).not.toHaveBeenCalled();

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    });

    expect(syncStockSplitsForAssetMock).toHaveBeenCalledWith(asset);
  });

  it.each([
    ['BUY', buyType],
    ['SELL', sellType],
  ])('uses an explicit entity manager and nested persistence for %s', async (_name, transactionType) => {
    setupEntityManager({ findRows: [transaction({ quantity: 5, transactionKey: 1 })], transactionType });
    const explicitEm = Object.create(DI.em) as typeof DI.em;
    explicitEm.findOne = DI.em.findOne.bind(DI.em);
    const transactional = vi.fn(async (callback: (entityManager: typeof DI.em) => Promise<void>) => callback(explicitEm));
    explicitEm.transactional = transactional as typeof explicitEm.transactional;
    const globalFindOne = vi.fn(() => { throw new Error('global entity manager used'); });
    DI.em.findOne = globalFindOne as typeof DI.em.findOne;

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialAsset: asset,
      financialTransactionTypeId: transactionType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: transactionType === sellType ? -4 : 2,
      settlementCurrencyId: currency.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    }, explicitEm);

    expect(globalFindOne).not.toHaveBeenCalled();
    expect(transactional).toHaveBeenCalledWith(expect.any(Function), { propagation: TransactionPropagation.NESTED });
  });

  it('skips price and snapshot maintenance when requested for bulk import finalization', async () => {
    const { flushMock } = setupEntityManager();

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    });

    expect(flushMock).toHaveBeenCalled();
    expect(assetPriceServiceMock.ensureRecentAssetPrice).not.toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).not.toHaveBeenCalled();
    expect(portfolioSnapshotServiceMock.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('continues creating a transaction when split sync fails', async () => {
    const { flushMock } = setupEntityManager();
    syncStockSplitsForAssetMock.mockRejectedValueOnce(new Error('split sync failed'));

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalled();
  });

  it('logs and swallows split sync failure after resolving a new asset', async () => {
    const { flushMock } = setupEntityManager();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(asset);
    syncStockSplitsForAssetMock.mockRejectedValueOnce(new Error('split sync failed'));

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: buyType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-05-20T12:34:56Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalled();
    expect(resolveOrCreateFinancialAssetMock).toHaveBeenCalledWith('AAPL', { skipStockSplitSync: true });
    expect(syncStockSplitsForAssetMock).toHaveBeenCalledWith(asset);
    expect(syncStockSplitsForAssetMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes snapshots from the created transaction date instead of the earliest portfolio transaction', async () => {
    setupEntityManager({
      findRows: [transaction({ transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 1 })],
    });

    const transactionDate = new Date('2026-05-20T12:34:56Z');

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate,
      unitPrice: 100,
    });

    expect(portfolioSnapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(
      portfolio.portfolioKey,
      transactionDate,
    );
  });

  it('replays snapshots from the earlier date when a BUY transaction is updated', async () => {
    const existingTransaction = transaction({ transactionDate: new Date('2026-05-18T00:00:00Z') });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await updateTransaction(appuser, portfolio.portfolioKey, 99, {
      transactionDate: new Date('2026-05-20T00:00:00Z'),
    }, backfillDeps);

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            financialAssetId: asset.financialAssetKey,
            symbol: asset.symbol,
            transactionDate: '2026-05-18',
          }),
        ],
        portfolioId: portfolio.portfolioKey,
      }),
      { enqueue: backfillDeps.enqueue },
    );
  });

  it('replays snapshots when a DIVIDEND transaction changes into BUY with the same date', async () => {
    const existingTransaction = transaction({
      financialTransactionTypeKey: dividendType,
      transactionDate: new Date('2026-05-18T00:00:00Z'),
    });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction, transactionType: buyType });

    await updateTransaction(appuser, portfolio.portfolioKey, 99, {
      financialTransactionTypeId: buyType.financialTransactionTypeKey,
    }, backfillDeps);

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            financialAssetId: asset.financialAssetKey,
            symbol: asset.symbol,
            transactionDate: '2026-05-18',
          }),
        ],
        portfolioId: portfolio.portfolioKey,
      }),
      { enqueue: backfillDeps.enqueue },
    );
  });

  it('replays snapshots for quantity-only BUY updates', async () => {
    const existingTransaction = transaction({ transactionDate: new Date('2026-05-18T00:00:00Z') });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await updateTransaction(appuser, portfolio.portfolioKey, 99, {
      quantity: 3,
    });

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).not.toHaveBeenCalled();
  });

  it('refreshes snapshots from the earlier changed transaction date instead of the earliest portfolio transaction', async () => {
    const originalDate = new Date('2026-05-20T00:00:00Z');
    const newDate = new Date('2026-05-18T00:00:00Z');
    const existingTransaction = transaction({ transactionDate: originalDate, transactionKey: 2 });
    setupEntityManager({
      findRows: [
        transaction({ transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 1 }),
        existingTransaction,
      ],
      transactionForUpdate: existingTransaction,
    });

    await updateTransaction(appuser, portfolio.portfolioKey, 2, {
      transactionDate: newDate,
    });

    expect(portfolioSnapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(portfolio.portfolioKey, newDate);
  });

  it('replays snapshots when BUY changes to DIVIDEND with date change', async () => {
    const existingTransaction = transaction({ transactionDate: new Date('2026-05-18T00:00:00Z') });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction, transactionType: dividendType });

    await updateTransaction(appuser, portfolio.portfolioKey, 99, {
      financialTransactionTypeId: dividendType.financialTransactionTypeKey,
      transactionDate: new Date('2026-05-20T00:00:00Z'),
    });

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).not.toHaveBeenCalled();
  });

  it('replays snapshots for DIVIDEND creation', async () => {
    const { flushMock } = setupEntityManager({ transactionType: dividendType });

    await createTransaction(appuser, {
      assetSymbol: 'AAPL',
      financialTransactionTypeId: dividendType.financialTransactionTypeKey,
      portfolioId: portfolio.portfolioKey,
      quantity: 2,
      settlementCurrencyId: currency.currencyKey,
      transactionDate: new Date('2026-05-20T12:34:56Z'),
      unitPrice: 100,
    });

    expect(flushMock).toHaveBeenCalled();
    expect(historicalBackfillClientMock.trigger).not.toHaveBeenCalled();
  });

  it('rejects creating a sell above the selected portfolio quantity', async () => {
    const { findMock, flushMock } = setupEntityManager({
      findRows: [transaction({ quantity: 5, transactionKey: 1 })],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -6,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-02'),
        unitPrice: 100,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');

    expect(findMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appuserKey: appuser,
        financialAssetKey: asset,
        portfolioKey: { portfolioKey: portfolio.portfolioKey },
      }),
      expect.anything(),
    );
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('allows creating a partial sell within the selected portfolio quantity', async () => {
    const { flushMock } = setupEntityManager({
      findRows: [transaction({ quantity: 5, transactionKey: 1 })],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -4,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-02'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it('allows creating a positive-quantity sell within the selected portfolio quantity', async () => {
    const { flushMock } = setupEntityManager({
      findRows: [transaction({ quantity: 5, transactionKey: 1 })],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: 4,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-02'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it('rejects creating a backdated sell before the portfolio owns the asset', async () => {
    setupEntityManager({
      findRows: [transaction({ quantity: 5, transactionDate: new Date('2026-01-03'), transactionKey: 1 })],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -1,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-02'),
        unitPrice: 100,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('rejects updating a sell above the selected portfolio quantity', async () => {
    const existingTransaction = transaction({
      financialTransactionTypeKey: sellType,
      quantity: -4,
      transactionDate: new Date('2026-01-02'),
      transactionKey: 2,
    });
    const { flushMock } = setupEntityManager({
      findRows: [
        transaction({ quantity: 5, transactionDate: new Date('2026-01-01'), transactionKey: 1 }),
        existingTransaction,
      ],
      transactionForUpdate: existingTransaction,
      transactionType: sellType,
    });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 2, {
        quantity: -6,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');

    expect(flushMock).not.toHaveBeenCalled();
  });

  it('rejects moving a buy after an existing sell that depends on it', async () => {
    const existingTransaction = transaction({
      quantity: 5,
      transactionDate: new Date('2026-01-01'),
      transactionKey: 1,
    });
    setupEntityManager({
      findRows: [
        existingTransaction,
        transaction({
          financialTransactionTypeKey: sellType,
          quantity: -4,
          transactionDate: new Date('2026-01-02'),
          transactionKey: 2,
        }),
      ],
      transactionForUpdate: existingTransaction,
    });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 1, {
        transactionDate: new Date('2026-01-03'),
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('recalculates settlement amount when changing transaction type normalizes quantity', async () => {
    const existingTransaction = transaction({
      quantity: 5,
      settlementAmount: 500,
      settlementUnitAmount: 100,
      transactionDate: new Date('2026-01-02'),
      transactionKey: 2,
    });
    setupEntityManager({
      findRows: [
        transaction({ quantity: 10, transactionDate: new Date('2026-01-01'), transactionKey: 1 }),
        existingTransaction,
      ],
      transactionForUpdate: existingTransaction,
      transactionType: sellType,
    });

    await updateTransaction(appuser, portfolio.portfolioKey, 2, {
      financialTransactionTypeId: sellType.financialTransactionTypeKey,
    });

    expect(existingTransaction.quantity).toBe(-5);
    expect(existingTransaction.settlementAmount).toBe(-500);
  });

  it('rejects updating a Savings Certificate transaction to a unitPrice other than 1', async () => {
    const existingTransaction = transaction({
      financialAssetKey: savingsCertificateAsset,
      quantity: 5000,
      settlementAmount: 5000,
      settlementUnitAmount: 1,
      transactionDate: new Date('2026-05-20T00:00:00Z'),
      transactionKey: 3,
    });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 3, {
        // The same plausible-but-wrong reshaping the create-side guard rejects: 1 "certificate" at
        // EUR 5,000, applied via an update to a previously-valid Savings Certificate transaction.
        quantity: 1,
        unitPrice: 5000,
      }),
    ).rejects.toThrow(BadRequestError);

    expect(flushMock).not.toHaveBeenCalled();
    // settlementUnitAmount/settlementAmount must not have been mutated before the rejection.
    expect(existingTransaction.settlementUnitAmount).toBe(1);
    expect(existingTransaction.settlementAmount).toBe(5000);
  });

  it('allows updating a Savings Certificate transaction with unitPrice 1', async () => {
    const existingTransaction = transaction({
      financialAssetKey: savingsCertificateAsset,
      quantity: 5000,
      settlementAmount: 5000,
      settlementUnitAmount: 1,
      transactionDate: new Date('2026-05-20T00:00:00Z'),
      transactionKey: 3,
    });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await updateTransaction(appuser, portfolio.portfolioKey, 3, {
      quantity: 6000,
      unitPrice: 1,
    });

    expect(flushMock).toHaveBeenCalled();
    expect(existingTransaction.quantity).toBe(6000);
    expect(existingTransaction.settlementAmount).toBe(6000);
  });

  it('allows updating a Savings Certificate transaction without touching unitPrice', async () => {
    const existingTransaction = transaction({
      financialAssetKey: savingsCertificateAsset,
      quantity: 5000,
      settlementAmount: 5000,
      settlementUnitAmount: 1,
      transactionDate: new Date('2026-05-20T00:00:00Z'),
      transactionKey: 3,
    });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await updateTransaction(appuser, portfolio.portfolioKey, 3, {
      notes: 'updated notes',
    });

    expect(flushMock).toHaveBeenCalled();
    expect(existingTransaction.settlementUnitAmount).toBe(1);
  });

  it('does not reject updating a regular stock transaction unitPrice to any value', async () => {
    const existingTransaction = transaction({
      transactionDate: new Date('2026-05-20T00:00:00Z'),
      transactionKey: 4,
    });
    const { flushMock } = setupEntityManager({ transactionForUpdate: existingTransaction });

    await updateTransaction(appuser, portfolio.portfolioKey, 4, {
      unitPrice: 250,
    });

    expect(flushMock).toHaveBeenCalled();
    expect(existingTransaction.settlementUnitAmount).toBe(250);
  });

  it('ignores dividend transactions when validating quantity', async () => {
    setupEntityManager({
      findRows: [
        transaction({
          financialTransactionTypeKey: dividendType,
          quantity: 100,
          transactionDate: new Date('2026-01-01'),
          transactionKey: 1,
        }),
        transaction({ quantity: 5, transactionDate: new Date('2026-01-02'), transactionKey: 2 }),
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -6,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-03'),
        unitPrice: 100,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('returns real transactions plus a split row for a held asset', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    const buy = transaction({ financialAssetKey: heldAsset, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 });

    setupEntityManager({ findRows: [buy], splitRows: [split] });

    const rows = await portfolioTransactionService.getPortfolioTransactions(appuser, portfolio.portfolioKey);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      denominator: 1,
      editable: false,
      financialAssetKey: { financialAssetKey: 7 },
      id: 'stock-split:1:11:7',
      itemType: 'STOCK_SPLIT',
      numerator: 2,
      portfolioKey: { portfolioKey: portfolio.portfolioKey },
      splitRatio: 2,
      transactionDate: split.date,
    });
    expect(rows[1]).toMatchObject({ transactionKey: 10 });
  });

  it('applies limit after merging real transactions and split rows', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    const buy = transaction({ financialAssetKey: heldAsset, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 });

    setupEntityManager({ findRows: [buy], splitRows: [split] });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(
      appuser,
      portfolio.portfolioKey,
      undefined,
      undefined,
      1,
    )) as { itemType?: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemType: 'STOCK_SPLIT' });
  });

  it('keeps real transaction row shape unchanged', async () => {
    setupEntityManager({ findRows: [transaction({ transactionKey: 10 })] });

    const rows = await portfolioTransactionService.getPortfolioTransactions(appuser, portfolio.portfolioKey);

    expect(rows[0]).toMatchObject({
      financialAssetKey: { financialAssetKey: 7, symbol: 'AAPL' },
      financialTransactionTypeKey: { name: 'BUY' },
      portfolioKey: { portfolioKey: 11 },
      settlementCurrencyKey: { code: 'EUR' },
      transactionKey: 10,
    });
    expect((rows[0] as { itemType?: string }).itemType).toBeUndefined();
  });

  it('returns a split row even when no real transactions are in the date range', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    const buy = transaction({ financialAssetKey: heldAsset, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 });
    setupEntityManager({ findRows: [buy], splitRows: [split] });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(
      appuser,
      portfolio.portfolioKey,
      new Date('2026-01-02T00:00:00Z'),
      new Date('2026-01-04T00:00:00Z'),
    )) as { id: string; itemType: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'stock-split:1:11:7', itemType: 'STOCK_SPLIT' });
  });

  it('does not emit a split row after the position was fully sold before the split', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [
        transaction({ financialAssetKey: heldAsset, quantity: 10, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 }),
        transaction({ financialAssetKey: heldAsset, financialTransactionTypeKey: sellType, quantity: -10, transactionDate: new Date('2026-01-02T00:00:00Z'), transactionKey: 11 }),
      ],
      splitRows: [split],
    });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(appuser, portfolio.portfolioKey)) as { itemType?: string }[];

    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT')).toBe(false);
  });

  it('does not emit a later split when a prior split-adjusted sell closes the position', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const reverseSplit = { date: new Date('2026-01-02T00:00:00Z'), denominator: 10, financialAssetKey: heldAsset, financialAssetStockAdjustmentKey: 1, numerator: 1, splitRatio: 0.1 } as FinancialAssetStockAdjustment;
    const laterSplit = { date: new Date('2026-01-04T00:00:00Z'), denominator: 1, financialAssetKey: heldAsset, financialAssetStockAdjustmentKey: 2, numerator: 2, splitRatio: 2 } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [
        transaction({ financialAssetKey: heldAsset, quantity: 100, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 }),
        transaction({ financialAssetKey: heldAsset, financialTransactionTypeKey: sellType, quantity: -10, transactionDate: new Date('2026-01-03T00:00:00Z'), transactionKey: 11 }),
      ],
      splitRows: [reverseSplit, laterSplit],
    });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(
      appuser,
      portfolio.portfolioKey,
      new Date('2026-01-04T00:00:00Z'),
      new Date('2026-01-04T00:00:00Z'),
    )) as { itemType?: string }[];

    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT')).toBe(false);
  });

  it('emits a split row when same-day sell closes the position after the split', async () => {
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [
        transaction({ financialAssetKey: heldAsset, quantity: 10, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 }),
        transaction({ financialAssetKey: heldAsset, financialTransactionTypeKey: sellType, quantity: -20, transactionDate: new Date('2026-01-03T00:00:00Z'), transactionKey: 11 }),
      ],
      splitRows: [split],
    });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(
      appuser,
      portfolio.portfolioKey,
      new Date('2026-01-03T00:00:00Z'),
      new Date('2026-01-03T00:00:00Z'),
    )) as { itemType?: string }[];

    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT')).toBe(true);
  });

  it('emits unique split ids per portfolio in the all-portfolios timeline', async () => {
    const portfolioTwo = { name: 'Growth', portfolioKey: 12 } as Portfolio;
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [
        transaction({ financialAssetKey: heldAsset, portfolioKey: portfolio, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 }),
        transaction({ financialAssetKey: heldAsset, portfolioKey: portfolioTwo, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 11 }),
      ],
      splitRows: [split],
    });

    const rows = (await portfolioTransactionService.getPortfoliosTransactions(appuser)) as { id: string; itemType?: string }[];
    const splitRows = rows.filter((row) => row.itemType === 'STOCK_SPLIT');

    expect(splitRows.map((row) => row.id).sort()).toEqual(['stock-split:1:11:7', 'stock-split:1:12:7']);
  });

  it('keeps multi-split replay row ids stable across portfolios', async () => {
    const portfolioTwo = { name: 'Growth', portfolioKey: 12 } as Portfolio;
    const heldAsset = { esgScore: 88, financialAssetKey: 7, logoUrl: 'logo', name: 'Apple', symbol: 'AAPL' } as FinancialAsset;
    const firstSplit = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    const secondSplit = {
      date: new Date('2026-01-05T00:00:00Z'),
      denominator: 1,
      financialAssetKey: heldAsset,
      financialAssetStockAdjustmentKey: 2,
      numerator: 3,
      splitRatio: 3,
    } as FinancialAssetStockAdjustment;

    setupEntityManager({
      findRows: [
        transaction({ financialAssetKey: heldAsset, portfolioKey: portfolio, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 10 }),
        transaction({ financialAssetKey: heldAsset, portfolioKey: portfolioTwo, transactionDate: new Date('2026-01-02T00:00:00Z'), transactionKey: 11 }),
      ],
      splitRows: [firstSplit, secondSplit],
    });

    const rows = (await portfolioTransactionService.getPortfoliosTransactions(appuser)) as { id: string; itemType?: string }[];
    const splitRows = rows.filter((row) => row.itemType === 'STOCK_SPLIT');

    expect(splitRows.map((row) => row.id)).toEqual([
      'stock-split:2:11:7',
      'stock-split:2:12:7',
      'stock-split:1:11:7',
      'stock-split:1:12:7',
    ]);
  });

  it('does not include unrelated asset split ids when ticker filtering', async () => {
    const otherAsset = { financialAssetKey: 8, logoUrl: 'logo2', name: 'MSFT', symbol: 'MSFT' } as FinancialAsset;
    const matchingSplit = { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: asset, financialAssetStockAdjustmentKey: 1, numerator: 2, splitRatio: 2 } as FinancialAssetStockAdjustment;
    const otherSplit = { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: otherAsset, financialAssetStockAdjustmentKey: 2, numerator: 3, splitRatio: 3 } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [transaction({ financialAssetKey: asset, portfolioKey: portfolio, transactionDate: new Date('2026-01-01T00:00:00Z') })],
      splitRows: [matchingSplit, otherSplit],
    });

    const rows = (await portfolioTransactionService.getPortfoliosTransactions(appuser, undefined, undefined, 'AAPL')) as { financialAssetKey?: { financialAssetKey?: number }; id: string; itemType?: string }[];

    expect(rows.some((row) => row.financialAssetKey?.financialAssetKey === 8)).toBe(false);
    expect(rows.some((row) => row.id === 'stock-split:2:11:8')).toBe(false);
  });

  it('bounds split query to relevant asset keys', async () => {
    const { findMock } = setupEntityManager({
      findRows: [transaction({ financialAssetKey: asset, portfolioKey: portfolio, transactionDate: new Date('2026-01-01T00:00:00Z') })],
      splitRows: [
        { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: asset, financialAssetStockAdjustmentKey: 1, numerator: 2, splitRatio: 2 } as FinancialAssetStockAdjustment,
      ],
    });

    await portfolioTransactionService.getPortfoliosTransactions(appuser, undefined, undefined, 'AAPL');
    expect(
      findMock.mock.calls.some(
        ([entity, criteria]) =>
          entity === FinancialAssetStockAdjustment &&
          criteria?.financialAssetKey?.financialAssetKey?.$in?.includes(7) &&
          criteria?.financialAssetKey?.symbol === 'AAPL',
      ),
    ).toBe(true);
  });

  it('does not query global splits when no owned assets exist', async () => {
    const { findMock } = setupEntityManager({ findRows: [] });

    const rows = await portfolioTransactionService.getPortfoliosTransactions(appuser);

    expect(rows).toHaveLength(0);
    expect(findMock).toHaveBeenCalledTimes(2);
  });

  it('excludes split rows outside the requested date range', async () => {
    const split = {
      date: new Date('2026-01-03T00:00:00Z'),
      denominator: 1,
      financialAssetKey: asset,
      financialAssetStockAdjustmentKey: 1,
      numerator: 2,
      splitRatio: 2,
    } as FinancialAssetStockAdjustment;
    setupEntityManager({ findRows: [transaction({ transactionDate: new Date('2026-01-01T00:00:00Z') })], splitRows: [split] });

    const rows = await portfolioTransactionService.getPortfolioTransactions(
      appuser,
      portfolio.portfolioKey,
      new Date('2026-01-04T00:00:00Z'),
      new Date('2026-01-05T00:00:00Z'),
    );

    expect(rows).toHaveLength(0);
  });

  it('includes only ticker-matching split rows across portfolios', async () => {
    const otherAsset = { financialAssetKey: 8, logoUrl: 'logo2', name: 'MSFT', symbol: 'MSFT' } as FinancialAsset;
    const matchingSplit = { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: asset, financialAssetStockAdjustmentKey: 1, numerator: 2, splitRatio: 2 } as FinancialAssetStockAdjustment;
    const otherSplit = { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: otherAsset, financialAssetStockAdjustmentKey: 2, numerator: 3, splitRatio: 3 } as FinancialAssetStockAdjustment;
    setupEntityManager({
      findRows: [transaction({ financialAssetKey: asset, portfolioKey: portfolio, transactionDate: new Date('2026-01-01T00:00:00Z') })],
      splitRows: [matchingSplit, otherSplit],
    });

    const rows = (await portfolioTransactionService.getPortfoliosTransactions(appuser, undefined, undefined, 'AAPL')) as { id: string; itemType?: string }[];

    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT' && row.id === 'stock-split:1:11:7')).toBe(true);
    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT' && row.id === 'stock-split:2:11:8')).toBe(false);
  });

  it('does not include split rows when the first buy is after the split date', async () => {
    const split = { date: new Date('2026-01-03T00:00:00Z'), denominator: 1, financialAssetKey: asset, financialAssetStockAdjustmentKey: 1, numerator: 2, splitRatio: 2 } as FinancialAssetStockAdjustment;
    const lateBuy = transaction({ financialAssetKey: asset, transactionDate: new Date('2026-01-04T00:00:00Z'), transactionKey: 10 });
    setupEntityManager({ findRows: [lateBuy], splitRows: [split] });

    const rows = (await portfolioTransactionService.getPortfolioTransactions(appuser, portfolio.portfolioKey)) as { itemType?: string }[];

    expect(rows.some((row) => row.itemType === 'STOCK_SPLIT')).toBe(false);
  });

  it('allows selling after a forward split during create validation', async () => {
    const { findMock } = setupEntityManager({
      findRows: [transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 })],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -8,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-03'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();

    expect(findMock).toHaveBeenCalledWith(
      FinancialAssetStockAdjustment,
      expect.objectContaining({
        adjustmentType: 'SPLIT',
        deletedAt: undefined,
        financialAssetKey: asset,
      }),
    );
  });

  it('rejects selling above split-adjusted holdings during create validation', async () => {
    setupEntityManager({
      findRows: [transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 })],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -9,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-03'),
        unitPrice: 100,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('rejects selling above reverse-split-adjusted holdings during create validation', async () => {
    setupEntityManager({
      findRows: [transaction({ quantity: 100, transactionDate: new Date('2026-01-01'), transactionKey: 1 })],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 10,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 1,
        },
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -11,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-03'),
        unitPrice: 100,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('applies same-day split before same-day sell during create validation', async () => {
    setupEntityManager({
      findRows: [transaction({ quantity: 2, transactionDate: new Date('2026-01-01T08:00:00Z'), transactionKey: 1 })],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02T09:00:00Z'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -8,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-02T01:00:00Z'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows updating a sell after a split up to adjusted quantity', async () => {
    const existingSell = transaction({
      financialTransactionTypeKey: sellType,
      quantity: -4,
      transactionDate: new Date('2026-01-03'),
      transactionKey: 2,
    });
    setupEntityManager({
      findRows: [
        transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 }),
        existingSell,
      ],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionForUpdate: existingSell,
      transactionType: sellType,
    });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 2, {
        quantity: 8,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects updating a sell after a split above adjusted quantity', async () => {
    const existingSell = transaction({
      financialTransactionTypeKey: sellType,
      quantity: -4,
      transactionDate: new Date('2026-01-03'),
      transactionKey: 2,
    });
    setupEntityManager({
      findRows: [
        transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 }),
        existingSell,
      ],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionForUpdate: existingSell,
      transactionType: sellType,
    });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 2, {
        quantity: 9,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('rejects updating a buy when a later split-adjusted sell depends on it', async () => {
    const existingBuy = transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 });
    setupEntityManager({
      findRows: [
        existingBuy,
        transaction({
          financialTransactionTypeKey: sellType,
          quantity: -8,
          transactionDate: new Date('2026-01-03'),
          transactionKey: 2,
        }),
      ],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionForUpdate: existingBuy,
    });

    await expect(
      updateTransaction(appuser, portfolio.portfolioKey, 1, {
        quantity: 1,
      }),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('rejects deleting a buy when a later split-adjusted sell depends on it', async () => {
    const existingBuy = transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 });
    setupEntityManager({
      findRows: [
        existingBuy,
        transaction({
          financialTransactionTypeKey: sellType,
          quantity: -8,
          transactionDate: new Date('2026-01-03'),
          transactionKey: 2,
        }),
      ],
      splitRows: [
        {
          adjustmentType: 'SPLIT',
          date: new Date('2026-01-02'),
          denominator: 1,
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
          numerator: 4,
        },
      ],
      transactionForUpdate: existingBuy,
    });

    await expect(
      portfolioTransactionService.deletePortfolioTransaction(appuser, portfolio.portfolioKey, 1),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
  });

  it('ignores malformed split rows during validation', async () => {
    setupEntityManager({
      findRows: [transaction({ quantity: 2, transactionDate: new Date('2026-01-01'), transactionKey: 1 })],
      splitRows: [
        {
          date: new Date('2026-01-02'),
          financialAssetKey: asset,
          financialAssetStockAdjustmentKey: 1,
        },
      ],
      transactionType: sellType,
    });

    await expect(
      createTransaction(appuser, {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: sellType.financialTransactionTypeKey,
        portfolioId: portfolio.portfolioKey,
        quantity: -2,
        settlementCurrencyId: currency.currencyKey,
        transactionDate: new Date('2026-01-03'),
        unitPrice: 100,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects deleting a buy when a later sell depends on it', async () => {
    const existingTransaction = transaction({
      quantity: 5,
      transactionDate: new Date('2026-01-01'),
      transactionKey: 1,
    });
    const { flushMock } = setupEntityManager({
      findRows: [
        existingTransaction,
        transaction({
          financialTransactionTypeKey: sellType,
          quantity: -4,
          transactionDate: new Date('2026-01-02'),
          transactionKey: 2,
        }),
      ],
      transactionForUpdate: existingTransaction,
    });

    await expect(
      portfolioTransactionService.deletePortfolioTransaction(appuser, portfolio.portfolioKey, 1),
    ).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');

    expect(flushMock).not.toHaveBeenCalled();
  });

  it('refreshes snapshots from the deleted transaction date instead of the earliest portfolio transaction', async () => {
    const deletedDate = new Date('2026-05-20T00:00:00Z');
    const existingTransaction = transaction({ transactionDate: deletedDate, transactionKey: 2 });
    setupEntityManager({
      findRows: [
        transaction({ transactionDate: new Date('2026-01-01T00:00:00Z'), transactionKey: 1 }),
        existingTransaction,
      ],
      transactionForUpdate: existingTransaction,
    });

    await portfolioTransactionService.deletePortfolioTransaction(appuser, portfolio.portfolioKey, 2);

    expect(portfolioSnapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(
      portfolio.portfolioKey,
      deletedDate,
    );
  });
});
