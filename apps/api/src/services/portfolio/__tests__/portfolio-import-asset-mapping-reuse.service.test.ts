import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em } = vi.hoisted(() => ({
  em: { findOne: vi.fn(), getConnection: vi.fn(), getTransactionContext: vi.fn() },
}));

vi.mock('@app/database/di', () => ({ DI: { em } }));

import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportAssetMapping } from '@entity/PortfolioImportAssetMapping';
import type { Tenant } from '@entity/Tenant';
import { ConflictError } from '@utils/errors';

import service from '../portfolio-import-asset-mapping-reuse.service';

describe('portfolio import asset mapping reuse service', () => {
  const tenant = { tenantKey: 11 } as Tenant;
  const broker = { financialBrokerKey: 22 } as FinancialBroker;
  const identity = { brokerAssetName: 'iShares Core MSCI World UCITS ETF', brokerExchange: 'XETRA', brokerTicker: 'VWCE', currency: 'EUR', isin: 'IE00B4L5Y983' };
  const identityHash = 'hash-1';
  let connection: { execute: ReturnType<typeof vi.fn> };
  let transactionContext: { tx: true };

  beforeEach(() => {
    vi.clearAllMocks();
    em.findOne.mockReset();
    em.getConnection.mockReset();
    transactionContext = { tx: true };
    em.getTransactionContext.mockReturnValue(transactionContext);
    connection = { execute: vi.fn() };
    em.getConnection.mockReturnValue(connection);
  });

  it('returns undefined when session has no broker', async () => {
    const result = await service.findReusableAsset({ financialBroker: undefined, identity, identityHash, tenant });

    expect(result).toBeUndefined();
    expect(em.findOne).not.toHaveBeenCalled();
  });

  it('finds active mapping for same tenant, broker, and identity hash', async () => {
    const asset = { deletedAt: undefined, financialAssetKey: 100, isActivelyTrading: true, symbol: 'VWCE' } as FinancialAsset;
    em.findOne.mockResolvedValueOnce({ deletedAt: undefined, financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant });

    await expect(service.findReusableAsset({ financialBroker: broker, identity, identityHash, tenant })).resolves.toBe(asset);
    expect(em.findOne).toHaveBeenCalledWith(PortfolioImportAssetMapping, expect.objectContaining({ deletedAt: undefined, financialBrokerKey: broker, identityHash, tenantKey: tenant }), expect.objectContaining({ populate: ['financialAssetKey'] }));
  });

  it('does not reuse deleted or inactive mapped assets', async () => {
    em.findOne.mockResolvedValueOnce({ deletedAt: undefined, financialAssetKey: { deletedAt: new Date(), financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset, financialBrokerKey: broker, identityHash, tenantKey: tenant });
    await expect(service.findReusableAsset({ financialBroker: broker, identity, identityHash, tenant })).resolves.toBeUndefined();

    em.findOne.mockResolvedValueOnce({ deletedAt: undefined, financialAssetKey: { deletedAt: undefined, financialAssetKey: 101, isActivelyTrading: false } as FinancialAsset, financialBrokerKey: broker, identityHash, tenantKey: tenant });
    await expect(service.findReusableAsset({ financialBroker: broker, identity, identityHash, tenant })).resolves.toBeUndefined();
  });

  it('does not see mappings from different tenant or broker', async () => {
    const otherTenant = { tenantKey: 99 } as Tenant;
    const otherBroker = { financialBrokerKey: 88 } as FinancialBroker;
    em.findOne.mockResolvedValue(null);

    await service.findReusableAsset({ financialBroker: broker, identity, identityHash, tenant });

    expect(em.findOne).toHaveBeenCalledWith(PortfolioImportAssetMapping, expect.objectContaining({ deletedAt: undefined, financialBrokerKey: broker, identityHash, tenantKey: tenant }), expect.objectContaining({ populate: ['financialAssetKey'] }));

    await service.findReusableAsset({ financialBroker: otherBroker, identity, identityHash, tenant: otherTenant });
    expect(em.findOne).toHaveBeenCalledWith(PortfolioImportAssetMapping, expect.objectContaining({ deletedAt: undefined, financialBrokerKey: otherBroker, identityHash, tenantKey: otherTenant }), expect.objectContaining({ populate: ['financialAssetKey'] }));
  });

  it('creates new mapping for selected asset and is idempotent on repeated save', async () => {
    const asset = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;
    em.findOne.mockResolvedValueOnce(null);
    em.findOne.mockResolvedValueOnce({ deletedAt: undefined, financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant });
    em.findOne.mockResolvedValue({ deletedAt: undefined, financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant });

    const first = await service.saveReusableMapping({ financialAsset: asset, financialBroker: broker, identity, identityHash, tenant });
    const second = await service.saveReusableMapping({ financialAsset: asset, financialBroker: broker, identity, identityHash, tenant });

    expect(first).toMatchObject({ financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant });
    expect(second).toMatchObject({ financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant });
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it('conflicting active mapping throws ConflictError', async () => {
    const assetA = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;
    const assetB = { financialAssetKey: 200, isActivelyTrading: true } as FinancialAsset;
    em.findOne.mockResolvedValueOnce({ deletedAt: undefined, financialAssetKey: assetA, financialBrokerKey: broker, identityHash, tenantKey: tenant });

    await expect(service.saveReusableMapping({ financialAsset: assetB, financialBroker: broker, identity, identityHash, tenant })).rejects.toBeInstanceOf(ConflictError);
  });

  it('re-queries on insert conflict and returns same mapping when another process saved the same asset', async () => {
    const asset = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;
    const mapping = { deletedAt: undefined, financialAssetKey: asset, financialBrokerKey: broker, identityHash, tenantKey: tenant } as PortfolioImportAssetMapping;
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(mapping);
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    em.getConnection.mockReturnValue({ execute });

    await expect(service.saveReusableMapping({ financialAsset: asset, financialBroker: broker, identity, identityHash, tenant })).resolves.toBe(mapping);
    expect(em.findOne).toHaveBeenNthCalledWith(1, PortfolioImportAssetMapping, expect.objectContaining({ deletedAt: undefined, financialBrokerKey: broker, identityHash, tenantKey: tenant }), expect.objectContaining({ populate: ['financialAssetKey'] }));
    expect(em.findOne).toHaveBeenNthCalledWith(2, PortfolioImportAssetMapping, expect.objectContaining({ deletedAt: undefined, financialBrokerKey: broker, identityHash, tenantKey: tenant }), expect.objectContaining({ populate: ['financialAssetKey'] }));
    expect(execute).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'run', transactionContext);
  });

  it('re-queries on insert conflict and throws when another asset won', async () => {
    const assetA = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;
    const assetB = { financialAssetKey: 200, isActivelyTrading: true } as FinancialAsset;
    const mapping = { deletedAt: undefined, financialAssetKey: assetA, financialBrokerKey: broker, identityHash, tenantKey: tenant } as PortfolioImportAssetMapping;
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(mapping);
    em.getConnection.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rowCount: 1 }) });

    await expect(service.saveReusableMapping({ financialAsset: assetB, financialBroker: broker, identity, identityHash, tenant })).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws when insert re-query finds nothing', async () => {
    const asset = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    em.getConnection.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rowCount: 0 }) });

    await expect(service.saveReusableMapping({ financialAsset: asset, financialBroker: broker, identity, identityHash, tenant })).rejects.toBeInstanceOf(ConflictError);
  });

  it('no-broker save returns undefined and persists nothing', async () => {
    const asset = { financialAssetKey: 100, isActivelyTrading: true } as FinancialAsset;

    await expect(service.saveReusableMapping({ financialAsset: asset, financialBroker: undefined, identity, identityHash, tenant })).resolves.toBeUndefined();
    expect(em.findOne).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalled();
  });
});
