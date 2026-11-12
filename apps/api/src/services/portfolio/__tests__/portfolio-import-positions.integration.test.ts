import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus, PortfolioImportSessionType } from '@entity/PortfolioImportSession';
import type { PortfolioColumnMapping } from '@service/portfolio/portfolio-csv-column-mapping.schema';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('../portfolio-snapshot.service', () => ({ default: { backfillSnapshotsForPortfolio: vi.fn() } }));
vi.mock('../asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import portfolioCsvColumnMappingService from '../portfolio-csv-column-mapping.service';
import PortfolioCsvParsePreviewService from '../portfolio-csv-parse-preview.service';
import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioImportAssetMappingService from '../portfolio-import-asset-mapping.service';
import portfolioImportAssetResolutionService, { type AssetSearchCandidate } from '../portfolio-import-asset-resolution.service';
import portfolioImportFinalizeService from '../portfolio-import-finalize.service';
import { EXISTING_TRADES_SKIP_REASON, OPENING_POSITION_NOTE, updatePositionRowInclusion } from '../portfolio-import-positions';
import portfolioImportSessionPreviewService from '../portfolio-import-session-preview.service';
import portfolioImportSessionService from '../portfolio-import-session.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * A positions file ("what I hold today") through the real import session: column mapping,
 * asset resolution and review, the existing-trades rule and finalize. Each row is one opening
 * BUY, so the portfolio reads exactly as if the person had recorded that buy by hand: one FIFO
 * lot or one addition to the average pool, a contribution on its date, and the cost a later
 * sale relieves.
 */
describe('positions import', () => {
  const db = useTestDatabase();
  let household: Household;
  let setup: PortfolioSetup;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    setup = await seedPortfolio(db.em(), household);
    // USD settles 1:1 into the household's EUR, so the expected costs read straight off the file.
    await addExchangeRate(DI.em, setup.usd, household.currency, '2020-01-01', 1);
  });

  const tenant = () => ({ tenantKey: household.tenant.tenantKey });

  const addAsset = async (symbol: string, isin: string) => {
    const stock = await DI.em.findOneOrFail(FinancialAssetType, { name: 'Stock' });
    const asset = DI.em.create(FinancialAsset, { currencyKey: setup.usd, financialAssetTypeKey: stock, isin, name: `${symbol} Inc`, symbol }, { partial: true });
    await DI.em.flush();
    return asset;
  };

  const setMethod = (method: PortfolioCostBasisMethod) => DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { costBasisMethod: method });

  const buy = (asset: FinancialAsset, day: string, quantity: number, unitPrice: number, type: number = FINANCIAL_TRANSACTION_TYPES.BUY, portfolioId = setup.portfolio.portfolioKey, appuser: Appuser = setup.appuser) =>
    portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol,
      financialAsset: asset,
      financialTransactionTypeId: type,
      portfolioId,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(`${day}T00:00:00Z`),
      unitPrice,
    }, DI.em);

  const csvOf = (header: string[], rows: (number | string)[][]) => [header.join(','), ...rows.map((row) => row.join(','))].join('\n');

  const UNIT_COST_MAPPING: PortfolioColumnMapping = { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', ticker: 'Symbol', transactionDate: 'Acquired', unitPrice: 'Average cost' };

  /** A positions session that has been uploaded and parsed: it waits for its column mapping. */
  const startSession = async (csv: string, appuser: Appuser = setup.appuser) => {
    const session = await portfolioImportSessionService.createSession({ appuser, correlationId: `positions-${Math.random()}`, importType: PortfolioImportSessionType.POSITIONS, portfolioId: setup.portfolio.portfolioKey, s3Bucket: 'bucket', s3Key: 'key', tenant: tenant() });
    session.status = PortfolioImportSessionStatus.PARSING;
    await DI.em.flush();
    await new PortfolioCsvParsePreviewService().parseImportSession({ importSessionId: session.portfolioImportSessionKey }, { getObjectSize: () => Promise.resolve(csv.length), getObjectText: () => Promise.resolve(csv), parseCsvRows: (text) => import('@service/account/csv-upload-boundary.service').then(({ parseCsvRows }) => parseCsvRows(text)) });
    return session.portfolioImportSessionKey;
  };

  const mapColumns = (importSessionId: number, csv: string, options: { asOfDate?: string; columnMapping?: PortfolioColumnMapping; search?: AssetSearchCandidate[] } = {}) =>
    portfolioCsvColumnMappingService.confirmColumnMapping({
      appuser: setup.appuser,
      asOfDate: options.asOfDate,
      columnMapping: options.columnMapping ?? UNIT_COST_MAPPING,
      importSessionId,
      layout: { dataStartRowIndex: 1, headerRowIndex: 0 },
      tenant: tenant(),
      transformations: {},
    }, {
      getObjectSize: () => Promise.resolve(csv.length),
      getObjectText: () => Promise.resolve(csv),
      resolveImportSessionAssets: (input) => portfolioImportAssetResolutionService.resolveImportSessionAssets(input, { search: () => Promise.resolve(options.search ?? []) }),
    });

  /** What the confirm transition does before the worker runs: the session is importing. */
  const finalize = async (importSessionId: number) => {
    await DI.em.nativeUpdate(PortfolioImportSession, { portfolioImportSessionKey: importSessionId }, { status: PortfolioImportSessionStatus.IMPORTING });
    DI.em.clear();
    return portfolioImportFinalizeService.finalizeImportSession({ importSessionId });
  };

  const importPositions = async (csv: string, options: { asOfDate?: string; columnMapping?: PortfolioColumnMapping } = {}) => {
    const importSessionId = await startSession(csv);
    await mapColumns(importSessionId, csv, options);
    return { importSessionId, result: await finalize(importSessionId) };
  };

  const lotsOf = (asset: FinancialAsset) => portfolioHoldingsService.getHoldingLots(setup.appuser, setup.portfolio.portfolioKey, asset.financialAssetKey, household.tenant.tenantKey);

  const rowsOf = (importSessionId: number) => DI.em.fork().find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: { portfolioImportSessionKey: importSessionId } }, { orderBy: { rowNumber: 'asc' } });

  it('waits for a column mapping even when the file looks like the internal trade layout', async () => {
    const csv = csvOf(['date', 'assetSymbol', 'transactionTypeId', 'quantity', 'unitPrice', 'settlementCurrencyId', 'internalTransactionId'], [['2024-01-02', 'AAPL', 1, 1, 10, 1, 'x']]);
    const importSessionId = await startSession(csv);

    const session = await DI.em.fork().findOneOrFail(PortfolioImportSession, { portfolioImportSessionKey: importSessionId });
    expect(session.status).toBe(PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING);
    expect(session.importType).toBe(PortfolioImportSessionType.POSITIONS);
  });

  describe.each([PortfolioCostBasisMethod.FIFO, PortfolioCostBasisMethod.AVERAGE])('under %s', (method) => {
    it('turns a 20-row file into 20 opening buys with each asset\'s quantity and cost basis', async () => {
      await setMethod(method);
      const assets = await Promise.all(Array.from({ length: 20 }, (_, index) => addAsset(`T${index}`, `US00000000${String(index).padStart(2, '0')}`)));
      const rows = assets.map((asset, index) => [asset.symbol, asset.isin!, index + 1, 10 * (index + 1) + 0.5, 'USD', '2024-03-15']);
      const csv = csvOf(['Symbol', 'ISIN', 'Quantity', 'Average cost', 'Currency', 'Acquired'], rows);

      const { result } = await importPositions(csv);

      expect(result).toMatchObject({ importedRows: 20, status: PortfolioImportSessionStatus.SUCCEEDED });
      const buys = await DI.em.fork().find(FinancialTransaction, { portfolioKey: { portfolioKey: setup.portfolio.portfolioKey } }, { populate: ['financialTransactionTypeKey'] });
      expect(buys).toHaveLength(20);
      expect(buys.every((trade) => trade.financialTransactionTypeKey?.name === 'BUY' && trade.notes === OPENING_POSITION_NOTE)).toBe(true);
      for (const [index, asset] of assets.entries()) {
        const quantity = index + 1;
        const unitCost = 10 * (index + 1) + 0.5;
        const lots = await lotsOf(asset);
        expect(lots).toMatchObject({ costBasisMethod: method, openQuantity: quantity });
        expect(lots!.openCostBasis).toBeCloseTo(quantity * unitCost, 6);
        expect(lots!.lots).toHaveLength(1);
        expect(lots!.lots[0]).toMatchObject({ date: '2024-03-15T00:00:00.000Z', quantity, unitCost });
      }
    });

    it('lets a later sale relieve the opening cost as realized gain', async () => {
      await setMethod(method);
      const asset = await addAsset('OPEN', 'US0000000099');
      await importPositions(csvOf(['Symbol', 'ISIN', 'Quantity', 'Average cost', 'Currency', 'Acquired'], [['OPEN', 'US0000000099', 10, 100, 'USD', '2024-01-02']]));

      await buy(asset, '2025-01-02', 4, 150, FINANCIAL_TRANSACTION_TYPES.SELL);

      await expect(portfolioHoldingsService.getRealizedGains(setup.appuser.appuserKey, setup.portfolio.portfolioKey, household.tenant.tenantKey)).resolves.toMatchObject({ totalCostBasisOfSold: 400, totalRealizedGains: 200 });
      await expect(lotsOf(asset)).resolves.toMatchObject({ openQuantity: 6, realizedCostBasis: 400 });
    });
  });

  it('derives the unit cost from a total-cost column', async () => {
    const asset = await addAsset('TOT', 'US0000000077');
    const columnMapping: PortfolioColumnMapping = { currency: 'Currency', isin: 'ISIN', quantity: 'Shares', totalAmount: 'Total cost' };

    await importPositions(csvOf(['ISIN', 'Shares', 'Total cost', 'Currency'], [['US0000000077', 3, 1000, 'USD']]), { asOfDate: '2024-06-30', columnMapping });

    const lots = await lotsOf(asset);
    expect(lots!.openQuantity).toBe(3);
    expect(lots!.openCostBasis).toBeCloseTo(1000, 4);
    expect(lots!.lots[0]!.unitCost).toBeCloseTo(1000 / 3, 6);
  });

  it('prefers the unit-cost column when the file has both', async () => {
    const asset = await addAsset('BOTH', 'US0000000078');
    const columnMapping: PortfolioColumnMapping = { currency: 'Currency', isin: 'ISIN', quantity: 'Shares', totalAmount: 'Total cost', unitPrice: 'Average cost' };

    await importPositions(csvOf(['ISIN', 'Shares', 'Average cost', 'Total cost', 'Currency'], [['US0000000078', 2, 50, 999, 'USD']]), { asOfDate: '2024-06-30', columnMapping });

    await expect(lotsOf(asset)).resolves.toMatchObject({ openCostBasis: 100, openQuantity: 2 });
  });

  it('buys a row without an acquisition date on the as-of day, and a dated row on its own date', async () => {
    const dated = await addAsset('DATED', 'US0000000001');
    const undated = await addAsset('UNDATED', 'US0000000002');
    const csv = csvOf(['Symbol', 'ISIN', 'Quantity', 'Average cost', 'Currency', 'Acquired'], [['DATED', 'US0000000001', 1, 10, 'USD', '2023-05-04'], ['UNDATED', 'US0000000002', 1, 10, 'USD', '']]);

    await importPositions(csv, { asOfDate: '2024-12-31' });

    expect((await lotsOf(dated))!.lots[0]!.date).toBe('2023-05-04T00:00:00.000Z');
    expect((await lotsOf(undated))!.lots[0]!.date).toBe('2024-12-31T00:00:00.000Z');
  });

  it('refuses a mapping with no acquisition date column and no as-of day', async () => {
    const csv = csvOf(['ISIN', 'Quantity', 'Average cost', 'Currency'], [['US0000000001', 1, 10, 'USD']]);
    const importSessionId = await startSession(csv);

    await expect(mapColumns(importSessionId, csv, { columnMapping: { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', unitPrice: 'Average cost' } })).rejects.toThrow(/asOfDate/);
  });

  it('counts the opening buy as a contribution on its date for returns', async () => {
    await addAsset('FLOW', 'US0000000003');
    await importPositions(csvOf(['ISIN', 'Quantity', 'Average cost', 'Currency'], [['US0000000003', 5, 20, 'USD']]), { asOfDate: '2024-02-01', columnMapping: { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', unitPrice: 'Average cost' } });

    const flows = await portfolioHoldingsService.getInvestmentCashFlows(setup.appuser, household.tenant.tenantKey, setup.portfolio.portfolioKey);

    expect(flows).toEqual([expect.objectContaining({ amount: -100, date: new Date('2024-02-01T00:00:00.000Z'), kind: 'BUY' })]);
  });

  it('marks invalid rows instead of guessing a quantity or cost', async () => {
    await addAsset('OK', 'US0000000004');
    const csv = csvOf(['ISIN', 'Quantity', 'Average cost', 'Currency'], [['US0000000004', 5, 20, 'USD'], ['US0000000004', 0, 20, 'USD'], ['US0000000004', 5, 0, 'USD']]);
    const importSessionId = await startSession(csv);

    await mapColumns(importSessionId, csv, { asOfDate: '2024-02-01', columnMapping: { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', unitPrice: 'Average cost' } });

    const rows = await rowsOf(importSessionId);
    expect(rows.map((row) => row.status)).toEqual([PortfolioImportRowStatus.READY, PortfolioImportRowStatus.INVALID, PortfolioImportRowStatus.INVALID]);
  });

  describe('assets that already have trades in the portfolio', () => {
    const csv = csvOf(['Symbol', 'ISIN', 'Quantity', 'Average cost', 'Currency', 'Acquired'], [['AAPL', 'US0378331005', 10, 150, 'USD', '2024-01-02'], ['MSFT', 'US5949181045', 5, 300, 'USD', '2024-01-02']]);
    let aapl: FinancialAsset;
    let msft: FinancialAsset;

    beforeEach(async () => {
      aapl = await DI.em.findOneOrFail(FinancialAsset, { financialAssetKey: setup.asset.financialAssetKey });
      aapl.isin = 'US0378331005';
      await DI.em.flush();
      msft = await addAsset('MSFT', 'US5949181045');
      await buy(aapl, '2023-06-01', 2, 100);
    });

    it('skips those rows by default and warns about them', async () => {
      const importSessionId = await startSession(csv);
      await mapColumns(importSessionId, csv);

      const preview = await portfolioImportSessionPreviewService.getPreview({ appuser: setup.appuser, importSessionId, limit: 25, tenant: tenant() });
      expect(preview.importType).toBe('positions');
      expect(preview.status).toBe(PortfolioImportSessionStatus.PARTIAL);
      expect(preview.summary).toMatchObject({ canConfirm: true, existingTradeRows: 1, existingTradeSkippedRows: 1, readyRows: 1 });
      expect(preview.rows.existingTrades).toEqual([expect.objectContaining({ skipReason: EXISTING_TRADES_SKIP_REASON, status: PortfolioImportRowStatus.SKIPPED })]);

      await finalize(importSessionId);

      await expect(lotsOf(aapl)).resolves.toMatchObject({ openQuantity: 2 });
      await expect(lotsOf(msft)).resolves.toMatchObject({ openQuantity: 5 });
    });

    it('imports a row the person includes', async () => {
      const importSessionId = await startSession(csv);
      await mapColumns(importSessionId, csv);
      const [skipped] = (await rowsOf(importSessionId)).filter((row) => row.status === PortfolioImportRowStatus.SKIPPED);

      const result = await updatePositionRowInclusion({ appuser: setup.appuser, importSessionId, rows: [{ include: true, rowId: skipped!.portfolioImportRowKey }], tenant: tenant() });
      expect(result).toMatchObject({ status: PortfolioImportSessionStatus.READY_TO_IMPORT, summary: { canConfirm: true, existingTradeRows: 1, existingTradeSkippedRows: 0, readyRows: 2 } });

      await finalize(importSessionId);

      await expect(lotsOf(aapl)).resolves.toMatchObject({ openQuantity: 12 });
    });

    it('skips an included row again when the person changes their mind', async () => {
      const importSessionId = await startSession(csv);
      await mapColumns(importSessionId, csv);
      const [skipped] = (await rowsOf(importSessionId)).filter((row) => row.status === PortfolioImportRowStatus.SKIPPED);
      const rowId = skipped!.portfolioImportRowKey;

      await updatePositionRowInclusion({ appuser: setup.appuser, importSessionId, rows: [{ include: true, rowId }], tenant: tenant() });
      await updatePositionRowInclusion({ appuser: setup.appuser, importSessionId, rows: [{ include: false, rowId }], tenant: tenant() });

      const row = (await rowsOf(importSessionId)).find((candidate) => candidate.portfolioImportRowKey === rowId);
      expect(row).toMatchObject({ skipReason: EXISTING_TRADES_SKIP_REASON, status: PortfolioImportRowStatus.SKIPPED });
    });

    it('keeps the session open when every row is held back', async () => {
      const onlyAapl = csvOf(['Symbol', 'ISIN', 'Quantity', 'Average cost', 'Currency', 'Acquired'], [['AAPL', 'US0378331005', 10, 150, 'USD', '2024-01-02']]);
      const importSessionId = await startSession(onlyAapl);
      await mapColumns(importSessionId, onlyAapl);

      const preview = await portfolioImportSessionPreviewService.getPreview({ appuser: setup.appuser, importSessionId, limit: 25, tenant: tenant() });
      expect(preview.status).toBe(PortfolioImportSessionStatus.PARTIAL);
      expect(preview.summary).toMatchObject({ canConfirm: false, existingTradeSkippedRows: 1, readyRows: 0 });
      expect(preview.summary.terminalKind).toBeUndefined();
    });

    it('refuses to include a row that has no existing trades', async () => {
      const importSessionId = await startSession(csv);
      await mapColumns(importSessionId, csv);
      const [ready] = (await rowsOf(importSessionId)).filter((row) => row.status === PortfolioImportRowStatus.READY);

      await expect(updatePositionRowInclusion({ appuser: setup.appuser, importSessionId, rows: [{ include: true, rowId: ready!.portfolioImportRowKey }], tenant: tenant() })).rejects.toThrow(/already has trades/);
    });

    it('ignores trades of the same asset in another household', async () => {
      const other = await seedHousehold(DI.em);
      const outsider = await DI.em.findOneOrFail(Appuser, { appuserKey: other.appuser.appuserKey }, { filters: false, populate: ['currencyKey'] });
      const otherPortfolio = DI.em.create(Portfolio, { currencyKey: other.currency, name: 'Theirs', portfolioOwnerAppuserKey: outsider, tenantKey: other.tenant }, { partial: true });
      await DI.em.flush();
      await buy(msft, '2023-06-01', 1, 100, FINANCIAL_TRANSACTION_TYPES.BUY, otherPortfolio.portfolioKey, outsider);

      const importSessionId = await startSession(csv);
      await mapColumns(importSessionId, csv);

      const rows = await rowsOf(importSessionId);
      expect(rows.map((row) => [row.normalizedJson?.['ticker'], row.status])).toEqual([['AAPL', PortfolioImportRowStatus.SKIPPED], ['MSFT', PortfolioImportRowStatus.READY]]);
    });
  });

  it('sends an unknown symbol to asset review and holds it back once it resolves to a traded asset', async () => {
    const traded = await addAsset('TRD', 'US0000000005');
    await buy(traded, '2023-06-01', 1, 10);
    const csv = csvOf(['Symbol', 'Quantity', 'Average cost', 'Currency'], [['MYSTERY', 4, 25, 'USD']]);
    const importSessionId = await startSession(csv);

    await mapColumns(importSessionId, csv, { asOfDate: '2024-01-02', columnMapping: { currency: 'Currency', quantity: 'Quantity', ticker: 'Symbol', unitPrice: 'Average cost' }, search: [{ Code: 'MYS1', Exchange: 'US', Name: 'Mystery One' }, { Code: 'MYS2', Exchange: 'LSE', Name: 'Mystery Two' }] });

    const review = await portfolioImportSessionPreviewService.getPreview({ appuser: setup.appuser, importSessionId, limit: 25, tenant: tenant() });
    expect(review.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(review.rows.needsAssetReview).toHaveLength(1);

    const [group] = review.assetGroups;
    const decided = await portfolioImportAssetMappingService.confirmAssetMappings({ appuser: setup.appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: traded.financialAssetKey, groupId: group!.id }], importSessionId, tenant: tenant() });

    expect(decided.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect((await rowsOf(importSessionId))[0]).toMatchObject({ skipReason: EXISTING_TRADES_SKIP_REASON, status: PortfolioImportRowStatus.SKIPPED });
  });

  it('imports an unknown symbol once review picks its asset', async () => {
    const picked = await addAsset('PICK', 'US0000000006');
    const csv = csvOf(['Symbol', 'Quantity', 'Average cost', 'Currency'], [['MYSTERY', 4, 25, 'USD']]);
    const importSessionId = await startSession(csv);
    await mapColumns(importSessionId, csv, { asOfDate: '2024-01-02', columnMapping: { currency: 'Currency', quantity: 'Quantity', ticker: 'Symbol', unitPrice: 'Average cost' }, search: [{ Code: 'MYS1', Name: 'Mystery One' }, { Code: 'MYS2', Name: 'Mystery Two' }] });
    const review = await portfolioImportSessionPreviewService.getPreview({ appuser: setup.appuser, importSessionId, limit: 25, tenant: tenant() });

    const decided = await portfolioImportAssetMappingService.confirmAssetMappings({ appuser: setup.appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: picked.financialAssetKey, groupId: review.assetGroups[0]!.id }], importSessionId, tenant: tenant() });
    expect(decided).toMatchObject({ status: PortfolioImportSessionStatus.READY_TO_IMPORT, summary: { canConfirm: true } });

    await finalize(importSessionId);

    await expect(lotsOf(picked)).resolves.toMatchObject({ openCostBasis: 100, openQuantity: 4 });
  });

  describe('tenancy', () => {
    it("does not let another household open, review or include rows of the session", async () => {
      await addAsset('OWN', 'US0000000007');
      const csv = csvOf(['ISIN', 'Quantity', 'Average cost', 'Currency'], [['US0000000007', 1, 10, 'USD']]);
      const importSessionId = await startSession(csv);
      const other = await seedHousehold(DI.em);
      const outsider = await DI.em.findOneOrFail(Appuser, { appuserKey: other.appuser.appuserKey }, { filters: false });
      const outsiderTenant = { tenantKey: other.tenant.tenantKey };

      await expect(portfolioImportSessionPreviewService.getPreview({ appuser: outsider, importSessionId, limit: 25, tenant: outsiderTenant })).rejects.toThrow(/not found/i);
      await expect(updatePositionRowInclusion({ appuser: outsider, importSessionId, rows: [{ include: true, rowId: 1 }], tenant: outsiderTenant })).rejects.toThrow(/not found/i);
      await expect(portfolioCsvColumnMappingService.confirmColumnMapping({ appuser: outsider, asOfDate: '2024-01-02', columnMapping: { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', unitPrice: 'Average cost' }, importSessionId, layout: {}, tenant: outsiderTenant, transformations: {} }, { getObjectSize: () => Promise.resolve(csv.length), getObjectText: () => Promise.resolve(csv) })).rejects.toThrow(/not found/i);
    });

    it("refuses a positions session on another household's portfolio", async () => {
      const other = await seedHousehold(DI.em);
      const outsider = await DI.em.findOneOrFail(Appuser, { appuserKey: other.appuser.appuserKey }, { filters: false });

      await expect(portfolioImportSessionService.createSession({ appuser: outsider, correlationId: 'outsider', importType: PortfolioImportSessionType.POSITIONS, portfolioId: setup.portfolio.portfolioKey, s3Bucket: 'bucket', s3Key: 'key', tenant: { tenantKey: other.tenant.tenantKey } })).rejects.toThrow(/Portfolio not found/);
    });
  });
});
