import type { EntityManager } from '@mikro-orm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@entity/Account';
import type { AppuserTenant } from '@entity/AppuserTenant';
import { TransactionAuditEventType } from '@entity/TransactionAuditLog';
import type { TransactionStatus } from '@entity/TransactionStatus';

import { getReconciliationMode, logDryRunPromotions, planPromotions } from '../pending-reconciliation.service';
import { TransactionAuditService } from '../transaction-audit.service';

const base = { counterparty: 'acme', currencyCode: 'EUR', transactionDate: new Date('2026-07-15T00:00:00.000Z') };
const booked = (over: Partial<typeof base> & { settlementAmount: number }) => ({ ...base, ...over });
const pending = (over: Partial<typeof base> & { settlementAmount: number; transactionKey: number }) => ({ ...base, ...over });

describe('planPromotions', () => {
  it('plans one promotion when a booked row matches a single stored pending', () => {
    const plan = planPromotions([booked({ settlementAmount: -20 })], [pending({ settlementAmount: -20, transactionKey: 7 })]);
    expect(plan).toEqual([{ bookedIndex: 0, pendingKey: 7 }]);
  });

  it('plans nothing when no booked row matches any pending', () => {
    expect(planPromotions([booked({ settlementAmount: -20 })], [pending({ settlementAmount: -99, transactionKey: 7 })])).toEqual([]);
  });

  it('consumes a pending so two identical booked rows do not both claim it', () => {
    const plan = planPromotions(
      [booked({ settlementAmount: -20 }), booked({ settlementAmount: -20 })],
      [pending({ settlementAmount: -20, transactionKey: 7 })],
    );
    expect(plan).toEqual([{ bookedIndex: 0, pendingKey: 7 }]);
  });

  it('skips ambiguous booked rows (two pendings match one booked)', () => {
    const plan = planPromotions(
      [booked({ settlementAmount: -20 })],
      [pending({ settlementAmount: -20, transactionKey: 7 }), pending({ settlementAmount: -20, transactionKey: 8 })],
    );
    expect(plan).toEqual([]);
  });

  it('matches each booked row to its own distinct pending', () => {
    const plan = planPromotions(
      [booked({ counterparty: 'a', settlementAmount: -20 }), booked({ counterparty: 'b', settlementAmount: -30 })],
      [pending({ counterparty: 'b', settlementAmount: -30, transactionKey: 8 }), pending({ counterparty: 'a', settlementAmount: -20, transactionKey: 7 })],
    );
    expect(plan).toEqual([{ bookedIndex: 0, pendingKey: 7 }, { bookedIndex: 1, pendingKey: 8 }]);
  });
});

describe('getReconciliationMode', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to apply (live) and honours dry_run / off', () => {
    vi.stubEnv('TRANSACTION_PENDING_RECONCILIATION', '');
    expect(getReconciliationMode()).toBe('apply');
    vi.stubEnv('TRANSACTION_PENDING_RECONCILIATION', 'dry_run');
    expect(getReconciliationMode()).toBe('dry_run');
    vi.stubEnv('TRANSACTION_PENDING_RECONCILIATION', 'off');
    expect(getReconciliationMode()).toBe('off');
  });
});

describe('logDryRunPromotions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('logs a PENDING_PROMOTED intent for each planned promotion without mutating the pending row', async () => {
    const auditSpy = vi.spyOn(TransactionAuditService, 'log').mockResolvedValue(null);
    const storedPending = {
      appuserKey: { appuserKey: 9 },
      settlementAmount: -20,
      settlementCurrencyKey: { code: 'EUR' },
      tenantKey: { tenantKey: 3 },
      transactionDate: new Date('2026-07-15T00:00:00.000Z'),
      transactionKey: 7,
    };
    const em = { find: vi.fn().mockResolvedValue([storedPending]) };

    const plan = await logDryRunPromotions(em as unknown as EntityManager, {
      account: { accountKey: 5 } as unknown as Account,
      bookedRows: [{ counterparty: 'acme', currencyCode: 'EUR', settlementAmount: -20, transactionDate: new Date('2026-07-16T00:00:00.000Z') }],
      pendingStatus: {} as unknown as TransactionStatus,
      tenant: {} as unknown as AppuserTenant,
    });

    expect(plan).toEqual([{ bookedIndex: 0, pendingKey: 7 }]);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[1]).toMatchObject({ eventType: TransactionAuditEventType.PENDING_PROMOTED, transactionKey: 7 });
    // Dry-run: the pending row's status is untouched.
    expect(storedPending.settlementAmount).toBe(-20);
  });

  it('never throws and returns [] when the pending lookup fails', async () => {
    const em = { find: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(
      logDryRunPromotions(em as unknown as EntityManager, { account: { accountKey: 5 } as unknown as Account, bookedRows: [], pendingStatus: {} as unknown as TransactionStatus, tenant: {} as unknown as AppuserTenant }),
    ).resolves.toEqual([]);
  });
});
