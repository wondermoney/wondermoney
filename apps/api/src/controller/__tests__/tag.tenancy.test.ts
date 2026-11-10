import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { Tag } from '@entity/Tag';
import { TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionTag } from '@entity/TransactionTag';
import accountRoutes from '@route/account';
import tagRoutes from '@route/tag';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Tags are household-wide labels. A member sees and manages every tag of their household and
 * none of another's. A tag on a transaction is visible only to members who can see the
 * transaction: the other member's private-account rows never show up through a tag, a tag
 * filter or a tag-filtered report.
 */
describe('tags', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const tags = tenantHttp('/v1/tag', tagRoutes);
  const accounts = tenantHttp('/v1/account', accountRoutes);

  interface TagDto { color: string; name: string; tagKey: number }
  interface Row { tags: TagDto[]; transactionKey: number }

  async function createTag(user: Appuser, name: string, color?: string): Promise<TagDto> {
    const response = await tags.as(user).post('/v1/tag').send({ color, name });
    expect(response.status).toBe(201);
    return response.body.tag as TagDto;
  }

  const setTags = (user: Appuser, transactionKey: number, tagIds: number[]) => accounts.as(user).put(`/v1/account/transaction/${transactionKey}/tags`).send({ tagIds });

  async function listedKeys(user: Appuser, query = ''): Promise<number[]> {
    const response = await accounts.as(user).get(`/v1/account/transaction${query}`);
    expect(response.status).toBe(200);
    return (response.body.transactions as Row[]).map((row) => row.transactionKey).filter((key) => key > 0).sort((a, b) => a - b);
  }

  /** Owner and partner share one household; the owner also has a private account. A neighbour lives next door. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const shared = await addTransaction(em, owner, { amount: -30, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    const secret = await addTransaction(em, owner, { account: privateAccount, amount: -80, date: new Date('2026-07-11T12:00:00Z'), status: 'BOOKED' });
    const untagged = await addTransaction(em, owner, { amount: -5, date: new Date('2026-07-12T12:00:00Z'), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    const neighbours = await addTransaction(em, neighbour, { amount: -500, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    return { neighbour, neighbours, owner, partner, privateAccount, secret, shared, untagged };
  }

  describe('managing tags', () => {
    it('lists a tag to both members of the household and not to another household', async () => {
      const { neighbour, owner, partner } = await households();
      await createTag(owner.appuser, 'Lisbon trip', '#ff8800');

      const forPartner = await tags.as(partner).get('/v1/tag');
      const forNeighbour = await tags.as(neighbour.appuser).get('/v1/tag');

      expect(forPartner.body.tags).toEqual([expect.objectContaining({ color: '#ff8800', name: 'Lisbon trip' })]);
      expect(forNeighbour.body.tags).toEqual([]);
    });

    it('rejects a second tag whose name differs only in case', async () => {
      const { owner, partner } = await households();
      await createTag(owner.appuser, 'Work');

      const response = await tags.as(partner).post('/v1/tag').send({ name: '  work ' });

      expect(response.status).toBe(409);
    });

    it('allows the same name in another household', async () => {
      const { neighbour, owner } = await households();
      await createTag(owner.appuser, 'Work');

      const response = await tags.as(neighbour.appuser).post('/v1/tag').send({ name: 'Work' });

      expect(response.status).toBe(201);
    });

    it('frees the name once the tag is deleted', async () => {
      const { owner } = await households();
      const work = await createTag(owner.appuser, 'Work');
      await tags.as(owner.appuser).delete(`/v1/tag/${work.tagKey}`);

      const response = await tags.as(owner.appuser).post('/v1/tag').send({ name: 'WORK' });

      expect(response.status).toBe(201);
    });

    it('rejects a rename onto another tag\'s name but allows changing a tag\'s own case', async () => {
      const { owner } = await households();
      await createTag(owner.appuser, 'Work');
      const trip = await createTag(owner.appuser, 'Trip');

      const clash = await tags.as(owner.appuser).patch(`/v1/tag/${trip.tagKey}`).send({ name: 'WORK' });
      const recase = await tags.as(owner.appuser).patch(`/v1/tag/${trip.tagKey}`).send({ color: '#00aa00', name: 'TRIP' });

      expect(clash.status).toBe(409);
      expect(recase.status).toBe(200);
      expect(recase.body.tag).toMatchObject({ color: '#00aa00', name: 'TRIP' });
    });

    it('rejects an empty name and a color that is not #rrggbb', async () => {
      const { owner } = await households();

      const blank = await tags.as(owner.appuser).post('/v1/tag').send({ name: '   ' });
      const badColor = await tags.as(owner.appuser).post('/v1/tag').send({ color: 'red', name: 'Trip' });

      expect(blank.status).toBe(400);
      expect(badColor.status).toBe(400);
    });

    it('does not let another household see, rename or delete a tag', async () => {
      const { neighbour, owner } = await households();
      const work = await createTag(owner.appuser, 'Work');

      const rename = await tags.as(neighbour.appuser).patch(`/v1/tag/${work.tagKey}`).send({ name: 'Mine now' });
      const remove = await tags.as(neighbour.appuser).delete(`/v1/tag/${work.tagKey}`);

      expect(rename.status).toBe(404);
      expect(remove.status).toBe(404);
      const stored = await db.em().findOneOrFail(Tag, { tagKey: work.tagKey }, { filters: false });
      expect(stored).toMatchObject({ deletedAt: null, name: 'Work' });
    });
  });

  describe('tagging transactions', () => {
    it('sets the full list of tags and shows them on the row', async () => {
      const { owner, shared } = await households();
      const work = await createTag(owner.appuser, 'Work');
      const trip = await createTag(owner.appuser, 'Trip');

      await setTags(owner.appuser, shared.transactionKey, [work.tagKey, trip.tagKey]);
      const replaced = await setTags(owner.appuser, shared.transactionKey, [trip.tagKey]);

      expect(replaced.status).toBe(200);
      const response = await accounts.as(owner.appuser).get('/v1/account/transaction');
      const row = (response.body.transactions as Row[]).find((candidate) => candidate.transactionKey === shared.transactionKey);
      expect(row?.tags).toEqual([{ color: trip.color, name: 'Trip', tagKey: trip.tagKey }]);
    });

    it('untags a transaction with an empty list', async () => {
      const { owner, shared } = await households();
      const work = await createTag(owner.appuser, 'Work');
      await setTags(owner.appuser, shared.transactionKey, [work.tagKey]);

      await setTags(owner.appuser, shared.transactionKey, []);

      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
    });

    it('records the change in the transaction\'s history', async () => {
      const { owner, shared } = await households();
      const work = await createTag(owner.appuser, 'Work');

      await setTags(owner.appuser, shared.transactionKey, [work.tagKey]);

      const history = await accounts.as(owner.appuser).get(`/v1/account/transaction/${shared.transactionKey}/history`);
      expect(history.body.history).toEqual([
        expect.objectContaining({ changes: { tagKeys: { from: [], to: [work.tagKey] } }, eventType: TransactionAuditEventType.USER_EDIT }),
      ]);
    });

    it('tags a new transaction from the tags it is created with', async () => {
      const { owner } = await households();
      const work = await createTag(owner.appuser, 'Work');

      const created = await accounts.as(owner.appuser).post(`/v1/account/${owner.account.accountKey}/transaction`).send({
        settlementAmount: 12,
        settlementCurrencyId: owner.currency.currencyKey,
        tagIds: [work.tagKey],
        transactionDate: '2026-07-20T12:00:00Z',
        transactionMerchantName: 'Cafe',
        transactionTypeId: owner.types.cardPayment.transactionTypeKey,
      });

      expect(created.status).toBe(201);
      const tagged = await accounts.as(owner.appuser).get(`/v1/account/transaction?tagKeys=${work.tagKey}`);
      expect((tagged.body.transactions as Row[]).map((row) => row.tags)).toEqual([[expect.objectContaining({ tagKey: work.tagKey })]]);
    });

    it('does not create a transaction with another household\'s tag', async () => {
      const { neighbour, owner } = await households();
      const theirs = await createTag(neighbour.appuser, 'Theirs');

      const created = await accounts.as(owner.appuser).post(`/v1/account/${owner.account.accountKey}/transaction`).send({
        settlementAmount: 12,
        settlementCurrencyId: owner.currency.currencyKey,
        tagIds: [theirs.tagKey],
        transactionDate: '2026-07-20T12:00:00Z',
        transactionMerchantName: 'Cafe',
        transactionTypeId: owner.types.cardPayment.transactionTypeKey,
      });

      expect(created.status).toBe(404);
      expect(await listedKeys(owner.appuser)).toHaveLength(3);
    });

    it('does not put another household\'s tag on a transaction', async () => {
      const { neighbour, owner, shared } = await households();
      const theirs = await createTag(neighbour.appuser, 'Theirs');

      const response = await setTags(owner.appuser, shared.transactionKey, [theirs.tagKey]);

      expect(response.status).toBe(404);
      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
    });

    it('does not let another household tag a transaction', async () => {
      const { neighbour, shared } = await households();
      const theirs = await createTag(neighbour.appuser, 'Theirs');

      const response = await setTags(neighbour.appuser, shared.transactionKey, [theirs.tagKey]);

      expect(response.status).toBe(404);
      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
    });

    it('does not let the partner tag a transaction on the owner\'s private account', async () => {
      const { owner, partner, secret } = await households();
      const work = await createTag(owner.appuser, 'Work');

      const response = await setTags(partner, secret.transactionKey, [work.tagKey]);

      expect(response.status).toBe(404);
      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
    });

    it('takes a deleted tag off every transaction, the other member\'s private ones included', async () => {
      const { owner, partner, secret, shared } = await households();
      const work = await createTag(owner.appuser, 'Work');
      await setTags(owner.appuser, shared.transactionKey, [work.tagKey]);
      await setTags(owner.appuser, secret.transactionKey, [work.tagKey]);

      const response = await tags.as(partner).delete(`/v1/tag/${work.tagKey}`);

      expect(response.status).toBe(200);
      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
      const audited = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.USER_EDIT }, { filters: false });
      expect(audited.map((entry) => entry.transactionKey.transactionKey).sort((a, b) => a - b)).toEqual([shared.transactionKey, secret.transactionKey].sort((a, b) => a - b).flatMap((key) => [key, key]));
    });
  });

  describe('filtering by tag', () => {
    async function tagged() {
      const setup = await households();
      const { neighbour, neighbours, owner, secret, shared, untagged } = setup;
      const work = await createTag(owner.appuser, 'Work');
      const trip = await createTag(owner.appuser, 'Trip');
      const theirs = await createTag(neighbour.appuser, 'Theirs');
      await setTags(owner.appuser, shared.transactionKey, [work.tagKey]);
      await setTags(owner.appuser, secret.transactionKey, [work.tagKey]);
      await setTags(owner.appuser, untagged.transactionKey, [trip.tagKey]);
      await setTags(neighbour.appuser, neighbours.transactionKey, [theirs.tagKey]);
      return { ...setup, theirs, trip, work };
    }

    it('lists the transactions carrying any of the tags', async () => {
      const { owner, secret, shared, trip, untagged, work } = await tagged();

      expect(await listedKeys(owner.appuser, `?tagKeys=${work.tagKey}`)).toEqual([shared.transactionKey, secret.transactionKey].sort((a, b) => a - b));
      expect(await listedKeys(owner.appuser, `?tagKeys=${work.tagKey},${trip.tagKey}`)).toEqual([shared.transactionKey, secret.transactionKey, untagged.transactionKey].sort((a, b) => a - b));
    });

    it('filters one account\'s list and leaves out its opening-balance row', async () => {
      const { owner, shared, work } = await tagged();

      const response = await accounts.as(owner.appuser).get(`/v1/account/${owner.account.accountKey}/transaction?tagKeys=${work.tagKey}`);

      expect((response.body.transactions as Row[]).map((row) => row.transactionKey)).toEqual([shared.transactionKey]);
      expect(response.body.total).toBe(1);
    });

    it('never shows the partner the owner\'s private rows through a tag', async () => {
      const { partner, secret, shared, work } = await tagged();

      const response = await accounts.as(partner).get(`/v1/account/transaction?tagKeys=${work.tagKey}`);

      expect((response.body.transactions as Row[]).map((row) => row.transactionKey)).toEqual([shared.transactionKey]);
      expect(response.body.total).toBe(1);
      expect((response.body.transactions as Row[]).map((row) => row.transactionKey)).not.toContain(secret.transactionKey);
    });

    it('matches nothing for another household\'s tag', async () => {
      const { owner, theirs } = await tagged();

      expect(await listedKeys(owner.appuser, `?tagKeys=${theirs.tagKey}`)).toEqual([]);
    });

    describe('in reports', () => {
      const report = (household: Household, user: Appuser, tagKeys: number[]) => getSpendingByCategoryReport({
        filters: reportFiltersSchema.parse({ fromDate: '2026-07-01T00:00:00Z', tagKeys: tagKeys.map(String), toDate: '2026-07-31T23:59:59Z' }),
        tenant: household.tenant,
        user,
      });
      const spent = (result: Awaited<ReturnType<typeof getSpendingByCategoryReport>>) => result.data.reduce((sum, row) => sum + row.totalAmount, 0);

      it('counts only the tagged spending', async () => {
        const { owner, work } = await tagged();

        expect(spent(await report(owner, owner.appuser, [work.tagKey]))).toBe(110);
      });

      it('leaves the owner\'s private spending out of the partner\'s tag report', async () => {
        const { owner, partner, work } = await tagged();

        expect(spent(await report(owner, partner, [work.tagKey]))).toBe(30);
      });

      it('finds nothing for another household\'s tag', async () => {
        const { owner, theirs } = await tagged();

        expect(spent(await report(owner, owner.appuser, [theirs.tagKey]))).toBe(0);
      });
    });
  });
});
