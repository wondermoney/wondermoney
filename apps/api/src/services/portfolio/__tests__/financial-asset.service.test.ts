import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: {} }));
vi.mock('@service/sentry', () => ({}));
const loggerWarnMock = vi.hoisted(() => vi.fn());
const syncStockSplitsForAssetMock = vi.hoisted(() => vi.fn().mockResolvedValue({ inserted: 0 }));
vi.mock('@utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: loggerWarnMock } }));
vi.mock('../stock-split-sync.service', () => ({ syncStockSplitsForAsset: syncStockSplitsForAssetMock }));

import { DI } from '@app/app';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetExchange } from '@entity/FinancialAssetExchange';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import eodhd from '@service/market-data/eodhd.service';

import { mapProfileToAssetFields, resolveOrCreateFinancialAsset } from '../financial-asset.service';

const eodhdMock = eodhd as unknown as { search: ReturnType<typeof vi.fn> };

describe('mapProfileToAssetFields', () => {
  const baseProfile = {
    Code: 'GOOGL.F',
    Country: 'Germany',
    Currency: 'EUR',
    Exchange: 'FKA',
    ISIN: 'US02079K3059',
    Name: 'Alphabet Inc.',
    previousClose: 150.5,
    previousCloseDate: '2026-01-02',
    Type: 'Common Stock',
  };

  it('maps scalar fields from EODHD search result', () => {
    const result = mapProfileToAssetFields(baseProfile);

    expect(result.symbol).toBe('GOOGL.F');
    expect(result.name).toBe('Alphabet Inc.');
    expect(result.isin).toBe('US02079K3059');
  });

  it('resolves type as "Stock" for a regular stock', () => {
    const result = mapProfileToAssetFields({ ...baseProfile, Type: 'Common Stock' });
    expect(result.resolvedTypeName).toBe('Stock');
  });

  it('resolves type as "ETF" when Type contains ETF', () => {
    const result = mapProfileToAssetFields({ ...baseProfile, Type: 'ETF' });
    expect(result.resolvedTypeName).toBe('ETF');
  });

  it('resolves type as "Mutual Fund" when Type contains Fund', () => {
    const result = mapProfileToAssetFields({ ...baseProfile, Type: 'Mutual Fund' });
    expect(result.resolvedTypeName).toBe('Mutual Fund');
  });

  it('defaults to "Stock" for an unrecognized Type value', () => {
    const result = mapProfileToAssetFields({ ...baseProfile, Type: 'Bond' });
    expect(result.resolvedTypeName).toBe('Stock');
  });

  it('defaults to "Stock" when Type is empty', () => {
    const result = mapProfileToAssetFields({ ...baseProfile, Type: '' });
    expect(result.resolvedTypeName).toBe('Stock');
  });

  it('defaults to "Stock" without throwing when Type is missing at runtime', () => {
    // The SDK types Type as a required string, but the live API can still
    // omit or null it — guard against an unhandled TypeError (see
    // mapProfileToAssetFields's `profile.Type?.toLowerCase() ?? ''`).
    const result = mapProfileToAssetFields({ ...baseProfile, Type: undefined as unknown as string });
    expect(result.resolvedTypeName).toBe('Stock');
  });

  it('returns the Exchange for FK lookup', () => {
    const result = mapProfileToAssetFields(baseProfile);
    expect(result.exchangeShortName).toBe('FKA');
    expect(result.currencyCode).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Helpers shared across resolveOrCreateFinancialAsset tests
// ---------------------------------------------------------------------------

const fakeAsset = { name: 'Apple Inc.', symbol: 'AAPL' } as FinancialAsset;

const validEodhdResult = {
  Code: 'AAPL',
  Country: 'USA',
  Currency: 'USD',
  Exchange: 'NASDAQ',
  ISIN: 'US0378331005',
  Name: 'Apple Inc.',
  previousClose: 185.64,
  previousCloseDate: '2026-01-02',
  Type: 'Common Stock',
};

const fakeCurrency = { code: 'USD' } as Currency;
const fakeExchange = { acronym: 'NASDAQ' } as FinancialAssetExchange;
const fakeAssetType = { name: 'Stock' } as FinancialAssetType;

describe('resolveOrCreateFinancialAsset', () => {
  function setupEm({
    createResult = fakeAsset,
    findOneImpl,
    flushError,
    forkFindOneImpl = findOneImpl,
  }: {
    createResult?: FinancialAsset;
    findOneImpl: (
      Entity: typeof Currency | typeof FinancialAsset | typeof FinancialAssetExchange | typeof FinancialAssetType,
      _filter: unknown,
    ) => Promise<Currency | FinancialAsset | FinancialAssetExchange | FinancialAssetType | null>;
    flushError?: unknown;
    forkFindOneImpl?: (
      Entity: typeof Currency | typeof FinancialAsset | typeof FinancialAssetExchange | typeof FinancialAssetType,
      _filter: unknown,
    ) => Promise<Currency | FinancialAsset | FinancialAssetExchange | FinancialAssetType | null>;
    }) {
    const mockFindOne = vi.fn().mockImplementation(findOneImpl);
    const mockForkFindOne = vi.fn().mockImplementation(forkFindOneImpl);
    const mockCreate = vi.fn().mockReturnValue(createResult);
    const mockFlush = flushError
      ? vi.fn().mockRejectedValue(flushError)
      : vi.fn().mockResolvedValue(undefined);
    const mockFork = vi.fn().mockImplementation(() => ({ clear: vi.fn(), create: mockCreate, findOne: mockForkFindOne, flush: mockFlush }));

    Object.assign(DI.em, { create: mockCreate, findOne: mockFindOne, flush: mockFlush, fork: mockFork });
    return { mockCreate, mockFindOne, mockFlush, mockFork, mockForkFindOne };
  }

  it('returns existing asset from DB without calling EODHD', async () => {
    setupEm({
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        return Promise.resolve(null);
      },
    });
    eodhdMock.search = vi.fn();

    const result = await resolveOrCreateFinancialAsset('AAPL');

    expect(result).toBe(fakeAsset);
    expect(eodhdMock.search).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when EODHD returns empty search results', async () => {
    setupEm({
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    });
    eodhdMock.search = vi.fn().mockResolvedValue([]);

    await expect(resolveOrCreateFinancialAsset('UNKNOWN')).rejects.toThrow('Unknown symbol: UNKNOWN');
  });

  it('creates and returns asset when symbol is not in DB and EODHD returns a valid result', async () => {
    const { mockFindOne, mockFork, mockForkFindOne } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    const result = await resolveOrCreateFinancialAsset('AAPL');

    expect(result).toBe(fakeAsset);
    expect(mockFork).toHaveBeenCalled();
    expect(mockForkFindOne).toHaveBeenCalled();
  });

  it('picks the exact symbol match when EODHD search returns multiple results', async () => {
    const { mockFindOne } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    const otherResult = { ...validEodhdResult, Code: 'AAPL.MX', Name: 'Apple Inc (Mexico)' };
    eodhdMock.search = vi.fn().mockResolvedValue([otherResult, validEodhdResult]);

    const result = await resolveOrCreateFinancialAsset('AAPL');

    expect(result).toBe(fakeAsset);
  });

  it('throws BadRequestError when currency is not found in DB', async () => {
    setupEm({
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(null);
        if (Entity === Currency) return Promise.resolve(null);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    await expect(resolveOrCreateFinancialAsset('AAPL')).rejects.toThrow('Unsupported currency: USD');
  });

  it('throws BadRequestError when asset type is not found in DB', async () => {
    setupEm({
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(null);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    });
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    await expect(resolveOrCreateFinancialAsset('AAPL')).rejects.toThrow('Unsupported asset type: Stock');
  });

  it('creates asset without cik/cusip/logoUrl (not available from EODHD search)', async () => {
    const { mockCreate, mockFindOne } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    await resolveOrCreateFinancialAsset('AAPL');

    const createdFields = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createdFields).not.toHaveProperty('cik');
    expect(createdFields).not.toHaveProperty('cusip');
    expect(createdFields).not.toHaveProperty('logoUrl');
    expect(createdFields).not.toHaveProperty('isActivelyTrading');
  });

  it('handles race condition: retries findOne after UniqueConstraintViolationException and returns found asset', async () => {
    // FinancialAsset: first call (initial check) → null, second call (retry after conflict) → fakeAsset
    const mockFindOne = vi.fn()
      .mockResolvedValueOnce(null)        // initial FinancialAsset check
      .mockImplementation((Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset); // retry after conflict
        return Promise.resolve(null);
      });
    const mockForkFindOne = vi.fn().mockImplementation((Entity) => {
      if (Entity === Currency) return Promise.resolve(fakeCurrency);
      if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
      if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
      return Promise.resolve(null);
    });

    const mockCreate = vi.fn().mockReturnValue(fakeAsset);
    const mockFlush = vi.fn().mockRejectedValue(new UniqueConstraintViolationException(new Error('unique')));

    Object.assign(DI.em, { create: mockCreate, findOne: mockFindOne, flush: mockFlush, fork: vi.fn().mockReturnValue({ clear: vi.fn(), create: mockCreate, findOne: mockForkFindOne, flush: mockFlush }) });

    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    const result = await resolveOrCreateFinancialAsset('AAPL');

    expect(result).toBe(fakeAsset);
  });

  it('logs and swallows split sync failure after creating a new asset', async () => {
    const { mockFindOne, mockFork } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);
    syncStockSplitsForAssetMock.mockRejectedValueOnce(new Error('split sync failed'));

    await resolveOrCreateFinancialAsset('AAPL');

    expect(mockFork).toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), symbol: 'AAPL' }),
      'Failed to sync stock splits for newly created asset',
    );
  });

  it('resolves EODHD exchange codes via the alias pivot (e.g. "US" -> NYSE) and attributes the new asset', async () => {
    // RAD-460 regression: the service used to look up exchanges by `acronym`
    // only, which never matched EODHD's ISO-style codes ("US", "LSE", …)
    // and silently left new holdings without exchange attribution. The
    // FinancialAssetExchangeAlias pivot already maps most EODHD codes
    // to seeded acronyms; the fix is to look up by `acronym OR aliases.name`
    // in a single query, so this test asserts the filter shape.
    const { mockCreate, mockFindOne, mockForkFindOne } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    const eodhdResultUsCode = { ...validEodhdResult, Exchange: 'US' };
    eodhdMock.search = vi.fn().mockResolvedValue([eodhdResultUsCode]);

    await resolveOrCreateFinancialAsset('AAPL');

    // Filter must match the new $or shape so the alias pivot is consulted.
    const exchangeCall = mockForkFindOne.mock.calls.find(([Entity]) => Entity === FinancialAssetExchange);
    expect(exchangeCall).toBeDefined();
    const filter = exchangeCall?.[1] as { $or?: unknown[] };
    expect(filter).toHaveProperty('$or');
    expect(Array.isArray(filter.$or)).toBe(true);
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ acronym: 'US' }),
        expect.objectContaining({ aliases: { name: 'US' } }),
      ]),
    );

    // And the resolved exchange is passed through to the new FinancialAsset row.
    const createdFields = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createdFields).toHaveProperty('financialAssetExchangeKey', fakeExchange);
  });

  it('falls through to undefined exchange when the EODHD code has no alias (graceful degradation)', async () => {
    // RAD-460 follow-up: EODHD codes not yet covered by the alias seeder
    // ('XETRA', 'STU', 'BA', 'BK', 'HM') still resolve to undefined and the
    // asset is created without exchange attribution. This test pins the
    // graceful-degradation contract.
    const { mockCreate, mockFindOne, mockForkFindOne } = setupEm({
      createResult: fakeAsset,
      findOneImpl: (Entity) => {
        if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
        if (Entity === Currency) return Promise.resolve(fakeCurrency);
        if (Entity === FinancialAssetExchange) return Promise.resolve(null);
        if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
        return Promise.resolve(null);
      },
    });
    mockFindOne.mockResolvedValueOnce(null);
    const eodhdResultXetra = { ...validEodhdResult, Exchange: 'XETRA' };
    eodhdMock.search = vi.fn().mockResolvedValue([eodhdResultXetra]);

    const result = await resolveOrCreateFinancialAsset('SAP.XETRA');

    expect(result).toBe(fakeAsset);
    const exchangeCall = mockForkFindOne.mock.calls.find(([Entity]) => Entity === FinancialAssetExchange);
    expect(exchangeCall?.[1]).toEqual({
      $or: [{ acronym: 'XETRA' }, { aliases: { name: 'XETRA' } }],
    });
    const createdFields = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createdFields['financialAssetExchangeKey']).toBeUndefined();
  });

  it('recovers from unique violation using forked EM and leaves request EM clean', async () => {
    const requestFlushMock = vi.fn().mockResolvedValue(undefined);
    const requestFindOneMock = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementation((Entity) => {
        if (Entity === FinancialAsset) return fakeAsset;
        return null;
      });
    const forkFindOneMock = vi.fn().mockImplementation((Entity) => {
      if (Entity === FinancialAsset) return Promise.resolve(fakeAsset);
      if (Entity === Currency) return Promise.resolve(fakeCurrency);
      if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
      if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
      return Promise.resolve(null);
    });
    const forkCreateMock = vi.fn().mockReturnValue(fakeAsset);
    const forkClearMock = vi.fn();
    const forkFlushMock = vi.fn().mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    const forkMock = vi.fn().mockReturnValue({ clear: forkClearMock, create: forkCreateMock, findOne: forkFindOneMock, flush: forkFlushMock });

    Object.assign(DI.em, { findOne: requestFindOneMock, flush: requestFlushMock, fork: forkMock });
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    const result = await resolveOrCreateFinancialAsset('AAPL', { skipStockSplitSync: true });

    expect(result).toBe(fakeAsset);
    expect(forkMock).toHaveBeenCalled();
    expect(forkClearMock).toHaveBeenCalledTimes(1);
    expect(requestFlushMock).not.toHaveBeenCalled();
    await expect(DI.em.flush()).resolves.toBeUndefined();
  });

  it('uses the provided EM directly when options.em is passed', async () => {
    const providedEmFindOneMock = vi.fn().mockImplementation((Entity) => {
      if (Entity === FinancialAsset) return Promise.resolve(null);
      if (Entity === Currency) return Promise.resolve(fakeCurrency);
      if (Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
      if (Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
      return Promise.resolve(null);
    });
    const providedEmCreateMock = vi.fn().mockReturnValue(fakeAsset);
    const providedEmFlushMock = vi.fn().mockResolvedValue(undefined);
    const providedEm = { create: providedEmCreateMock, findOne: providedEmFindOneMock, flush: providedEmFlushMock } as unknown as typeof DI.em;
    const forkMock = vi.fn();

    Object.assign(DI.em, { fork: forkMock });
    eodhdMock.search = vi.fn().mockResolvedValue([validEodhdResult]);

    let call = 0;
    providedEmFindOneMock.mockImplementation((Entity) => {
      call += 1;
      if (call === 1) return Promise.resolve(null);
      if (call === 2 && Entity === Currency) return Promise.resolve(fakeCurrency);
      if (call === 3 && Entity === FinancialAssetExchange) return Promise.resolve(fakeExchange);
      if (call === 4 && Entity === FinancialAssetType) return Promise.resolve(fakeAssetType);
      if (call === 5 && Entity === FinancialAsset) return Promise.resolve(fakeAsset);
      return Promise.resolve(null);
    });

    const result = await resolveOrCreateFinancialAsset('AAPL', { em: providedEm, skipStockSplitSync: true });

    expect(result).toBe(fakeAsset);
    expect(providedEmFindOneMock).toHaveBeenCalledTimes(5);
    expect(providedEmCreateMock).toHaveBeenCalledWith(FinancialAsset, expect.objectContaining({ symbol: 'AAPL' }));
    expect(providedEmFlushMock).toHaveBeenCalledTimes(1);
    expect(forkMock).not.toHaveBeenCalled();
  });
});
