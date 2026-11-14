import { RequestContext } from '@mikro-orm/postgresql';
import { endOfMonth, startOfMonth } from 'date-fns';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { TEST_USER_HEADER } from '@app/__tests__/__helpers__/auth-session-double';
import { addAccount, addCategory, addMerchant, addPartner, addShare, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { AUTHED_MOUNTS } from '@app/openapi/route-discovery';
import type { Appuser } from '@entity/Appuser';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { RecurringSeries } from '@entity/RecurringSeries';
import { errorHandler } from '@middleware/error-handler';
import { authedTenant } from '@middleware/stacks';
import { RecurringSeriesStatus } from '@service/recurring/recurring-types';

/*
 * A private account the member was not given access to never reaches any of their totals, lists or
 * reports. Every read endpoint that totals or lists account data is asked, as that member, twice:
 * with the hidden account in the household, and after it (with its transaction, recurring series
 * and installment plan) is moved to another household. The answers must be the same, and carry
 * neither the account's marker name nor its amount. Once the account is shared with them (view
 * only), the lists show it, so the markers are findable and their absence means something.
 */
const MARKER = 'SENTINELHIDDEN';
const AMOUNT = 4321.98;

const start = startOfMonth(new Date());
const end = endOfMonth(new Date());
/** Every row is dated on the month's first day at noon, inside every range asked for. */
const DATED = new Date(start.getTime() + 12 * 60 * 60 * 1000);
const day = (date: Date) => date.toISOString().slice(0, 10);
const range = `fromDate=${start.toISOString()}&toDate=${end.toISOString()}&timezone=UTC`;
const month = day(start).slice(0, 7);

/** Every read of account data that a hidden account could leak into. */
const AGGREGATES = [
  '/v1/account',
  '/v1/account/metrics',
  `/v1/account/cashflow?${range}`,
  '/v1/account/forecast?days=30',
  '/v1/account/transaction',
  `/v1/account/transaction/category-spending?${range}`,
  '/v1/account/transaction/review-summary',
  '/v1/account/transaction-merchants',
  '/v1/net-worth',
  '/v1/net-worth/history',
  `/v1/reports/spending-by-category?${range}`,
  `/v1/reports/spending-by-category.csv?${range}`,
  `/v1/reports/spending-vs-normal?${range}&month=${month}`,
  `/v1/reports/cashflow?${range}`,
  `/v1/reports/cashflow.csv?${range}`,
  `/v1/reports/month-comparison?${range}&base=${month}&compare=${month}`,
  `/v1/reports/sankey?${range}`,
  `/v1/reports/net-worth-history?${range}`,
  `/v1/reports/net-worth-history.csv?${range}`,
  `/v1/reports/budget-vs-actual?${range}`,
  '/v1/insights',
  '/v1/recurring',
  '/v1/recurring/summary',
  `/v1/recurring/occurrences?from=${day(start)}&to=${day(end)}`,
  '/v1/installment-plans',
  '/v1/installment-plans/commitments',
  '/v1/installment-plans/suggestions',
  '/v1/budget',
];

describe('a private account hidden from a member', () => {
  const db = useTestDatabase();
  beforeEach(() => {
    DI.em = db.orm.em;
  });

  async function app() {
    const server = express();
    server.use((_req, _res, next) => {
      RequestContext.create(db.orm.em, next);
    });
    server.use(express.json());
    for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) server.use(mount, ...authedTenant(), await load());
    server.use(errorHandler);
    return server;
  }

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const member: Appuser = await addPartner(em, owner);
    const food = await addCategory(em, owner, 'Food');
    const groceries = await addCategory(em, owner, 'Groceries', food);
    await addTransaction(em, owner, { amount: -12.5, category: groceries, date: DATED, status: 'BOOKED' });
    const hidden = await addAccount(em, owner, { appuserCurrencyBalance: AMOUNT, balance: AMOUNT, isPrivate: true, name: `${MARKER} account` });
    const merchant = await addMerchant(em, owner, `${MARKER} shop`);
    await addTransaction(em, owner, { account: hidden, amount: -AMOUNT, category: groceries, date: DATED, merchant, status: 'BOOKED' });
    em.create(RecurringSeries, { accountKey: hidden, displayName: `${MARKER} gym`, expectedAmount: AMOUNT, normalizedMerchantKey: 'sentinel', status: RecurringSeriesStatus.confirmed, tenantKey: owner.tenant }, { partial: true });
    em.create(InstallmentPlan, { accountKey: hidden, description: `${MARKER} laptop`, installmentCount: 3, purchaseDate: DATED, tenantKey: owner.tenant, totalAmount: AMOUNT }, { partial: true });
    await em.flush();
    return { hidden, member, owner };
  }

  const leaks = (text: string) => text.includes(MARKER) || text.includes(String(AMOUNT));

  /** Move the account and everything on it to another household: for the member, as if it never existed. */
  async function removeFromHousehold(hiddenKey: number) {
    const elsewhere = await seedHousehold(db.em());
    const connection = db.em().getConnection();
    const tenant = elsewhere.tenant.tenantKey;
    for (const table of ['transaction', 'recurring_series', 'installment_plan']) {
      await connection.execute(`update "${table}" set "tenant_key" = ? where "account_key" = ?`, [tenant, hiddenKey]);
    }
    await connection.execute('update "transaction_merchant" set "tenant_key" = ? where "name" like ?', [tenant, `${MARKER}%`]);
    await connection.execute('update "account" set "tenant_key" = ? where "account_key" = ?', [tenant, hiddenKey]);
  }

  const read = async (server: express.Express, path: string, member: Appuser) => {
    const response = await request(server).get(path).set(TEST_USER_HEADER, member.externalUserId);
    // The time a report was made is the only thing allowed to differ between two reads.
    return { status: response.status, text: response.text.replaceAll(/"generatedAt":"[^"]*"/gu, '"generatedAt":""') };
  };

  it.each(AGGREGATES)('%s answers as if it did not exist', async (path) => {
    const { hidden, member } = await household();
    const server = await app();

    const withHidden = await read(server, path, member);
    await removeFromHousehold(hidden.accountKey);
    const without = await read(server, path, member);

    expect(withHidden.status).toBe(200);
    expect(leaks(withHidden.text)).toBe(false);
    expect(withHidden.text).toEqual(without.text);
  });

  it('shows it once shared with the member', async () => {
    const { hidden, member, owner } = await household();
    await addShare(db.em(), owner, hidden, member, 'read');
    const server = await app();

    for (const path of ['/v1/account', '/v1/account/metrics', '/v1/account/transaction', '/v1/account/transaction-merchants', '/v1/net-worth', '/v1/recurring', '/v1/installment-plans']) {
      expect({ path, shown: leaks((await read(server, path, member)).text) }).toEqual({ path, shown: true });
    }
  });
});
