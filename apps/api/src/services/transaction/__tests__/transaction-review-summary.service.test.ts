import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Transaction } from '@entity/Transaction';
import { listTransactions } from '@service/transaction/transaction-list.service';
import { getTransactionReviewSummary } from '@service/transaction/transaction-review-summary.service';

/*
 * The home's review status is the review inbox's own number: how many transactions the list
 * returns with `unreviewedOnly=true`, and what their amounts add up to in the viewer's currency.
 * The household is built so the rules that decide "the transactions awaiting review" disagree if
 * the summary ever applies a scope of its own: a reviewed row, an expired row, a hidden row, each
 * member's private account, and a second household.
 */
describe('transaction review summary', () => {
  const db = useTestDatabase();
  const DAY = new Date('2026-07-10T12:00:00Z');

  async function markReviewed(transaction: Transaction) {
    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    stored.reviewed = true;
    await em.flush();
  }

  async function rate(em: EntityManager, from: Currency, to: Currency, value: number) {
    em.create(ExchangeRate, { date: new Date('2026-06-01T00:00:00Z'), fromCurrency: from, rate: value, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function listCount(household: Household, viewer: Appuser): Promise<number> {
    const page = await listTransactions({ filters: { unreviewedOnly: true }, limit: 1, scope: 'all-accounts', tenantKey: household.tenant.tenantKey, viewerAppuserKey: viewer.appuserKey });
    if (page.total === null) throw new Error('The first page carries the total');
    return page.total;
  }

  describe('one household, two members', () => {
    let household: Household;
    let partner: Appuser;

    beforeEach(async () => {
      const em = db.em();
      household = await seedHousehold(em);
      partner = await addPartner(em, household);
      const ownerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Owner private' });
      const partnerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });

      await addTransaction(em, household, { amount: -100, date: DAY, status: 'BOOKED' });
      await addTransaction(em, household, { account: ownerPrivate, amount: -25, date: DAY, status: 'BOOKED' });
      await addTransaction(em, household, { account: partnerPrivate, amount: -40, appuser: partner, date: DAY, status: 'BOOKED' });
      // Not awaiting review: reviewed, expired and hidden rows are not in the inbox.
      await markReviewed(await addTransaction(em, household, { amount: -50, date: DAY, status: 'BOOKED' }));
      await addTransaction(em, household, { amount: -999, date: DAY, status: 'EXPIRED' });
      await addTransaction(em, household, { amount: -15, date: DAY, hidden: true, status: 'BOOKED' });
      // Another household never counts.
      const other = await seedHousehold(em);
      await addTransaction(em, other, { amount: -1000, date: DAY, status: 'BOOKED' });
    });

    it('counts the rows the list counts, and sums what they add up to', async () => {
      const summary = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

      expect(summary).toEqual({ count: 2, currency: 'EUR', totalAbs: 125 });
      expect(summary.count).toBe(await listCount(household, household.appuser));
    });

    it('keeps each member\'s private rows to their owner, in both directions', async () => {
      const owner = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      const member = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: partner.appuserKey });

      // The owner sees their own private row (25) and the shared one (100); the partner's is hidden.
      expect(owner).toEqual({ count: 2, currency: 'EUR', totalAbs: 125 });
      // The partner sees their own private row (40) and the shared one (100); the owner's is hidden.
      expect(member).toEqual({ count: 2, currency: 'EUR', totalAbs: 140 });
      expect(member.count).toBe(await listCount(household, partner));
    });
  });

  describe('the viewer\'s currency', () => {
    it('sums in the viewer\'s base currency, converting each row at its day\'s rate', async () => {
      const em = db.em();
      const household = await seedHousehold(em);
      const eur = household.currency;
      const usd = await currencyFor(em, 'USD');
      await rate(em, usd, eur, 0.9);
      await rate(em, eur, usd, 1.1);
      const partner = await addPartner(em, household, { currency: usd });
      const partnerShared = await addAccount(em, household, { currency: usd, name: 'Partner checking', owner: partner });

      // 20 USD is 18 EUR for the owner and stays 20 USD for the partner.
      await addTransaction(em, household, { account: partnerShared, amount: -20, appuser: partner, currency: usd, date: DAY, status: 'BOOKED' });

      const owner = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      const member = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: partner.appuserKey });

      expect(owner).toEqual({ count: 1, currency: 'EUR', totalAbs: 18 });
      expect(member).toEqual({ count: 1, currency: 'USD', totalAbs: 20 });
    });
  });

  it('answers zero for a household with no transactions', async () => {
    const household = await seedHousehold(db.em());

    const summary = await getTransactionReviewSummary({ tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(summary).toEqual({ count: 0, currency: 'EUR', totalAbs: 0 });
  });
});
