import type { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';
import type { PortfolioImportParserSpec } from '@entity/PortfolioImportParserSpec';

import type { PortfolioImportParserSpecPayload } from '../portfolio-import-parser-spec.service';

const mocked = vi.hoisted(() => {
  const em = { create: vi.fn(), execute: vi.fn(), find: vi.fn(), findOne: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), getConnection: vi.fn(), persist: vi.fn().mockReturnThis(), transactional: vi.fn() };
  em.transactional.mockImplementation(async (callback: (nested: typeof em) => Promise<unknown>) => callback(em));
  return { em };
});

vi.mock('@app/database/di', () => ({ DI: { em: mocked.em } }));

const appuserFixture = { appuserKey: 1 } as unknown as Appuser;
const emMock = mocked.em as unknown as EntityManager;
// Entity fixtures drive the service through the few fields each method actually reads.
const specFixture = (value: object): PortfolioImportParserSpec => value as PortfolioImportParserSpec;

describe('portfolio import parser spec service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.em.create.mockReset();
    mocked.em.find.mockReset();
    mocked.em.findOne.mockReset().mockResolvedValue(null);
    mocked.em.execute.mockReset().mockResolvedValue([]);
    mocked.em.getConnection.mockReset().mockReturnValue({ execute: mocked.em.execute });
    mocked.em.flush.mockReset().mockResolvedValue(undefined);
    mocked.em.persist.mockReset();
    mocked.em.persist.mockReturnThis();
    mocked.em.transactional.mockClear();
  });

  it('builds stable fingerprints and resolves mappings', async () => {
    const { buildPortfolioCsvShapeFingerprint, buildSpecColumnsFromMapping, resolveSpecColumnMapping } = await import('../portfolio-import-parser-spec.service');
    const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
    const a = buildPortfolioCsvShapeFingerprint({ headers: ['Asset_Name', 'Date'], layout });
    const b = buildPortfolioCsvShapeFingerprint({ headers: ['asset name', 'DATE'], layout });
    expect(a.headerOrderHash).toBe(b.headerOrderHash);
    expect(a.headerSetHash).toBe(b.headerSetHash);
    expect(a.shapeHash).toBe(b.shapeHash);
    const c = buildPortfolioCsvShapeFingerprint({ headers: ['Date', 'Asset Name'], layout });
    expect(c.headerOrderHash).not.toBe(a.headerOrderHash);
    expect(c.headerSetHash).toBe(a.headerSetHash);
    const withFooter = buildPortfolioCsvShapeFingerprint({ headers: ['Asset_Name', 'Date'], layout: { ...layout, footerRowCount: 1 } });
    const withFooterMatcher = buildPortfolioCsvShapeFingerprint({ headers: ['Asset_Name', 'Date'], layout: { ...layout, footerMatchers: ['Total'] } });
    expect(withFooter.headerSetHash).toBe(a.headerSetHash);
    expect(withFooter.shapeHash).not.toBe(a.shapeHash);
    expect(withFooterMatcher.shapeHash).not.toBe(a.shapeHash);

    expect(resolveSpecColumnMapping({ actualHeaders: ['Date', 'Asset Name', 'asset_name'], columns: { assetName: { normalizedHeader: 'asset name', occurrence: 1 }, missing: { normalizedHeader: 'unknown' }, transactionDate: { normalizedHeader: 'date' } } })).toEqual({ assetName: 'asset_name', transactionDate: 'Date' });
    expect(buildSpecColumnsFromMapping({ columnMapping: { assetName: 'Asset_Name', transactionDate: ' Trade_Date ' } })).toEqual({ assetName: { normalizedHeader: 'asset name' }, transactionDate: { normalizedHeader: 'trade date' } });
    expect(buildSpecColumnsFromMapping({ columnMapping: { amount: 'amount' } as Parameters<typeof buildSpecColumnsFromMapping>[0]['columnMapping'], headers: ['Amount', 'amount'] })).toEqual({ amount: { normalizedHeader: 'amount', occurrence: 1 } });
  });

  it('finds preferred specs and updates timestamps', async () => {
    const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
    const spec = { appuserKey: { appuserKey: 1 }, failureCount: 0, headerSetHash: 'set', lastMatchedAt: undefined, scope: 'user', shapeHash: 'shape', specJson: { columns: { assetName: { normalizedHeader: 'a' }, currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'quantity' }, transactionDate: { normalizedHeader: 'date' }, transactionType: { normalizedHeader: 'type' }, unitPrice: { normalizedHeader: 'price' } }, derivedValues: {}, fixedValueOrigins: {}, fixedValues: {}, layout, parser: 'column-mapping-v2', transformations: {} }, specVersion: 2, status: 'active', tenantKey: undefined, updatedAt: new Date('2024-01-02') };
    mocked.em.find.mockResolvedValue([spec, { ...spec, scope: 'tenant', specVersion: 9, updatedAt: new Date('2024-01-03') }]);
    mocked.em.flush.mockResolvedValue(undefined);
    const { default: service } = await import('../portfolio-import-parser-spec.service');
    await expect(service.findActiveSpecForShape({ appuser: appuserFixture, broker: { financialBrokerKey: 7 }, headers: ['A', 'Currency', 'Quantity', 'Date', 'Type', 'Price'], layout, tenant: { tenantKey: 2 } })).resolves.toBe(spec);
    expect(mocked.em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $or: expect.arrayContaining([{ financialBrokerKey: { financialBrokerKey: 7 }, scope: 'global' }]), engineVersion: 'portfolio-column-mapping-v2', status: 'active' }));
    expect(mocked.em.persist).toHaveBeenCalledWith(spec);
  });

  it('saves confirmed specs and records outcomes', async () => {
    mocked.em.flush.mockResolvedValue(undefined);
    const { default: service } = await import('../portfolio-import-parser-spec.service');
    const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
    await expect(service.saveConfirmedSpec({ appuser: appuserFixture, broker: { financialBrokerKey: 7 }, columnMapping: { quantity: 'Quantity', transactionDate: 'Date' }, derivedValues: { transactionType: 'quantitySign' }, fixedValues: { currency: 'EUR' }, headers: ['Date', 'Quantity'], layout, suggestionSource: 'llm', tenant: { tenantKey: 2 }, transformations: { decimalSeparator: ',' } })).resolves.toMatchObject({ contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), engineVersion: 'portfolio-column-mapping-v2', financialBrokerKey: { financialBrokerKey: 7 }, scope: 'tenant', specJson: { columns: { quantity: { normalizedHeader: 'quantity', occurrence: 0 }, transactionDate: { normalizedHeader: 'date', occurrence: 0 } }, derivedValues: { transactionType: 'quantitySign' }, fixedValueOrigins: {}, fixedValues: { currency: 'EUR' }, layout, parser: 'column-mapping-v2', transformations: { decimalSeparator: ',' } } });
    expect(mocked.em.persist).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: undefined, engineVersion: 'portfolio-column-mapping-v2', financialBrokerKey: { financialBrokerKey: 7 }, scope: 'tenant', source: 'llm_confirmed', status: 'active' }));

    const duplicateFingerprint = (await import('../portfolio-import-parser-spec.service')).buildPortfolioCsvShapeFingerprint({ headers: ['Amount', 'amount'], layout });
    mocked.em.persist.mockClear();
    await expect(service.saveConfirmedSpec({ appuser: appuserFixture, columnMapping: { totalAmount: 'amount' }, headers: ['Amount', 'amount'], layout, suggestionSource: 'user', tenant: { tenantKey: 2 }, transformations: {} })).resolves.toMatchObject({ headerSetHash: duplicateFingerprint.headerSetHash, shapeHash: duplicateFingerprint.shapeHash, specJson: { columns: { totalAmount: { normalizedHeader: 'amount', occurrence: 1 } }, derivedValues: {}, fixedValueOrigins: {}, fixedValues: {}, layout, parser: 'column-mapping-v2', transformations: {} } });
    const { resolveSpecColumnMapping } = await import('../portfolio-import-parser-spec.service');
    expect(resolveSpecColumnMapping({ actualHeaders: ['Amount', 'amount'], columns: { amount: { normalizedHeader: 'amount', occurrence: 1 } } })).toEqual({ amount: 'amount' });
    await service.recordSpecFailure(specFixture({ failureCount: 2, lastFailedAt: undefined, status: 'active' }));
    expect(mocked.em.persist).toHaveBeenCalledWith(expect.objectContaining({ failureCount: 3, status: 'quarantined' }));

    await service.recordSpecSuccess(specFixture({ status: 'active', successCount: 0 }));
    expect(mocked.em.persist).toHaveBeenCalledWith(expect.objectContaining({ successCount: 1 }));
  });

  it('falls through malformed higher precedence and never queries global for brokerless sessions', async () => {
    const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
    const malformed = { failureCount: 0, scope: 'user', specJson: { parser: 'column-mapping-v1' }, specVersion: 2, status: 'active', updatedAt: new Date('2026-01-02') };
    const valid = { failureCount: 0, portfolioImportParserSpecKey: 9, scope: 'tenant', specJson: { columns: { assetName: { normalizedHeader: 'asset' }, currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'quantity' }, transactionDate: { normalizedHeader: 'date' }, transactionType: { normalizedHeader: 'type' }, unitPrice: { normalizedHeader: 'price' } }, derivedValues: {}, fixedValueOrigins: {}, fixedValues: {}, layout, parser: 'column-mapping-v2', transformations: {} }, specVersion: 1, status: 'active', updatedAt: new Date('2026-01-01') };
    mocked.em.find.mockResolvedValue([malformed, valid]);
    mocked.em.persist.mockImplementationOnce(() => { throw new Error('feedback unavailable'); }).mockReturnThis();
    const { default: service } = await import('../portfolio-import-parser-spec.service');

    await expect(service.findActiveSpecForShape({ appuser: appuserFixture, headers: ['Asset', 'Currency', 'Quantity', 'Date', 'Type', 'Price'], layout, tenant: { tenantKey: 2 } })).resolves.toBe(valid);
    expect(malformed).toMatchObject({ failureCount: 1 });
    const query = mocked.em.find.mock.calls[0]?.[1] as { $or?: { scope?: string }[] };
    expect(query.$or).not.toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'global' })]));
  });

  it('promotes idempotently and refuses conflicting global content', async () => {
    const payload: PortfolioImportParserSpecPayload = { columns: { currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'quantity' }, transactionDate: { normalizedHeader: 'date' } }, derivedValues: { transactionType: 'quantitySign' }, fixedValueOrigins: {}, fixedValues: {}, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, parser: 'column-mapping-v2', transformations: {} };
    const { default: service, hashPortfolioImportParserSpecPayload } = await import('../portfolio-import-parser-spec.service');
    const candidate = { contentHash: hashPortfolioImportParserSpecPayload(payload), engineVersion: 'portfolio-column-mapping-v2', failureCount: 0, financialBrokerKey: { financialBrokerKey: 7 }, fingerprintAlgorithm: 'portfolio-csv-shape-v1', headerOrderHash: 'order', headerSetHash: 'set', normalizedHeadersJson: ['date', 'quantity'], portfolioImportParserSpecKey: 10, promotedAt: undefined as Date | undefined, schemaVersion: 2, scope: 'tenant', shapeHash: 'shape', source: 'user_confirmed', specJson: payload, specVersion: 1, status: 'active', successCount: 0, tenantKey: { tenantKey: 2 } };
    const sameGlobal = { ...candidate, portfolioImportParserSpecKey: 11, scope: 'global', successCount: 1 };
    mocked.em.findOne.mockResolvedValueOnce(candidate).mockResolvedValueOnce(sameGlobal);
    await expect(service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: candidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock)).resolves.toMatchObject({ globalParserSpecKey: 11, status: 'promoted' });
    expect(sameGlobal.successCount).toBe(2);
    mocked.em.findOne.mockResolvedValueOnce(candidate).mockResolvedValueOnce(sameGlobal);
    await service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: candidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock);
    expect(sameGlobal.successCount).toBe(2);

    const conflictingGlobal = { ...sameGlobal, contentHash: 'different' };
    mocked.em.findOne.mockResolvedValueOnce(candidate).mockResolvedValueOnce(conflictingGlobal);
    candidate.promotedAt = undefined;
    await expect(service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: candidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock)).resolves.toMatchObject({ status: 'conflict' });
    expect(conflictingGlobal.contentHash).toBe('different');
  });

  it('creates metadata-only globals and rejects unsafe footer matchers', async () => {
    const safePayload: PortfolioImportParserSpecPayload = { columns: { currency: { normalizedHeader: 'currency' }, quantity: { normalizedHeader: 'quantity' }, transactionDate: { normalizedHeader: 'date' } }, derivedValues: { transactionType: 'quantitySign' }, fixedValueOrigins: {}, fixedValues: {}, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, parser: 'column-mapping-v2', transformations: {} };
    const { default: service, hashPortfolioImportParserSpecPayload } = await import('../portfolio-import-parser-spec.service');
    const candidate = { contentHash: hashPortfolioImportParserSpecPayload(safePayload), engineVersion: 'portfolio-column-mapping-v2', failureCount: 0, financialBrokerKey: { financialBrokerKey: 7 }, fingerprintAlgorithm: 'portfolio-csv-shape-v1', headerOrderHash: 'order', headerSetHash: 'set', normalizedHeadersJson: ['private_email@example.com', 'date', 'quantity'], portfolioImportParserSpecKey: 10, schemaVersion: 2, scope: 'tenant', shapeHash: 'shape', source: 'user_confirmed', specJson: safePayload, specVersion: 1, status: 'active', successCount: 0, tenantKey: { tenantKey: 2 } };
    mocked.em.findOne.mockResolvedValueOnce(candidate).mockResolvedValueOnce(null);
    await service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: candidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock);
    expect(mocked.em.persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ appuserKey: undefined, financialBrokerKey: { financialBrokerKey: 7 }, normalizedHeadersJson: ['currency', 'quantity', 'date'], scope: 'global', tenantKey: undefined })]));

    mocked.em.persist.mockClear();
    const unsafePayload = { ...safePayload, layout: { ...safePayload.layout, footerMatchers: ['Account 12345678'] } };
    const unsafeCandidate = { ...candidate, contentHash: hashPortfolioImportParserSpecPayload(unsafePayload), specJson: unsafePayload };
    mocked.em.findOne.mockResolvedValueOnce(unsafeCandidate);
    await expect(service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: unsafeCandidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock)).resolves.toMatchObject({ status: 'ineligible' });
    expect(mocked.em.persist).not.toHaveBeenCalled();
  });

  it('versions changed tenant candidates without mutating prior content', async () => {
    const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
    const prior = { contentHash: 'old-hash', failureCount: 0, portfolioImportParserSpecKey: 41, specJson: { old: true }, specVersion: 3, status: 'active', successCount: 2 };
    mocked.em.findOne.mockResolvedValueOnce(prior);
    const { default: service } = await import('../portfolio-import-parser-spec.service');

    const next = await service.saveConfirmedSpec({ appuser: appuserFixture, broker: { financialBrokerKey: 7 }, columnMapping: { quantity: 'Quantity', transactionDate: 'Date' }, derivedValues: { transactionType: 'quantitySign' }, fixedValues: { currency: 'EUR' }, headers: ['Date', 'Quantity', 'Value EUR'], layout, suggestionSource: 'user', tenant: { tenantKey: 2 }, transformations: {} });

    expect(prior).toMatchObject({ contentHash: 'old-hash', specJson: { old: true }, status: 'deprecated' });
    expect(next).not.toBe(prior);
    expect(next).toMatchObject({ specVersion: 4, supersedesSpecKey: prior });
    expect(mocked.em.persist.mock.calls[0]?.[0]).toBe(prior);
    expect(mocked.em.persist.mock.calls[1]?.[0]).toBe(next);
    expect(mocked.em.flush.mock.invocationCallOrder[0]).toBeLessThan(mocked.em.persist.mock.invocationCallOrder[1]!);
    expect(mocked.em.execute).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.any(Array));
    mocked.em.findOne.mockResolvedValueOnce(next);
    await expect(service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: 'old-hash', expectedTenantKey: 2, parserSpecKey: 41 }, emMock)).resolves.toMatchObject({ status: 'ineligible' });
  });

  it('reuses an immutable tenant candidate when content hash is unchanged', async () => {
    const input = { appuser: appuserFixture, broker: { financialBrokerKey: 7 }, columnMapping: { currency: 'Currency', quantity: 'Quantity', transactionDate: 'Date', transactionType: 'Type', unitPrice: 'Price' }, headers: ['Currency', 'Quantity', 'Date', 'Type', 'Price'], layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, suggestionSource: 'user' as const, tenant: { tenantKey: 2 }, transformations: {} };
    const { buildPortfolioImportParserSpecPayload, default: service, hashPortfolioImportParserSpecPayload } = await import('../portfolio-import-parser-spec.service');
    const existing = { contentHash: hashPortfolioImportParserSpecPayload(buildPortfolioImportParserSpecPayload(input)), portfolioImportParserSpecKey: 44, specVersion: 2, status: 'active' };
    mocked.em.findOne.mockResolvedValueOnce(existing);
    await expect(service.saveConfirmedSpec(input)).resolves.toBe(existing);
    expect(existing).toMatchObject({ specVersion: 2, status: 'active' });
  });

  it('computes embedded currency provenance from the mapped header only', async () => {
    const { buildPortfolioImportParserSpecPayload } = await import('../portfolio-import-parser-spec.service');
    expect(buildPortfolioImportParserSpecPayload({ columnMapping: { quantity: 'Quantity', totalAmount: 'Value EUR', transactionDate: 'Date' }, derivedValues: { transactionType: 'quantitySign' }, fixedValues: { currency: 'EUR' }, headers: ['Date', 'Quantity', 'Value EUR', 'customer@example.com'], layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {} })).toMatchObject({ fixedValueOrigins: { currency: 'embedded_header' } });
    expect(buildPortfolioImportParserSpecPayload({ columnMapping: { quantity: 'Quantity', totalAmount: 'Value', transactionDate: 'Date' }, derivedValues: { transactionType: 'quantitySign' }, fixedValues: { currency: 'EUR' }, headers: ['Date', 'Quantity', 'Value', 'Unmapped EUR'], layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {} })).toMatchObject({ fixedValueOrigins: {} });
  });

  it('observes global runtime failures without quarantining and quarantines structural corruption', async () => {
    const { default: service } = await import('../portfolio-import-parser-spec.service');
    const runtimeGlobal = specFixture({ failureCount: 2, scope: 'global', status: 'active' });
    await service.recordSpecFailure(runtimeGlobal, { kind: 'runtime' });
    expect(runtimeGlobal).toMatchObject({ failureCount: 3, status: 'active' });
    const structuralGlobal = specFixture({ failureCount: 2, scope: 'global', status: 'active' });
    await service.recordSpecFailure(structuralGlobal, { kind: 'structural' });
    expect(structuralGlobal).toMatchObject({ failureCount: 3, status: 'quarantined' });
  });

  it.each<[PortfolioImportParserSpecPayload['fixedValues'], PortfolioImportParserSpecPayload['fixedValueOrigins'], boolean]>([
    [{ currency: 'EUR', transactionType: 'BUY' }, { currency: 'embedded_header' }, false],
    [{ currency: 'EUR' }, {}, false],
    [{ currency: 'EUR' }, { currency: 'embedded_header' }, true],
  ])('enforces fixed-value global promotion safety', async (fixedValues, fixedValueOrigins, expectedEligible) => {
    const payload: PortfolioImportParserSpecPayload = { columns: { quantity: { normalizedHeader: 'quantity' }, totalAmount: { normalizedHeader: 'value eur' }, transactionDate: { normalizedHeader: 'date' } }, derivedValues: { transactionType: 'quantitySign' }, fixedValueOrigins, fixedValues, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, parser: 'column-mapping-v2', transformations: {} };
    const { default: service, hashPortfolioImportParserSpecPayload } = await import('../portfolio-import-parser-spec.service');
    const candidate = { contentHash: hashPortfolioImportParserSpecPayload(payload), financialBrokerKey: { financialBrokerKey: 7 }, portfolioImportParserSpecKey: 10, promotedAt: undefined, scope: 'tenant', shapeHash: 'shape', specJson: payload, status: 'active', tenantKey: { tenantKey: 2 } };
    mocked.em.findOne.mockResolvedValueOnce(candidate).mockResolvedValueOnce(null);
    const result = await service.promoteTenantSpec({ expectedBrokerKey: 7, expectedContentHash: candidate.contentHash, expectedTenantKey: 2, parserSpecKey: 10 }, emMock);
    expect(result.status === 'promoted').toBe(expectedEligible);
  });
});
