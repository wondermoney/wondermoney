import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionAuditEventType } from '@entity/TransactionAuditLog';

const mocks = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  findManualDuplicate: vi.fn(),
  log: vi.fn().mockResolvedValue({ transactionAuditLogKey: 1 }),
}));

vi.mock('../../../app.js', () => ({ DI: { em: {} } }));
vi.mock('@validators/parser', () => ({ zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)) }));
vi.mock('@service/transaction/transaction-creation.service', () => ({ transactionCreationService: { createTransaction: mocks.createTransaction } }));
vi.mock('@service/transaction/transaction-dedup.service', () => ({ findManualDuplicate: mocks.findManualDuplicate }));
vi.mock('@service/transaction/transaction-audit.service', () => ({ TransactionAuditService: { log: mocks.log } }));

import { createTransaction } from '../transactions';

const makeRes = () => {
  const res = { json: vi.fn(), status: vi.fn() } as unknown as Response;
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
};

const baseReq = () => ({
  body: { originalAmount: 10, settlementAmount: 10, transactionDate: new Date('2026-07-30T00:00:00.000Z') },
  params: { accountId: 5 },
  user: { appuserKey: 7 },
}) as unknown as Request;

describe('createTransaction dedup telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransaction.mockResolvedValue({ tenantKey: { tenantKey: 113 }, transactionKey: 42 });
  });

  it('emits DEDUP_FLAGGED (not DEDUP_SKIPPED) when a manual entry collides but is still created', async () => {
    mocks.findManualDuplicate.mockResolvedValue({ existing: { transactionKey: 99 }, matchedOn: 'internalTransactionId' });
    const res = makeRes();

    await createTransaction(baseReq(), res, vi.fn());

    expect(mocks.createTransaction).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith({}, expect.objectContaining({
      changes: {
        flaggedAgainstTransactionKey: { from: null, to: 99 },
        matchedOn: { from: null, to: 'internalTransactionId' },
      },
      eventType: TransactionAuditEventType.DEDUP_FLAGGED,
      source: 'manual-transaction',
      tenantKey: 113,
      transactionKey: 42,
    }));
    expect(res.json).toHaveBeenCalledWith({ possibleDuplicate: true });
  });

  it('creates the transaction and emits nothing when there is no duplicate', async () => {
    mocks.findManualDuplicate.mockResolvedValue(null);
    const res = makeRes();

    await createTransaction(baseReq(), res, vi.fn());

    expect(mocks.createTransaction).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ possibleDuplicate: false });
  });
});
