import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortfolioColumnMappingTransformations } from '../portfolio-csv-column-mapping.schema';
import type { ConfirmPortfolioColumnMappingInput } from '../portfolio-csv-column-mapping.service';

const mocked = vi.hoisted(() => ({
  applyPortfolioCsvLayout: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  getLimitedCsvObjectText: vi.fn(),
  getOwnedSession: vi.fn(),
  parseCsvRows: vi.fn(),
  parseRawCsvRowsForLayout: vi.fn(),
  persist: vi.fn().mockReturnThis(),
  recordSpecFailureByKey: vi.fn(),
  resolveImportSessionAssets: vi.fn(),
  saveConfirmedSpec: vi.fn(),
  sentryCaptureMessage: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: { find: mocked.find, findOne: mocked.findOne, flush: vi.fn().mockResolvedValue(undefined), persist: mocked.persist } } }));
vi.mock('@service/account/csv-upload-boundary.service', () => ({ getLimitedCsvObjectText: mocked.getLimitedCsvObjectText, parseCsvRows: mocked.parseCsvRows }));
vi.mock('../portfolio-csv-layout.utils', () => ({ applyPortfolioCsvLayout: mocked.applyPortfolioCsvLayout, parseRawCsvRowsForLayout: mocked.parseRawCsvRowsForLayout }));
vi.mock('../portfolio-import-session.service', () => ({ default: { getOwnedSession: mocked.getOwnedSession } }));
vi.mock('../portfolio-import-asset-resolution.service', () => ({ default: { resolveImportSessionAssets: mocked.resolveImportSessionAssets } }));
vi.mock('../portfolio-import-parser-spec.service', () => ({
  buildPortfolioImportParserSpecPayload: (input: Record<string, unknown>) => ({ columns: {}, derivedValues: input['derivedValues'] ?? {}, fixedValueOrigins: {}, fixedValues: input['fixedValues'] ?? {}, layout: input['layout'], parser: 'column-mapping-v2', transformations: input['transformations'] ?? {} }),
  default: { recordSpecFailureByKey: mocked.recordSpecFailureByKey, saveConfirmedSpec: mocked.saveConfirmedSpec },
  hashPortfolioImportParserSpecPayload: () => 'confirmed-hash',
  resolveSpecColumnMapping: vi.fn(),
}));
vi.mock('@sentry/node', () => ({ captureMessage: mocked.sentryCaptureMessage }));

describe('portfolio csv column mapping confirmation service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.getLimitedCsvObjectText.mockReset();
    mocked.getOwnedSession.mockReset();
    mocked.saveConfirmedSpec.mockReset();
    mocked.saveConfirmedSpec.mockResolvedValue({ contentHash: 'candidate-hash-501', portfolioImportParserSpecKey: 501 });
    mocked.applyPortfolioCsvLayout.mockReset();
    mocked.parseRawCsvRowsForLayout.mockReset();
    mocked.parseCsvRows.mockReset();
    mocked.persist.mockReset();
    mocked.persist.mockReturnThis();
    mocked.persist.mockImplementation(() => ({ flush: vi.fn().mockResolvedValue(undefined) }));
    mocked.resolveImportSessionAssets.mockReset();
    mocked.recordSpecFailureByKey.mockReset();
    mocked.sentryCaptureMessage.mockReset();
    mocked.resolveImportSessionAssets.mockResolvedValue({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: 'ready_to_import', totalGroups: 0, unmatchedGroups: 0 });
  });

  const session = (overrides: Record<string, unknown> = {}) => ({ columnMappingJson: { suggestion: { confidence: 0.9 } }, financialBrokerKey: { financialBrokerKey: 7 }, portfolioImportSessionKey: 11, portfolioKey: { portfolioKey: 12 }, s3Bucket: 'bucket', s3Key: 'key.csv', status: 'needs_column_mapping', summaryJson: {}, tenantKey: { tenantKey: 2 }, ...overrides });
  const transformations: PortfolioColumnMappingTransformations = { dateFormat: 'yyyy-MM-dd', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' };
  const input = { appuser: { appuserKey: 1 } as unknown as ConfirmPortfolioColumnMappingInput['appuser'], columnMapping: { assetName: 'Asset', currency: 'Currency', externalTransactionId: 'ExtId', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date' }, importSessionId: 11, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, tenant: { tenantKey: 2 }, transformations };

  function withResolver(status = 'partial') {
    return vi.fn().mockResolvedValue({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status, totalGroups: 1, unmatchedGroups: 0 });
  }

  it('rejects incomplete confirmed mapping and does not persist', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([]);
    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { currency: 'Currency', quantity: 'Qty', transactionDate: 'Date' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] })).rejects.toThrow('Missing required mapping fields');
    expect(mocked.persist).not.toHaveBeenCalled();
    expect(mocked.saveConfirmedSpec).not.toHaveBeenCalled();
  });

  it('uses confirmed non-first header layout before normalizing rows', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseRawCsvRowsForLayout.mockReturnValue([['preamble'], ['Asset', 'Currency', 'Date', 'ExtId', 'Qty', 'Total'], ['ACME', 'EUR', '2025-01-01', 'abc-1', '2', '20'], ['footer']]);
    mocked.applyPortfolioCsvLayout.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, layout: { dataStartRowIndex: 2, footerRowCount: 1, headerRowIndex: 1 } })).resolves.toMatchObject({ duplicateRows: 0, invalidRows: 0, readyRows: 1, status: 'ready_to_import', totalRows: 1 });
    expect(mocked.applyPortfolioCsvLayout).toHaveBeenCalledWith([['preamble'], ['Asset', 'Currency', 'Date', 'ExtId', 'Qty', 'Total'], ['ACME', 'EUR', '2025-01-01', 'abc-1', '2', '20'], ['footer']], { dataStartRowIndex: 2, footerRowCount: 1, headerRowIndex: 1 });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ internalTransactionId: expect.stringMatching(/^portfolio-import:external:/), normalizedJson: expect.objectContaining({ assetSymbol: 'ACME', date: '2025-01-01T00:00:00.000Z', settlementCurrencyCode: 'EUR', transactionType: 'SELL' }), rawJson: { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }, status: 'ready' })]));
  });

  it('passes footer matcher layout through before row confirmation', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseRawCsvRowsForLayout.mockReturnValue([['Asset', 'Currency', 'Date', 'ExtId', 'Qty', 'Total'], ['ACME', 'EUR', '2025-01-01', 'abc-1', '2', '20'], ['Disclaimer', 'EUR', '2025-01-02', 'footer-1', '999', '999']]);
    mocked.applyPortfolioCsvLayout.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, layout: { dataStartRowIndex: 1, footerMatchers: ['disclaimer'], footerRowCount: 1, headerRowIndex: 0 } })).resolves.toMatchObject({ readyRows: 1, totalRows: 1 });
    expect(mocked.applyPortfolioCsvLayout).toHaveBeenCalledWith([['Asset', 'Currency', 'Date', 'ExtId', 'Qty', 'Total'], ['ACME', 'EUR', '2025-01-01', 'abc-1', '2', '20'], ['Disclaimer', 'EUR', '2025-01-02', 'footer-1', '999', '999']], { dataStartRowIndex: 1, footerMatchers: ['disclaimer'], footerRowCount: 1, headerRowIndex: 0 });
  });

  it('uses parseCsvRows for default layout and does not require layout helper', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ readyRows: 1, totalRows: 1 });
    expect(mocked.parseCsvRows).toHaveBeenCalledWith('csv');
    expect(mocked.parseRawCsvRowsForLayout).not.toHaveBeenCalled();
    expect(mocked.applyPortfolioCsvLayout).not.toHaveBeenCalled();
  });

  it('rejects invalid confirmed layout with a client error', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseRawCsvRowsForLayout.mockReturnValue([['Asset', 'Currency'], ['ACME', 'EUR']]);
    mocked.applyPortfolioCsvLayout.mockImplementation(() => { throw new Error('bad layout'); });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, layout: { dataStartRowIndex: 2, footerRowCount: 1, headerRowIndex: 1 } })).rejects.toThrow('Invalid CSV layout');
    expect(mocked.persist).not.toHaveBeenCalled();
    expect(mocked.saveConfirmedSpec).not.toHaveBeenCalled();
  });

  it('saves reusable parser spec after successful confirmation', async () => {
    mocked.getOwnedSession.mockResolvedValue(session({ columnMappingJson: { source: 'spec', suggestion: { confidence: 0.9 } } }));
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping(input);

    expect(mocked.saveConfirmedSpec).toHaveBeenCalledWith(expect.objectContaining({ appuser: input.appuser, columnMapping: input.columnMapping, headers: ['Asset', 'Currency', 'Date', 'ExtId', 'Qty', 'Total'], layout: input.layout, suggestionSource: 'spec', tenant: input.tenant, transformations: input.transformations }));
    expect((mocked.persist.mock.calls.at(-1)?.[0] as { columnMappingJson?: Record<string, unknown> }).columnMappingJson).toMatchObject({ candidateParserSpecContentHash: 'candidate-hash-501', candidateParserSpecKey: 501, parserSpecKey: 501, parserSpecPromotion: { status: 'awaiting_finalization' } });
  });

  it('calls asset resolver after confirming mapped rows', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const resolveImportSessionAssets = withResolver();
    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping(input, { resolveImportSessionAssets });

    expect(mocked.persist).toHaveBeenCalledTimes(3);
    expect(resolveImportSessionAssets).toHaveBeenCalledWith({ importSessionId: 11 });
    expect(resolveImportSessionAssets.mock.invocationCallOrder[0]!).toBeGreaterThan(mocked.persist.mock.invocationCallOrder[0]!);
  });

  it('preserves assetGroups summary when resolver updates status', async () => {
    const ownedSession = session({ summaryJson: { existing: true } });
    mocked.getOwnedSession.mockResolvedValue(ownedSession);
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockImplementation(() => {
      ownedSession.summaryJson = { ...ownedSession.summaryJson, assetGroups: { matchedGroups: 1 }, resolverNote: 'set by resolver' };
      return Promise.resolve({ ambiguousGroups: 2, matchedGroups: 0, providerErrorGroups: 0, status: 'needs_asset_review', totalGroups: 1, unmatchedGroups: 1 });
    });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping(input);

    expect((mocked.persist.mock.calls.at(-1)?.[0] as undefined | { summaryJson?: Record<string, unknown> })?.summaryJson).toEqual(expect.objectContaining({ assetGroups: { matchedGroups: 1 }, existing: true, resolverNote: 'set by resolver', status: 'needs_asset_review' }));
  });

  it('returns and persists post-resolution mixed supported and skipped counts', async () => {
    const ownedSession = session();
    mocked.getOwnedSession.mockResolvedValue(ownedSession);
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue(Array.from({ length: 77 }, (_, index) => ({ Asset: `Asset ${index}`, Currency: 'EUR', Date: '2025-01-01', ExtId: `row-${index}`, Qty: '2', Total: '20' })));
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockImplementation(() => {
      ownedSession.status = 'partial';
      ownedSession.summaryJson = {
        ...ownedSession.summaryJson,
        assetGroups: { ambiguousGroups: 0, matchedGroups: 11, providerErrorGroups: 0, skippedGroups: 1, totalGroups: 12, unmatchedGroups: 1 },
        blockingRows: 46,
        canConfirm: true,
        duplicateRows: 0,
        importableRows: 31,
        invalidRows: 0,
        needsAssetReviewRows: 0,
        readyRows: 31,
        skippedRows: 46,
        status: 'partial',
        totalRows: 77,
        unsupportedAssets: [{ skippedRows: 46, symbol: 'EUR.USD' }],
      };
      return Promise.resolve({ ambiguousGroups: 0, matchedGroups: 11, providerErrorGroups: 0, status: 'partial', totalGroups: 12, unmatchedGroups: 1 });
    });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    const result = await service.confirmColumnMapping(input);

    expect(result).toMatchObject({ canConfirm: true, importableRows: 31, needsAssetReviewRows: 0, readyRows: 31, skippedRows: 46, status: 'partial', unsupportedAssets: [{ skippedRows: 46, symbol: 'EUR.USD' }] });
    expect(ownedSession.summaryJson).toMatchObject({ assetGroups: { matchedGroups: 11, skippedGroups: 1, unmatchedGroups: 1 }, importableRows: 31, readyRows: 31, skippedRows: 46, unsupportedAssets: [{ skippedRows: 46, symbol: 'EUR.USD' }] });
    expect((mocked.persist.mock.calls.at(-1)?.[0] as undefined | { summaryJson?: Record<string, unknown> })?.summaryJson).toEqual(ownedSession.summaryJson);
  });

  it('keeps all-supported resolver counts ready and unskipped', async () => {
    const ownedSession = session();
    mocked.getOwnedSession.mockResolvedValue(ownedSession);
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue(Array.from({ length: 9 }, (_, index) => ({ Asset: `Asset ${index}`, Currency: 'EUR', Date: '2025-01-01', ExtId: `degiro-${index}`, Qty: '2', Total: '20' })));
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockImplementation(() => {
      ownedSession.status = 'ready_to_import';
      ownedSession.summaryJson = { ...ownedSession.summaryJson, canConfirm: true, importableRows: 9, needsAssetReviewRows: 0, readyRows: 9, skippedRows: 0, status: 'ready_to_import', totalRows: 9, unsupportedAssets: [] };
      return Promise.resolve({ ambiguousGroups: 0, matchedGroups: 9, providerErrorGroups: 0, status: 'ready_to_import', totalGroups: 9, unmatchedGroups: 0 });
    });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ canConfirm: true, importableRows: 9, readyRows: 9, skippedRows: 0, status: 'ready_to_import', unsupportedAssets: [] });
  });

  it('persists recoverable resolver failures and resolves with needs asset review', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockRejectedValueOnce(new Error('resolver boom'));

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ status: 'needs_asset_review' });
  });

  it('marks session needs asset review when resolver throws', async () => {
    const ownedSession = session();
    mocked.getOwnedSession.mockResolvedValue(ownedSession);
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockRejectedValueOnce(new Error('resolver boom'));

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ status: 'needs_asset_review' });

    expect((ownedSession as { status: string; summaryJson?: Record<string, unknown> }).status).toBe('needs_asset_review');
    expect((ownedSession as { summaryJson?: Record<string, unknown> }).summaryJson).toEqual(expect.objectContaining({ assetResolutionError: { code: 'ASSET_RESOLUTION_FAILED', message: 'resolver boom' } }));
  });

  it('returns needs asset review when resolver requests it', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const resolveImportSessionAssets = withResolver('needs_asset_review');
    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input, { resolveImportSessionAssets })).resolves.toMatchObject({ status: 'needs_asset_review' });
  });

  it('parses localized numeric values and date format', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '31/12/2025', Qty: '1.234,56', Total: '12.345,67' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-12-31T00:00:00.000Z', quantity: 1234.56, totalAmount: 12345.67 }) })]));
  });

  it('parses hyphenated day-first dates when dateFormat is dd-MM-yyyy', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '15-08-2025', Qty: '1', Total: '10' }, { Asset: 'ACME', Currency: 'EUR', Date: '31-03-2025', Qty: '1', Total: '10' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'dd-MM-yyyy', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 0, readyRows: 2, status: 'ready_to_import', totalRows: 2 });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-08-15T00:00:00.000Z' }) })]));
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-03-31T00:00:00.000Z' }) })]));
  });

  it('parses uppercase date format aliases', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '12-06-2026', Qty: '1', Total: '10' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'DD-MM-YYYY', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ readyRows: 1, status: 'ready_to_import' });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2026-06-12T00:00:00.000Z' }) })]));
  });

  it('resolves wrong yyyy-MM-dd metadata to day-first for disambiguating samples and persists corrected transformations', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '12-06-2026', Qty: '1', Total: '10' }, { Asset: 'ACME', Currency: 'EUR', Date: '15-08-2025', Qty: '1', Total: '10' }, { Asset: 'ACME', Currency: 'EUR', Date: '31-03-2025', Qty: '1', Total: '10' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.', negativeAmountMeansBuy: true, thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 0, readyRows: 3, status: 'ready_to_import', totalRows: 3 });
    expect((mocked.persist.mock.calls[0]![0] as { columnMappingJson?: { confirmed?: { transformations?: { dateFormat?: string } } } }[])[0]!.columnMappingJson?.confirmed?.transformations?.dateFormat).toBe('dd/MM/yyyy');
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2026-06-12T00:00:00.000Z' }) })]));
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-08-15T00:00:00.000Z' }) })]));
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-03-31T00:00:00.000Z' }) })]));
  });

  it('keeps explicit month-first date format when it parses all ambiguous samples', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '04-05-2025', Qty: '1', Total: '10' }, { Asset: 'ACME', Currency: 'EUR', Date: '06-07-2025', Qty: '1', Total: '10' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'MM/dd/yyyy', decimalSeparator: '.', negativeAmountMeansBuy: true, thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 0, readyRows: 2, status: 'ready_to_import' });
    expect((mocked.persist.mock.calls[0]![0] as { columnMappingJson?: { confirmed?: { transformations?: { dateFormat?: string } } } }[])[0]!.columnMappingJson?.confirmed?.transformations?.dateFormat).toBe('MM/dd/yyyy');
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-04-05T00:00:00.000Z' }) })]));
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-06-07T00:00:00.000Z' }) })]));
  });

  it('falls back to day-first when ambiguous samples cannot be parsed by configured metadata', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '04-05-2025', Qty: '1', Total: '10' }, { Asset: 'ACME', Currency: 'EUR', Date: '06-07-2025', Qty: '1', Total: '10' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'bad-format', decimalSeparator: '.', negativeAmountMeansBuy: true, thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 0, readyRows: 2, status: 'ready_to_import' });
    expect((mocked.persist.mock.calls[0]![0] as { columnMappingJson?: { confirmed?: { transformations?: { dateFormat?: string } } } }[])[0]!.columnMappingJson?.confirmed?.transformations?.dateFormat).toBe('dd/MM/yyyy');
  });

  it('uses fixed currency when the file has no currency column', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Date: '2025-01-01', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { assetName: 'Asset', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], fixedValues: { currency: 'EUR' } as unknown as ConfirmPortfolioColumnMappingInput['fixedValues'], transformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ settlementCurrencyCode: 'EUR' }) })]));
  });

  it('uses fixed transaction type when the file has no type column', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], fixedValues: { transactionType: 'BUY' } as unknown as ConfirmPortfolioColumnMappingInput['fixedValues'], transformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ transactionType: 'BUY' }) })]));
  });

  it('derives transaction type from signed total amount', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '-20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], derivedValues: { transactionType: 'totalAmountSign' } as unknown as ConfirmPortfolioColumnMappingInput['derivedValues'], transformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ transactionType: 'BUY' }) })]));
  });

  it('parses compact broker dates', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '20250131', Qty: '2', Total: '20' }, { Asset: 'ACME', Currency: 'EUR', Date: '20250131;235959', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyyMMdd', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ date: '2025-01-31T00:00:00.000Z' }) })]));
  });

  it('derives unit price from localized total amount and quantity', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '1.234,56' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ unitPrice: 617.28 }) })]));
  });

  it('derives unit price when mapped unit price cell is blank', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '20', UnitPrice: '   ' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date', unitPrice: 'UnitPrice' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ unitPrice: 10 }) })]));
  });

  it('rejects blank required cells', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: ' ', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '20' }, { Asset: 'ACME', Currency: ' ', Date: '2025-01-01', Qty: '2', Total: '20' }, { Asset: 'ACME', Currency: 'EUR', Date: ' ', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] })).resolves.toMatchObject({ invalidRows: 3 });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ status: 'invalid' })]));
  });

  it('falls back to row hash for blank external ids', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: '   ', Qty: '2', Total: '20' }, { Asset: 'BETA', Currency: 'EUR', Date: '2025-01-01', ExtId: '   ', Qty: '2', Total: '20' }]);
    await service.confirmColumnMapping(input);
    const rows = (mocked.persist.mock.calls[0]![0] as { internalTransactionId: string }[]).slice(1);
    expect(rows[0]!.internalTransactionId).toMatch(/^portfolio-import:row-hash:/);
    expect(rows[1]!.internalTransactionId).toMatch(/^portfolio-import:row-hash:/);
    expect(rows[0]!.internalTransactionId).not.toBe(rows[1]!.internalTransactionId);
  });

  it('invalidates impossible calendar dates', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '31/02/2025', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 1 });
    expect(mocked.sentryCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it('invalidates impossible iso-like dates', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-02-31', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { decimalSeparator: ',', negativeAmountMeansBuy: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations })).resolves.toMatchObject({ invalidRows: 1 });
  });

  it('marks invalid rows and partial session', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: 'bad', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] })).resolves.toMatchObject({ invalidRows: 1, status: 'partial' });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ failureReason: expect.any(String), status: 'invalid' })]));
  });

  it('records applied spec failure for unchanged confirmed mapping with invalid rows', async () => {
    mocked.getOwnedSession.mockResolvedValue(session({ columnMappingJson: { parserSpecContentHash: 'confirmed-hash', parserSpecKey: 77, source: 'spec' } }));
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: 'bad', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] });

    expect(mocked.recordSpecFailureByKey).toHaveBeenCalledWith({ contentHash: 'confirmed-hash', parserSpecKey: 77 });
  });

  it('marks duplicate rows with skip reason', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue({ transactionKey: 1 });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ duplicateRows: 1, status: 'partial' });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ skipReason: 'Duplicate internalTransactionId', status: 'duplicate' })]));
  });

  it('creates duplicate rows for repeated internal ids in file', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'same', Qty: '2', Total: '20' }, { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'same', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ duplicateRows: 1, readyRows: 1, status: 'partial' });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ skipReason: 'Duplicate internalTransactionId', status: 'duplicate' })]));
  });

  it('uses quantity sign direction when configured', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '-2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: ',', quantitySignIndicatesDirection: true, thousandsSeparator: '.' } as PortfolioColumnMappingTransformations });
    expect(mocked.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ normalizedJson: expect.objectContaining({ quantity: 2, transactionType: 'SELL' }) })]));
  });

  it('stores explicit SELL quantities as positive magnitudes regardless of source sign', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([
      { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'sell-negative', Qty: '-6', Total: '60', Type: 'Sell' },
      { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-02', ExtId: 'sell-positive', Qty: '6', Total: '60', Type: 'Sell' },
    ]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, transactionType: 'Type' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.', thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations });

    const rows = ((mocked.persist.mock.calls[0]?.[0] as undefined | { normalizedJson?: Record<string, unknown> }[]) ?? []).slice(1);
    expect(rows.map((row) => row.normalizedJson)).toEqual([
      expect.objectContaining({ quantity: 6, transactionType: 'SELL' }),
      expect.objectContaining({ quantity: 6, transactionType: 'SELL' }),
    ]);
  });

  it('derives direction from signed quantity before storing its positive magnitude', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([
      { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'derived-sell', Qty: '-6', Total: '60' },
      { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-02', ExtId: 'derived-buy', Qty: '6', Total: '60' },
    ]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, derivedValues: { transactionType: 'quantitySign' } as unknown as ConfirmPortfolioColumnMappingInput['derivedValues'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.', thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations });

    const rows = ((mocked.persist.mock.calls[0]?.[0] as undefined | { normalizedJson?: Record<string, unknown> }[]) ?? []).slice(1);
    expect(rows.map((row) => row.normalizedJson)).toEqual([
      expect.objectContaining({ quantity: 6, transactionType: 'SELL' }),
      expect.objectContaining({ quantity: 6, transactionType: 'BUY' }),
    ]);
  });

  it('canonicalizes explicit and sign-derived negative SELL rows to the same fallback id', async () => {
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    const { default: service } = await import('../portfolio-csv-column-mapping.service');

    mocked.getOwnedSession.mockResolvedValueOnce(session());
    mocked.parseCsvRows.mockReturnValueOnce([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '-6', Total: '60', Type: 'Sell' }]);
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined, transactionType: 'Type' } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.', thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations });
    const explicitRow = (mocked.persist.mock.calls[0]?.[0] as undefined | { internalTransactionId?: string; normalizedJson?: Record<string, unknown> }[])?.[1];
    if (!explicitRow) throw new Error('Expected explicit SELL row');

    mocked.getOwnedSession.mockResolvedValueOnce(session());
    mocked.parseCsvRows.mockReturnValueOnce([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '-6', Total: '60' }]);
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], transformations: { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.', quantitySignIndicatesDirection: true, thousandsSeparator: 'none' } as PortfolioColumnMappingTransformations });
    const derivedRow = (mocked.persist.mock.calls[3]?.[0] as undefined | { internalTransactionId?: string; normalizedJson?: Record<string, unknown> }[])?.[1];
    if (!derivedRow) throw new Error('Expected sign-derived SELL row');

    expect(explicitRow.normalizedJson).toEqual(expect.objectContaining({ quantity: 6, transactionType: 'SELL' }));
    expect(derivedRow.normalizedJson).toEqual(expect.objectContaining({ quantity: 6, transactionType: 'SELL' }));
    expect(explicitRow.internalTransactionId).toBe(derivedRow.internalTransactionId);
  });

  it('uses deterministic external hash ids and row-hash ids', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    await service.confirmColumnMapping(input);
    const extId = (mocked.persist.mock.calls[0]![0] as { internalTransactionId: string }[])[1]!.internalTransactionId;
    mocked.persist.mockReset();
    mocked.persist.mockImplementation(() => ({ flush: vi.fn().mockResolvedValue(undefined) }));
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '20' }]);
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] });
    const rowHashId = (mocked.persist.mock.calls[0]![0] as { internalTransactionId: string }[])[1]!.internalTransactionId;
    expect(extId).toMatch(/^portfolio-import:external:/);
    expect(rowHashId).toMatch(/^portfolio-import:row-hash:/);
  });

  it('soft deletes existing draft rows and never persists transactions', async () => {
    const existing = [{ deletedAt: undefined }];
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue(existing);
    mocked.findOne.mockResolvedValue(null);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'] });
    expect(existing[0]!.deletedAt).toBeInstanceOf(Date);
    expect(mocked.persist).not.toHaveBeenCalledWith(expect.objectContaining({ transactionKey: expect.anything() }));
  });

  it('never persists final financial transactions during confirmation', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);

    const resolveImportSessionAssets = withResolver();
    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping(input, { resolveImportSessionAssets });

    const persisted = mocked.persist.mock.calls.reduce<unknown[]>((acc, [value]) => acc.concat(Array.isArray(value) ? value : [value]), []);
    expect(persisted.some((value) => value?.constructor?.name === 'FinancialTransaction')).toBe(false);
  });

  it('does not call resolver for duplicate-only or invalid-only outcomes', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue({ transactionKey: 1 });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.confirmColumnMapping(input);
    expect(mocked.resolveImportSessionAssets).not.toHaveBeenCalled();

    mocked.getOwnedSession.mockResolvedValue(session({ portfolioImportSessionKey: 12 }));
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', Qty: 'bad', Total: '20' }]);
    await service.confirmColumnMapping({ ...input, columnMapping: { ...input.columnMapping, externalTransactionId: undefined } as unknown as ConfirmPortfolioColumnMappingInput['columnMapping'], importSessionId: 12 });
    expect(mocked.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('keeps partial when resolver returns ready_to_import', async () => {
    mocked.getOwnedSession.mockResolvedValue(session());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }, { Asset: 'ACME', Currency: 'EUR', Date: '2025-01-01', ExtId: 'abc-1', Qty: '2', Total: '20' }]);
    mocked.find.mockResolvedValue([]);
    mocked.findOne.mockResolvedValue(null);
    mocked.resolveImportSessionAssets.mockResolvedValueOnce({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: 'ready_to_import', totalGroups: 1, unmatchedGroups: 0 });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.confirmColumnMapping(input)).resolves.toMatchObject({ duplicateRows: 1, invalidRows: 0, readyRows: 1, skippedRows: 0, status: 'partial' });
  });
});
