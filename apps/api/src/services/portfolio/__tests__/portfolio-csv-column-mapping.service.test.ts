import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';

const mocked = vi.hoisted(() => ({
  findActiveSpecForShape: vi.fn(),
  getLimitedCsvObjectText: vi.fn(),
  getOwnedSession: vi.fn(),
  isExpired: vi.fn(),
  parseCsvRows: vi.fn(),
  persist: vi.fn().mockReturnThis(),
  recordSpecFailure: vi.fn(),
  recordSpecSuccess: vi.fn(),
  requestPortfolioColumnMappingSuggestion: vi.fn(),
  resolveImportSessionAssets: vi.fn(),
  resolveSpecColumnMapping: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: { flush: vi.fn().mockResolvedValue(undefined), persist: mocked.persist } } }));
vi.mock('@service/account/csv-upload-boundary.service', () => ({ getLimitedCsvObjectText: mocked.getLimitedCsvObjectText, parseCsvRows: mocked.parseCsvRows }));
vi.mock('../portfolio-import-session.service', () => ({ default: { getOwnedSession: mocked.getOwnedSession, isExpired: mocked.isExpired } }));
vi.mock('../portfolio-import-asset-resolution.service', () => ({ default: { resolveImportSessionAssets: mocked.resolveImportSessionAssets } }));
vi.mock('../portfolio-import-parser-spec.service', () => ({
  default: { findActiveSpecForShape: mocked.findActiveSpecForShape, recordSpecFailure: mocked.recordSpecFailure, recordSpecSuccess: mocked.recordSpecSuccess },
  parsePortfolioImportParserSpecPayload: (value: unknown) => value,
  recordSpecFailure: mocked.recordSpecFailure,
  resolveSpecColumnMapping: mocked.resolveSpecColumnMapping,
}));
vi.mock('../portfolio-csv-column-mapping-openai', () => ({
  requestPortfolioColumnMappingSuggestion: mocked.requestPortfolioColumnMappingSuggestion,
  sanitizePortfolioColumnMappingPromptInput: (input: { headers: string[]; rowShapes?: { cellCount: number; emptyCellCount: number; nonEmptyCellCount: number }[]; sampleRows?: { emptyCellCount: number; hasNumericCells: boolean; hasTextCells: boolean; headerCount: number; nonEmptyCellCount: number; rowIndex: number; }[] }) => ({
    headers: input.headers.slice(0, 40).map((header) => header.slice(0, 80)),
    rowShapes: (input.rowShapes ?? []).slice(0, 12),
    sampleRows: (input.sampleRows ?? []).slice(0, 5),
  }),
}));

describe('portfolio csv column mapping service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.getLimitedCsvObjectText.mockReset();
    mocked.parseCsvRows.mockReset();
    mocked.persist.mockReset();
    mocked.persist.mockReturnThis();
    mocked.getOwnedSession.mockReset();
    mocked.isExpired.mockReset();
    mocked.isExpired.mockReturnValue(false);
    mocked.requestPortfolioColumnMappingSuggestion.mockReset();
    mocked.findActiveSpecForShape.mockReset();
    mocked.recordSpecFailure.mockReset();
    mocked.recordSpecSuccess.mockReset();
    mocked.resolveSpecColumnMapping.mockReset();
    mocked.resolveImportSessionAssets.mockReset();
  });

  const buildSession = (overrides: Partial<Record<string, unknown>> = {}) => ({ columnMappingJson: undefined, portfolioImportSessionKey: 11, s3Bucket: 'bucket', s3Key: 'key.csv', status: 'needs_column_mapping', summaryJson: {}, ...overrides });
  const completeResolvedMapping = { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', transactionDate: 'Date', transactionType: 'Type', unitPrice: 'Price' };

  it('calls llm even when generic headers look deterministic and no spec matches', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2024-01-01', Price: '2', Qty: '1' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, detectedBroker: null, layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 }, transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null }, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { confidence: 0.8 }, importSessionId: 11, mappingSource: 'llm', status: 'needs_column_mapping' });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ source: 'llm' }) }));
  });

  it('calls llm without consent after saved spec and local heuristic miss', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, detectedBroker: null, layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 }, transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null }, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ importSessionId: 11, mappingSource: 'llm' });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
  });

  it('uses active parser spec without llm after resolving columns', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Currency: 'EUR', Date: '2024-01-01', Price: '2', Qty: '1', Type: 'BUY' }]);
    mocked.findActiveSpecForShape.mockResolvedValue({ portfolioImportParserSpecKey: 77, specJson: { columns: { assetName: { normalizedHeader: 'asset' }, currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'qty' }, transactionDate: { normalizedHeader: 'date' }, transactionType: { normalizedHeader: 'type' }, unitPrice: { normalizedHeader: 'price' } }, derivedValues: {}, fixedValueOrigins: {}, fixedValues: {}, layout: { dataStartRowIndex: 2, headerRowIndex: 1 }, parser: 'column-mapping-v2', transformations: { dateFormat: 'yyyy-MM-dd' } } });
    mocked.resolveSpecColumnMapping.mockReturnValue(completeResolvedMapping);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { columnMapping: completeResolvedMapping, confidence: 1 }, importSessionId: 11, mappingSource: 'saved_spec' });
    expect(mocked.requestPortfolioColumnMappingSuggestion).not.toHaveBeenCalled();
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ parserSpecKey: 77, source: 'spec' }) }));
  });

  it('restores complete cross-tenant global payload without llm', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession({ financialBrokerKey: { financialBrokerKey: 7 } }));
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Asset: 'ACME', Date: '2025-01-01', Price: '10', Qty: '-2' }]);
    const globalSpec = { portfolioImportParserSpecKey: 701, scope: 'global', specJson: { columns: { assetName: { normalizedHeader: 'asset' }, quantity: { normalizedHeader: 'qty' }, transactionDate: { normalizedHeader: 'date' }, unitPrice: { normalizedHeader: 'price' } }, derivedValues: { transactionType: 'quantitySign' }, fixedValueOrigins: {}, fixedValues: { currency: 'EUR' }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, parser: 'column-mapping-v2', transformations: { decimalSeparator: '.' } } };
    mocked.findActiveSpecForShape.mockResolvedValue(globalSpec);
    mocked.resolveSpecColumnMapping.mockReturnValue({ assetName: 'Asset', quantity: 'Qty', transactionDate: 'Date', unitPrice: 'Price' });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 2 } as Appuser, importSessionId: 11, tenant: { tenantKey: 99 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { derivedValues: { transactionType: 'quantitySign' }, fixedValues: { currency: 'EUR' }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: { decimalSeparator: '.' } }, mappingSource: 'saved_spec' });
    expect(mocked.findActiveSpecForShape).toHaveBeenCalledWith(expect.objectContaining({ broker: { financialBrokerKey: 7 }, tenant: { tenantKey: 99 } }));
    expect(mocked.requestPortfolioColumnMappingSuggestion).not.toHaveBeenCalled();
    expect(mocked.recordSpecSuccess).not.toHaveBeenCalled();
  });

  it('falls back to llm when spec validation fails and records failure', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue({ portfolioImportParserSpecKey: 88, specJson: { columns: { transactionDate: { normalizedHeader: 'date' } }, layout: { dataStartRowIndex: 0, headerRowIndex: 0 }, transformations: { decimalSeparator: '.', thousandsSeparator: '.' } } });
    mocked.resolveSpecColumnMapping.mockReturnValue({ transactionDate: 'Date' });
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, detectedBroker: null, layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 }, transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null }, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { confidence: 0.8 }, importSessionId: 11, mappingSource: 'llm' });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ source: 'llm' }) }));
    expect(mocked.recordSpecFailure).toHaveBeenCalledWith(expect.objectContaining({ portfolioImportParserSpecKey: 88 }));
  });

  it('passes shaped data to llm suggestion', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('Date,Foo\n2024-01-01,bar');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalledWith(expect.objectContaining({ headers: ['Date', 'Foo'], rowShapes: expect.any(Array), sampleRows: expect.any(Array) }));
  });

  it('normalizes llm headers and converts embedded currency headers to fixed values', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('Date,Quantity,Price,Value EUR,Product\n2024-01-01,2,10,20,ACME');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Price: '10', Product: 'ACME', Quantity: '2', 'Value EUR': '20' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { assetName: 'Product', currency: 'Value EUR', quantity: 'Quantity', totalAmount: 'Value EUR', transactionDate: 'Date', unitPrice: 'Price ' }, confidence: 0.95, detectedBroker: null, layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 }, transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null }, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    const result = await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });

    expect(result.columnMapping).toEqual(expect.objectContaining({ columnMapping: expect.objectContaining({ currency: undefined, unitPrice: 'Price' }), fixedValues: { currency: 'EUR' } }));
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ suggestion: expect.objectContaining({ fixedValues: { currency: 'EUR' } }) }) }));
  });

  it('uses non-default layout spec from rawRows and skips llm', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('Note,ignore\nDate,Foo\n2024-01-01,bar');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ portfolioImportParserSpecKey: 91, specJson: { columns: { assetName: { normalizedHeader: 'asset' }, currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'qty' }, transactionDate: { normalizedHeader: 'date' }, transactionType: { normalizedHeader: 'type' }, unitPrice: { normalizedHeader: 'price' } }, derivedValues: {}, fixedValueOrigins: {}, fixedValues: {}, layout: { dataStartRowIndex: 2, headerRowIndex: 1 }, parser: 'column-mapping-v2', transformations: {} } });
    mocked.resolveSpecColumnMapping.mockReturnValue(completeResolvedMapping);

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { columnMapping: completeResolvedMapping, confidence: 1 }, importSessionId: 11 });
    expect(mocked.requestPortfolioColumnMappingSuggestion).not.toHaveBeenCalled();
    expect(mocked.findActiveSpecForShape).toHaveBeenNthCalledWith(1, expect.objectContaining({ headers: ['Date', 'Foo'] }));
    expect(mocked.findActiveSpecForShape).toHaveBeenNthCalledWith(2, expect.objectContaining({ headers: ['Note', 'ignore'] }));
    expect(mocked.findActiveSpecForShape).toHaveBeenNthCalledWith(3, expect.objectContaining({ headers: ['Date', 'Foo'] }));
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ parserSpecKey: 91, source: 'spec' }) }));
  });

  it('falls back to llm when spec resolves to no columns', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue({ portfolioImportParserSpecKey: 77, specJson: { columns: { transactionDate: { normalizedHeader: 'date' } }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {} } });
    mocked.resolveSpecColumnMapping.mockReturnValue({});
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
  });

  it('falls back to llm when spec resolves to incomplete required mapping', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('Date,Foo\n2024-01-01,bar');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue({ portfolioImportParserSpecKey: 77, specJson: { columns: { transactionDate: { normalizedHeader: 'date' } }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {} } });
    mocked.resolveSpecColumnMapping.mockReturnValue({ transactionDate: 'Date' });
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
    expect(mocked.recordSpecFailure).toHaveBeenCalledWith(expect.objectContaining({ portfolioImportParserSpecKey: 77 }));
  });

  it('still calls llm with raw rows when parsed rows fail', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('Generated by Broker\nDate,Foo\n2024-01-01,bar');
    mocked.parseCsvRows.mockImplementation(() => { throw new Error('Invalid Record Length'); });
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 2, headerRowIndex: 1 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalledWith(expect.objectContaining({ headers: [], rowShapes: expect.any(Array), sampleRows: [] }));
  });

  it('falls back to llm when spec columns are malformed and records failure', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue({ portfolioImportParserSpecKey: 77, specJson: { columns: null, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {} } });
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).resolves.toMatchObject({ columnMapping: { confidence: 0.8 }, importSessionId: 11, mappingSource: 'llm' });
    expect(mocked.requestPortfolioColumnMappingSuggestion).toHaveBeenCalled();
    expect(mocked.recordSpecFailure).toHaveBeenCalledWith(expect.objectContaining({ portfolioImportParserSpecKey: 77 }));
  });

  it('never exposes or persists provider details on llm failure', async () => {
    const session = buildSession();
    const providerError = '401 secret provider detail';
    const safeWarning = 'Automatic column mapping suggestion is unavailable';
    mocked.getOwnedSession.mockResolvedValue(session);
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockRejectedValue(new Error(providerError));

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    const result = await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });

    expect(result).toMatchObject({ importSessionId: 11, mappingSource: 'disabled', status: 'needs_column_mapping', warning: safeWarning });
    expect(session.columnMappingJson).toEqual(expect.objectContaining({ source: 'error', warning: safeWarning }));
    expect(session.summaryJson).toEqual(expect.objectContaining({ columnMappingWarning: safeWarning }));
    expect(JSON.stringify({ result, session })).not.toContain(providerError);
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ columnMappingJson: expect.objectContaining({ source: 'error', warning: safeWarning }), summaryJson: expect.objectContaining({ columnMappingWarning: safeWarning }) }));
  });

  it('rejects sessions not needing column mapping', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession({ status: 'ready_to_import' }));
    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await expect(service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows })).rejects.toThrow('Import session does not need column mapping');
  });

  it('does not create rows or transactions', async () => {
    mocked.getOwnedSession.mockResolvedValue(buildSession());
    mocked.getLimitedCsvObjectText.mockResolvedValue('csv');
    mocked.parseCsvRows.mockReturnValue([{ Date: '2024-01-01', Foo: 'bar' }]);
    mocked.findActiveSpecForShape.mockResolvedValue(undefined);
    mocked.requestPortfolioColumnMappingSuggestion.mockResolvedValue({ suggestion: { columnMapping: { transactionDate: 'Date' }, confidence: 0.8, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: [] }, tokens: { completionTokens: 1, promptTokens: 2, totalTokens: 3 } });

    const { default: service } = await import('../portfolio-csv-column-mapping.service');
    await service.suggestColumnMapping({ appuser: { appuserKey: 1 } as Appuser, importSessionId: 11, tenant: { tenantKey: 2 } }, { getObjectText: () => Promise.resolve('csv'), parseCsvRows: mocked.parseCsvRows });
    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ portfolioImportSessionKey: 11, s3Bucket: 'bucket', s3Key: 'key.csv' }));
    expect(mocked.persist).not.toHaveBeenCalledWith(expect.objectContaining({ rawJson: expect.anything() }));
    expect(mocked.persist).not.toHaveBeenCalledWith(expect.objectContaining({ internalTransactionId: expect.anything() }));
  });
});
