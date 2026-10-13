import { type EntityManager, LockMode } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em, txEm } = vi.hoisted(() => ({
  em: { findOne: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }), transactional: vi.fn() },
  txEm: { findOne: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return txEm; }) },
}));

vi.mock('@app/database/di', () => ({ DI: { em } }));

import type { Appuser } from '@entity/Appuser';
import { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import service from '../portfolio-import-session.service';

describe('portfolio import session service', () => {
  const appuser = { appuserKey: 5 } as unknown as Appuser;
  const tenant = { tenantKey: 8 };
  const portfolio = { portfolioKey: 12, portfolioOwnerAppuserKey: appuser, tenantKey: tenant };

  beforeEach(() => {
    vi.clearAllMocks();
    em.findOne.mockReset();
    em.persist.mockReset();
    em.persist.mockImplementation(function () { return em; });
    em.flush.mockReset().mockResolvedValue(undefined);
    em.transactional.mockReset();
    txEm.findOne.mockReset();
    txEm.persist.mockReset();
    txEm.persist.mockImplementation(function () { return txEm; });
    txEm.flush.mockReset().mockResolvedValue(undefined);
    em.transactional.mockImplementation(async (cb: (em: typeof txEm) => Promise<unknown>) => {
      await Promise.resolve();
      const result = await cb(txEm);
      return result;
    });
  });

  it('creates a waiting-for-upload session for an owned portfolio', async () => {
    em.findOne.mockResolvedValueOnce(portfolio);

    const result = await service.createSession({ appuser, columnMappingJson: { source: 'test' }, correlationId: 'portfolio.csv-import-session:12:abc', expiresAt: new Date('2026-06-19T00:00:00.000Z'), portfolioId: 12, s3Bucket: 'portfolios-csv-dev', s3Key: 'import-sessions/12/abc.csv', summaryJson: { totalRows: 0 }, tenant });

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ closedAt: undefined, deletedAt: undefined, portfolioKey: 12, portfolioOwnerAppuserKey: appuser, tenantKey: tenant }), expect.objectContaining({ populate: ['portfolioOwnerAppuserKey', 'tenantKey'] }));
    expect(result.appuserKey).toBe(appuser);
    expect(result.financialBrokerKey).toBeUndefined();
    expect(result.tenantKey).toBe(tenant);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(em.persist).toHaveBeenCalledWith(result);
  });

  it('persists broker context when broker belongs to tenant', async () => {
    em.findOne.mockResolvedValueOnce(portfolio).mockResolvedValueOnce({ financialBrokerKey: 77, name: 'Broker' } as FinancialBroker);

    const result = await service.createSession({ appuser, brokerId: 77, correlationId: 'portfolio.csv-import-session:12:abc', portfolioId: 12, s3Bucket: 'portfolios-csv-dev', s3Key: 'import-sessions/12/abc.csv', tenant });

    expect(result.financialBrokerKey).toMatchObject({ financialBrokerKey: 77, name: 'Broker' });
    expect(em.findOne).toHaveBeenNthCalledWith(2, FinancialBroker, expect.objectContaining({ financialBrokerKey: 77 }));
  });

  it('rejects missing broker for session create', async () => {
    em.findOne.mockResolvedValueOnce(portfolio).mockResolvedValueOnce(null);

    await expect(service.createSession({ appuser, brokerId: 77, correlationId: 'portfolio.csv-import-session:12:abc', portfolioId: 12, s3Bucket: 'portfolios-csv-dev', s3Key: 'import-sessions/12/abc.csv', tenant })).rejects.toThrow('Broker not found');
  });

  it('detects expired sessions by timestamp', () => {
    expect(service.isExpired({ expiredAt: undefined, expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(service.isExpired({ expiredAt: undefined, expiresAt: new Date(Date.now() + 1000) })).toBe(false);
    expect(service.isExpired({ expiredAt: new Date(), expiresAt: new Date(Date.now() + 1000) })).toBe(true);
  });

  it('rejects unauthorized portfolios', async () => {
    em.findOne.mockResolvedValueOnce(null);

    await expect(service.createSession({ appuser, correlationId: 'portfolio.csv-import-session:12:abc', portfolioId: 12, s3Bucket: 'portfolios-csv-dev', s3Key: 'import-sessions/12/abc.csv', tenant })).rejects.toThrow('Portfolio not found');
  });

  it('rejects cross-tenant portfolio access', async () => {
    em.findOne.mockResolvedValueOnce(null);

    await expect(service.createSession({ appuser, correlationId: 'portfolio.csv-import-session:12:abc', portfolioId: 12, s3Bucket: 'portfolios-csv-dev', s3Key: 'import-sessions/12/abc.csv', tenant })).rejects.toThrow('Portfolio not found');

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ closedAt: undefined, deletedAt: undefined, portfolioKey: 12, portfolioOwnerAppuserKey: appuser, tenantKey: tenant }), expect.objectContaining({ populate: ['portfolioOwnerAppuserKey', 'tenantKey'] }));
  });

  it('fetches only an owned session', async () => {
    const session = { portfolioImportSessionKey: 456 };
    const findOne = vi.fn().mockResolvedValue(session);
    const txEm = { findOne } as unknown as EntityManager;

    const result = await service.getOwnedSession({ appuser, importSessionId: 456, tenant }, { em: txEm });

    expect(result).toBe(session);
    expect(em.findOne).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ appuserKey: appuser, deletedAt: undefined, portfolioImportSessionKey: 456, tenantKey: tenant }), expect.objectContaining({ populate: ['portfolioKey', 'tenantKey', 'financialBrokerKey'] }));
  });

  it('rejects cross-tenant session access', async () => {
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getOwnedSession({ appuser, importSessionId: 456, tenant })).rejects.toThrow('Import session not found');
  });

  it('throws not found for sessions owned by someone else', async () => {
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getOwnedSession({ appuser, importSessionId: 456, tenant })).rejects.toThrow('Import session not found');
  });

  it('updates status and summary for an owned session', async () => {
    const session = { portfolioImportSessionKey: 456, status: PortfolioImportSessionStatus.UPLOADED, summaryJson: undefined };
    em.findOne.mockResolvedValueOnce(session);

    const result = await service.updateSessionStatus({ appuser, importSessionId: 456, status: PortfolioImportSessionStatus.PARSING, summaryJson: { totalRows: 3 }, tenant });

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ appuserKey: appuser, deletedAt: undefined, portfolioImportSessionKey: 456, tenantKey: tenant }), expect.objectContaining({ populate: ['portfolioKey', 'tenantKey', 'financialBrokerKey'] }));
    expect(result.status).toBe(PortfolioImportSessionStatus.PARSING);
    expect(em.persist).toHaveBeenCalledWith(session);
  });

  it('creates draft rows for an owned session', async () => {
    const session = { portfolioImportSessionKey: 456 };
    em.findOne.mockResolvedValueOnce(session);

    const rows = await service.createDraftRows({ appuser, importSessionId: 456, rows: [{ internalTransactionId: 'broker-row-1', normalizedJson: { quantity: 1, type: 'BUY' }, rawJson: { raw: 'row-1' }, rowNumber: 1, status: PortfolioImportRowStatus.READY }], tenant });

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ appuserKey: appuser, deletedAt: undefined, portfolioImportSessionKey: 456, tenantKey: tenant }), expect.objectContaining({ populate: ['portfolioKey', 'tenantKey', 'financialBrokerKey'] }));
    expect(rows[0]).toMatchObject({ internalTransactionId: 'broker-row-1', normalizedJson: { quantity: 1, type: 'BUY' }, portfolioImportSessionKey: session, rawJson: { raw: 'row-1' }, rowNumber: 1, status: PortfolioImportRowStatus.READY });
    expect(em.persist).toHaveBeenCalledWith(rows);
  });

  it('defaults draft row status to valid', async () => {
    const session = { portfolioImportSessionKey: 456 };
    em.findOne.mockResolvedValueOnce(session);

    const rows = await service.createDraftRows({ appuser, importSessionId: 456, rows: [{ rawJson: { raw: 'row-1' }, rowNumber: 1 }], tenant });

    expect(rows[0]?.status).toBe(PortfolioImportRowStatus.VALID);
  });

  it('marks a matching in-progress session failed with worker error summary', async () => {
    const session = { portfolioImportSessionKey: 456, status: PortfolioImportSessionStatus.PARSING, summaryJson: { parseCorrelationId: 'cid' } };
    txEm.findOne.mockResolvedValueOnce(session);

    const result = await service.markWorkerFailure({ error: new Error('parse boom'), expectedStatus: PortfolioImportSessionStatus.PARSING, importSessionId: 456, summaryKey: 'parseWorkerError' });

    expect(result).toBe(true);
    expect(em.transactional).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ clear: true }));
    expect(txEm.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ deletedAt: undefined, portfolioImportSessionKey: 456 }), expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
    expect(session.status).toBe(PortfolioImportSessionStatus.FAILED);
    expect(session.summaryJson).toEqual({ parseCorrelationId: 'cid', parseWorkerError: { code: 'WORKER_FAILED', message: 'parse boom' }, status: PortfolioImportSessionStatus.FAILED });
    expect(txEm.persist).toHaveBeenCalledWith(session);
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('does not mutate sessions that already left the expected in-progress state', async () => {
    const session = { portfolioImportSessionKey: 456, status: PortfolioImportSessionStatus.READY_TO_IMPORT, summaryJson: { parseCorrelationId: 'cid' } };
    txEm.findOne.mockResolvedValueOnce(session);

    const result = await service.markWorkerFailure({ error: new Error('parse boom'), expectedStatus: PortfolioImportSessionStatus.PARSING, importSessionId: 456, summaryKey: 'parseWorkerError' });

    expect(result).toBe(false);
    expect(session.status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    expect(session.summaryJson).toEqual({ parseCorrelationId: 'cid' });
    expect(txEm.persist).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns false when the session is missing', async () => {
    txEm.findOne.mockResolvedValueOnce(null);

    const result = await service.markWorkerFailure({ error: new Error('parse boom'), expectedStatus: PortfolioImportSessionStatus.PARSING, importSessionId: 456, summaryKey: 'parseWorkerError' });

    expect(result).toBe(false);
    expect(txEm.persist).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });
});
