import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import type { Currency } from '@entity/Currency';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import type { Tenant } from '@entity/Tenant';
import { RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';
import { BadRequestError } from '@utils/errors';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getRecurringOccurrences } from '../recurring';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

interface SeedSeriesInput {
  account?: Account;
  currencyKey: Currency;
  displayName: string;
  nextExpectedAt: Date;
  status?: RecurringSeriesStatus;
  tenantKey: Tenant;
}

async function addSeries(em: EntityManager, input: SeedSeriesInput) {
  const series = em.create(RecurringSeries, {
    accountKey: input.account,
    amountType: RecurringAmountType.fixed,
    cadence: RecurringCadence.monthly,
    cadenceConfidence: 100,
    confidenceScore: 100,
    currencyKey: input.currencyKey,
    detectionVersion: 1,
    displayName: input.displayName,
    expectedAmount: 20,
    nextExpectedAt: input.nextExpectedAt,
    normalizedMerchantKey: input.displayName.toLowerCase(),
    occurrenceCount: 1,
    source: RecurringSeriesSource.detected,
    status: input.status ?? RecurringSeriesStatus.confirmed,
    tenantKey: input.tenantKey,
    type: RecurringSeriesType.bill,
  }, { partial: true });
  await em.flush();
  return series;
}

describe('GET /v1/recurring/occurrences', () => {
  const db = useTestDatabase();

  it('returns confirmed series occurrences and hides another member\'s private account', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const shared = await addAccount(em, owner, { name: 'Shared' });
    const privateAccount = await addAccount(em, owner, { isPrivate: true, name: 'Owner private' });
    const currencyKey = owner.currency;

    await addSeries(em, { account: shared, currencyKey, displayName: 'Shared rent', nextExpectedAt: day('2026-03-10'), tenantKey: owner.tenant });
    await addSeries(em, { account: privateAccount, currencyKey, displayName: 'Private gym', nextExpectedAt: day('2026-03-12'), tenantKey: owner.tenant });
    await addSeries(em, { account: shared, currencyKey, displayName: 'Unconfirmed', nextExpectedAt: day('2026-03-14'), status: RecurringSeriesStatus.candidate, tenantKey: owner.tenant });

    setTenantContext(DI.em, { appuserKey: partner.appuserKey, tenantKey: owner.tenant.tenantKey });
    const json = vi.fn();
    await getRecurringOccurrences(
      Object.assign(mockReq({ query: { from: '2026-03-01', to: '2026-03-31' } }), { appuser: partner, tenant: owner.tenant }),
      mockRes({ json }),
    );

    const body = json.mock.calls[0]?.[0] as { items: { name: string; status: string }[] };
    expect(body.items.map((item) => item.name)).toEqual(['Shared rent']);
    expect(body.items[0]).toMatchObject({ status: 'overdue' });
  });

  it('returns a private account\'s series to its owner', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    await addSeries(em, { account: privateAccount, currencyKey: owner.currency, displayName: 'Private gym', nextExpectedAt: day('2026-03-12'), tenantKey: owner.tenant });

    setTenantContext(DI.em, { appuserKey: owner.appuser.appuserKey, tenantKey: owner.tenant.tenantKey });
    const json = vi.fn();
    await getRecurringOccurrences(
      Object.assign(mockReq({ query: { from: '2026-03-01', to: '2026-03-31' } }), { appuser: owner.appuser, tenant: owner.tenant }),
      mockRes({ json }),
    );

    const body = json.mock.calls[0]?.[0] as { items: { name: string }[] };
    expect(body.items.map((item) => item.name)).toEqual(['Private gym']);
  });

  it('marks a matched occurrence paid with its amount and currency', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    const shared = await addAccount(em, owner);
    const series = await addSeries(em, { account: shared, currencyKey: owner.currency, displayName: 'Internet', nextExpectedAt: day('2026-03-10'), tenantKey: owner.tenant });
    em.create(RecurringOccurrence, {
      amount: 39.9,
      currencyKey: owner.currency,
      matchStatus: RecurringOccurrenceMatchStatus.matched,
      occurrenceDate: day('2026-03-10'),
      recurringSeriesKey: series,
    }, { partial: true });
    await em.flush();

    setTenantContext(DI.em, { appuserKey: owner.appuser.appuserKey, tenantKey: owner.tenant.tenantKey });
    const json = vi.fn();
    await getRecurringOccurrences(
      Object.assign(mockReq({ query: { from: '2026-03-01', to: '2026-03-31' } }), { appuser: owner.appuser, tenant: owner.tenant }),
      mockRes({ json }),
    );

    const body = json.mock.calls[0]?.[0] as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({ currency: 'EUR', expectedAmount: 39.9, name: 'Internet', status: 'paid' });
  });

  it('returns nothing when the household has no confirmed series', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    await addSeries(em, { currencyKey: owner.currency, displayName: 'Candidate', nextExpectedAt: day('2026-03-10'), status: RecurringSeriesStatus.candidate, tenantKey: owner.tenant });

    setTenantContext(DI.em, { appuserKey: owner.appuser.appuserKey, tenantKey: owner.tenant.tenantKey });
    const json = vi.fn();
    await getRecurringOccurrences(
      Object.assign(mockReq({ query: { from: '2026-03-01', to: '2026-03-31' } }), { appuser: owner.appuser, tenant: owner.tenant }),
      mockRes({ json }),
    );

    expect(json).toHaveBeenCalledWith({ items: [] });
  });

  it('rejects an inverted or oversized range', async () => {
    const req = (query: Record<string, string>) => Object.assign(mockReq({ query }), { appuser: undefined, tenant: { tenantKey: 1 } });

    await expect(getRecurringOccurrences(req({ from: '2026-03-31', to: '2026-03-01' }), mockRes())).rejects.toBeInstanceOf(BadRequestError);
    await expect(getRecurringOccurrences(req({ from: '2026-01-01', to: '2026-03-31' }), mockRes())).rejects.toBeInstanceOf(BadRequestError);
    await expect(getRecurringOccurrences(req({ from: '2026-03-01', to: '2026-05-02' }), mockRes())).rejects.toBeInstanceOf(BadRequestError);
  });
});
