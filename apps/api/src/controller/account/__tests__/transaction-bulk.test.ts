import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { Tag } from '@entity/Tag';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionTag } from '@entity/TransactionTag';
import accountRoutes from '@route/account';

/*
 * Bulk changes to transactions: tagging, and acting on every row that matches a filter instead of
 * a list of ids ("select all matching"). A filter selects exactly what `GET /v1/account/transaction`
 * would list for the member sending it, and nothing else: never another household's rows, nor the
 * other member's private-account rows. A selection is capped at 5,000 rows; a filter matching more
 * is refused outright rather than applied to an arbitrary 5,000 of them.
 */
describe('bulk transaction changes', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  const MARCH = { fromDate: '2026-03-01T00:00:00.000Z', toDate: '2026-03-31T23:59:59.999Z' };
  const march = (day: number) => new Date(`2026-03-${String(day).padStart(2, '0')}T12:00:00Z`);

  async function tag(household: Household, name: string): Promise<Tag> {
    const em = db.em();
    const created = em.create(Tag, { color: '#94a3b8', createdByAppuserKey: household.appuser, name, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return created;
  }

  async function tagKeysOf(transactionKey: number): Promise<number[]> {
    const links = await db.em().find(TransactionTag, { transactionKey: { transactionKey } }, { filters: false });
    return links.map((link) => link.tagKey.tagKey).sort((a, b) => a - b);
  }

  async function stored(transactionKey: number): Promise<Transaction> {
    return db.em().findOneOrFail(Transaction, { transactionKey }, { filters: false });
  }

  /** Owner and partner share a household and an account; each has a private account. A neighbour lives next door. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const ownersPrivate = await addAccount(em, owner, { isPrivate: true });
    const partnersPrivate = await addAccount(em, owner, { isPrivate: true, owner: partner });
    const shared = await addTransaction(em, owner, { amount: -30, date: march(10), status: 'BOOKED' });
    const sharedToo = await addTransaction(em, owner, { amount: -40, date: march(11), status: 'BOOKED' });
    const ownersSecret = await addTransaction(em, owner, { account: ownersPrivate, amount: -80, date: march(12), status: 'BOOKED' });
    const partnersOwn = await addTransaction(em, owner, { account: partnersPrivate, amount: -15, appuser: partner, date: march(13), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    const neighbours = await addTransaction(em, neighbour, { amount: -500, date: march(10), status: 'BOOKED' });
    return { neighbour, neighbours, owner, ownersPrivate, ownersSecret, partner, partnersOwn, partnersPrivate, shared, sharedToo };
  }

  const patch = (user: Appuser, body: object) => http.as(user).patch('/v1/account/transaction').send(body);
  const remove = (user: Appuser, body: object) => http.as(user).delete('/v1/account/transaction').send(body);

  describe('tagging', () => {
    it('adds and removes tags on every selected row and records each change in its history', async () => {
      const { owner, shared, sharedToo } = await households();
      const trip = await tag(owner, 'Trip');
      const work = await tag(owner, 'Work');
      await patch(owner.appuser, { addTagIds: [work.tagKey], transactionIds: [shared.transactionKey] });

      const response = await patch(owner.appuser, { addTagIds: [trip.tagKey], removeTagIds: [work.tagKey], transactionIds: [shared.transactionKey, sharedToo.transactionKey] });

      expect(response.status).toBe(200);
      expect(await tagKeysOf(shared.transactionKey)).toEqual([trip.tagKey]);
      expect(await tagKeysOf(sharedToo.transactionKey)).toEqual([trip.tagKey]);
      const history = await http.as(owner.appuser).get(`/v1/account/transaction/${shared.transactionKey}/history`);
      expect(history.body.history).toEqual(expect.arrayContaining([
        expect.objectContaining({ changes: { tagKeys: { from: [work.tagKey], to: [trip.tagKey] } }, eventType: TransactionAuditEventType.USER_EDIT }),
      ]));
    });

    it('leaves a row that already carries the tag as it is, without a history entry', async () => {
      const { owner, shared } = await households();
      const trip = await tag(owner, 'Trip');
      await patch(owner.appuser, { addTagIds: [trip.tagKey], transactionIds: [shared.transactionKey] });

      await patch(owner.appuser, { addTagIds: [trip.tagKey], transactionIds: [shared.transactionKey] });

      expect(await tagKeysOf(shared.transactionKey)).toEqual([trip.tagKey]);
      expect(await db.em().count(TransactionAuditLog, { transactionKey: { transactionKey: shared.transactionKey } }, { filters: false })).toBe(1);
    });

    it('refuses another household\'s tag and the same tag added and removed at once', async () => {
      const { neighbour, owner, shared } = await households();
      const theirs = await tag(neighbour, 'Theirs');
      const trip = await tag(owner, 'Trip');

      const foreign = await patch(owner.appuser, { addTagIds: [theirs.tagKey], transactionIds: [shared.transactionKey] });
      const both = await patch(owner.appuser, { addTagIds: [trip.tagKey], removeTagIds: [trip.tagKey], transactionIds: [shared.transactionKey] });

      expect(foreign.status).toBe(404);
      expect(both.status).toBe(400);
      expect(await tagKeysOf(shared.transactionKey)).toEqual([]);
    });
  });

  describe('selecting by filter', () => {
    it('changes every row the filter lists, not only those on a loaded page', async () => {
      const { owner, shared, sharedToo } = await households();
      const trip = await tag(owner, 'Trip');

      const response = await patch(owner.appuser, { addTagIds: [trip.tagKey], filter: { ...MARCH, accountKeys: String(owner.account.accountKey) }, reviewed: true });

      expect(response.status).toBe(200);
      expect(await tagKeysOf(shared.transactionKey)).toEqual([trip.tagKey]);
      expect(await tagKeysOf(sharedToo.transactionKey)).toEqual([trip.tagKey]);
      expect((await stored(shared.transactionKey)).reviewed).toBe(true);
    });

    it('accepts the list\'s filters as JSON values as well as query-string text', async () => {
      const { owner, shared, sharedToo } = await households();

      await patch(owner.appuser, { filter: { ...MARCH, accountKeys: [owner.account.accountKey], unreviewedOnly: true }, hidden: true });

      expect((await stored(shared.transactionKey)).hidden).toBe(true);
      expect((await stored(sharedToo.transactionKey)).hidden).toBe(true);
    });

    it('reaches hidden rows only when the filter includes them, as the list does', async () => {
      const { owner, shared } = await households();
      await patch(owner.appuser, { hidden: true, transactionIds: [shared.transactionKey] });

      await patch(owner.appuser, { filter: MARCH, reviewed: true });
      expect((await stored(shared.transactionKey)).reviewed).toBe(false);

      await patch(owner.appuser, { filter: { ...MARCH, includeHidden: true }, hidden: false });
      expect((await stored(shared.transactionKey)).hidden).toBe(false);
    });

    it('unhides a hidden row named by id', async () => {
      const { owner, shared } = await households();
      await patch(owner.appuser, { hidden: true, transactionIds: [shared.transactionKey] });

      const response = await patch(owner.appuser, { hidden: false, transactionIds: [shared.transactionKey] });

      expect(response.status).toBe(200);
      expect((await stored(shared.transactionKey)).hidden).toBe(false);
    });

    it('refuses a filter key the list does not know, rather than ignoring it and widening the selection', async () => {
      const { owner, shared } = await households();

      const response = await remove(owner.appuser, { filter: { ...MARCH, accountKey: owner.account.accountKey } });

      expect(response.status).toBe(400);
      expect((await stored(shared.transactionKey)).deletedAt).toBeNull();
    });

    it('needs exactly one of transactionIds and filter', async () => {
      const { owner, shared } = await households();

      const neither = await patch(owner.appuser, { reviewed: true });
      const both = await patch(owner.appuser, { filter: MARCH, reviewed: true, transactionIds: [shared.transactionKey] });

      expect([neither.status, both.status]).toEqual([400, 400]);
    });
  });

  describe('tenancy and privacy of a filter', () => {
    it('updates only the sender\'s household and never the other member\'s private rows', async () => {
      const { neighbours, ownersSecret, partner, partnersOwn, shared, sharedToo } = await households();

      const response = await patch(partner, { filter: MARCH, hidden: true });

      expect(response.status).toBe(200);
      expect((await stored(shared.transactionKey)).hidden).toBe(true);
      expect((await stored(sharedToo.transactionKey)).hidden).toBe(true);
      expect((await stored(partnersOwn.transactionKey)).hidden).toBe(true);
      expect((await stored(ownersSecret.transactionKey)).hidden).toBe(false);
      expect((await stored(neighbours.transactionKey)).hidden).toBe(false);
    });

    it('does not reach the other member\'s private account by naming it in the filter', async () => {
      const { ownersPrivate, ownersSecret, partner } = await households();

      const tagged = await patch(partner, { filter: { ...MARCH, accountKeys: String(ownersPrivate.accountKey) }, reviewed: true });
      const deleted = await remove(partner, { filter: { ...MARCH, accountKeys: String(ownersPrivate.accountKey) } });

      expect(tagged.status).toBe(200);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ deletedTransactionIds: [], skipped: [] });
      expect(await stored(ownersSecret.transactionKey)).toMatchObject({ deletedAt: null, reviewed: false });
    });

    it('deletes only the sender\'s household\'s rows the filter matches, the other member\'s private rows and another household\'s untouched', async () => {
      const { neighbours, ownersSecret, partner, partnersOwn, shared, sharedToo } = await households();

      const response = await remove(partner, { filter: MARCH });

      expect(response.status).toBe(200);
      expect([...response.body.deletedTransactionIds].sort((a: number, b: number) => a - b)).toEqual([shared.transactionKey, sharedToo.transactionKey, partnersOwn.transactionKey].sort((a, b) => a - b));
      expect((await stored(ownersSecret.transactionKey)).deletedAt).toBeNull();
      expect((await stored(neighbours.transactionKey)).deletedAt).toBeNull();
      const audited = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.SOFT_DELETED }, { filters: false });
      expect(audited).toHaveLength(3);
    });

    it('does not change another household\'s rows named by id', async () => {
      const { neighbours, owner } = await households();

      const response = await patch(owner.appuser, { hidden: true, transactionIds: [neighbours.transactionKey] });

      expect(response.status).toBe(404);
      expect((await stored(neighbours.transactionKey)).hidden).toBe(false);
    });
  });

  describe('the 5,000-row cap', () => {
    async function manyRows(household: Household, count: number) {
      const em = db.em();
      const rows = Array.from({ length: count }, (_, index) => ({
        accountKey: household.account.accountKey,
        appuserCurrencyKey: household.currency.currencyKey,
        appuserKey: household.appuser.appuserKey,
        appuserSettlementAmount: -1,
        createdAt: new Date(),
        description: `Row ${index}`,
        hidden: false,
        reviewed: false,
        settlementAmount: -1,
        settlementCurrencyKey: household.currency.currencyKey,
        tenantKey: household.tenant.tenantKey,
        transactionDate: new Date(Date.UTC(2026, 3, 1, 0, 0, index % 3600)),
        transactionStatusKey: household.statuses.BOOKED.transactionStatusKey,
        transactionTypeKey: household.types.cardPayment.transactionTypeKey,
        updatedAt: new Date(),
      }));
      await em.insertMany(Transaction, rows as never[]);
    }

    const APRIL = { fromDate: '2026-04-01T00:00:00.000Z', toDate: '2026-04-30T23:59:59.999Z' };

    it('refuses a filter that matches more than 5,000 rows and changes none of them', async () => {
      const owner = await seedHousehold(db.em());
      await manyRows(owner, 5001);

      const updated = await patch(owner.appuser, { filter: APRIL, reviewed: true });
      const deleted = await remove(owner.appuser, { filter: APRIL });

      expect(updated.status).toBe(400);
      expect(updated.body).toMatchObject({ code: 'bulk_selection_too_large' });
      expect(deleted.status).toBe(400);
      expect(await db.em().count(Transaction, { reviewed: true, tenantKey: owner.tenant }, { filters: false })).toBe(0);
      expect(await db.em().count(Transaction, { deletedAt: { $ne: null }, tenantKey: owner.tenant }, { filters: false })).toBe(0);
    }, 60_000);

    it('applies a filter that matches exactly 5,000 rows', async () => {
      const owner = await seedHousehold(db.em());
      await manyRows(owner, 5000);

      const updated = await patch(owner.appuser, { filter: APRIL, reviewed: true });

      expect(updated.status).toBe(200);
      expect(await db.em().count(Transaction, { reviewed: true, tenantKey: owner.tenant }, { filters: false })).toBe(5000);
    }, 60_000);

    it('refuses more than 5,000 ids', async () => {
      const owner = await seedHousehold(db.em());

      const response = await patch(owner.appuser, { reviewed: true, transactionIds: Array.from({ length: 5001 }, (_, index) => index + 1) });

      expect(response.status).toBe(400);
    });
  });
});
