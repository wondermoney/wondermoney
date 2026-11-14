import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { TransactionTemplate } from '@entity/TransactionTemplate';
import transactionTemplateRoutes from '@route/transaction-template';

/*
 * Templates are private to the member who created them, and a template can only name an
 * account that member can see. Another member's template is a 404, never a 403: its existence
 * is not disclosed.
 */
describe('transaction templates', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const templates = tenantHttp('/v1/transaction-template', transactionTemplateRoutes);

  interface TemplateDto {
    account: null | { accountKey: number; accountName: null | string };
    amount: null | number;
    category: null | { categoryKey: number; name: string };
    description: null | string;
    direction: 'in' | 'out';
    name: string;
    notes: null | string;
    position: number;
    transactionMerchant: null | { name: string; transactionMerchantKey: number };
    transactionTemplateKey: number;
  }

  async function createTemplate(user: Appuser, body: Record<string, unknown>) {
    const response = await templates.as(user).post('/v1/transaction-template').send(body);
    expect(response.status).toBe(201);
    return response.body.template as TemplateDto;
  }

  async function listed(user: Appuser): Promise<TemplateDto[]> {
    const response = await templates.as(user).get('/v1/transaction-template');
    expect(response.status).toBe(200);
    return response.body.templates as TemplateDto[];
  }

  /** Owner and partner share one household; the owner also has a private account. A neighbour lives next door. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const category = await addCategory(em, owner, 'Groceries');
    const merchant = await addMerchant(em, owner, 'Corner shop');
    const neighbour = await seedHousehold(em);
    return { category, merchant, neighbour, owner, partner, privateAccount };
  }

  describe('managing templates', () => {
    it('creates a template from scratch and reads it back', async () => {
      const { category, merchant, owner } = await households();

      const created = await createTemplate(owner.appuser, {
        accountKey: owner.account.accountKey,
        amount: 42.5,
        categoryKey: category.categoryKey,
        description: 'Saturday market',
        direction: 'out',
        name: 'Weekly groceries',
        notes: 'Cash',
        transactionMerchantKey: merchant.transactionMerchantKey,
      });

      expect(created).toMatchObject({
        account: { accountKey: owner.account.accountKey },
        amount: 42.5,
        category: { categoryKey: category.categoryKey, name: 'Groceries' },
        description: 'Saturday market',
        direction: 'out',
        name: 'Weekly groceries',
        notes: 'Cash',
        position: 0,
        transactionMerchant: { name: 'Corner shop', transactionMerchantKey: merchant.transactionMerchantKey },
      });
      expect(await listed(owner.appuser)).toEqual([expect.objectContaining({ transactionTemplateKey: created.transactionTemplateKey })]);
    });

    it('appends new templates and orders the list by position', async () => {
      const { owner } = await households();
      const first = await createTemplate(owner.appuser, { direction: 'out', name: 'First' });
      const second = await createTemplate(owner.appuser, { direction: 'out', name: 'Second' });
      const third = await createTemplate(owner.appuser, { direction: 'out', name: 'Third' });

      expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);

      const moved = await templates.as(owner.appuser).patch(`/v1/transaction-template/${first.transactionTemplateKey}`).send({ position: 5 });
      expect(moved.status).toBe(200);

      expect((await listed(owner.appuser)).map((template) => template.name)).toEqual(['Second', 'Third', 'First']);
    });

    it('updates every field and clears an optional one with null', async () => {
      const { category, merchant, owner } = await households();
      const created = await createTemplate(owner.appuser, {
        accountKey: owner.account.accountKey,
        categoryKey: category.categoryKey,
        direction: 'out',
        name: 'Old name',
        transactionMerchantKey: merchant.transactionMerchantKey,
      });

      const response = await templates.as(owner.appuser).patch(`/v1/transaction-template/${created.transactionTemplateKey}`).send({
        accountKey: null,
        amount: 12,
        categoryKey: null,
        description: 'New description',
        direction: 'in',
        name: 'New name',
        notes: 'New note',
        transactionMerchantKey: null,
      });

      expect(response.status).toBe(200);
      expect(response.body.template).toMatchObject({
        account: null,
        amount: 12,
        category: null,
        description: 'New description',
        direction: 'in',
        name: 'New name',
        notes: 'New note',
        transactionMerchant: null,
      });
    });

    it('soft-deletes a template', async () => {
      const { owner } = await households();
      const created = await createTemplate(owner.appuser, { direction: 'out', name: 'Gone' });

      const response = await templates.as(owner.appuser).delete(`/v1/transaction-template/${created.transactionTemplateKey}`);

      expect(response.status).toBe(204);
      expect(await listed(owner.appuser)).toEqual([]);
      const stored = await db.em().findOneOrFail(TransactionTemplate, { transactionTemplateKey: created.transactionTemplateKey }, { filters: false });
      expect(stored.deletedAt).toBeInstanceOf(Date);
    });

    it('rejects a blank name, a missing direction and a non-positive amount', async () => {
      const { owner } = await households();

      const blank = await templates.as(owner.appuser).post('/v1/transaction-template').send({ direction: 'out', name: '   ' });
      const noDirection = await templates.as(owner.appuser).post('/v1/transaction-template').send({ name: 'No direction' });
      const zero = await templates.as(owner.appuser).post('/v1/transaction-template').send({ amount: 0, direction: 'out', name: 'Zero' });

      expect(blank.status).toBe(400);
      expect(noDirection.status).toBe(400);
      expect(zero.status).toBe(400);
    });
  });

  describe('privacy', () => {
    it('never lists one member\'s templates to the other member or to another household', async () => {
      const { neighbour, owner, partner } = await households();
      await createTemplate(owner.appuser, { direction: 'out', name: 'Mine' });

      expect(await listed(partner)).toEqual([]);
      expect(await listed(neighbour.appuser)).toEqual([]);
    });

    it('does not let another member or household patch or delete a template', async () => {
      const { neighbour, owner, partner } = await households();
      const created = await createTemplate(owner.appuser, { direction: 'out', name: 'Mine' });

      const partnerPatch = await templates.as(partner).patch(`/v1/transaction-template/${created.transactionTemplateKey}`).send({ name: 'Theirs now' });
      const partnerDelete = await templates.as(partner).delete(`/v1/transaction-template/${created.transactionTemplateKey}`);
      const neighbourPatch = await templates.as(neighbour.appuser).patch(`/v1/transaction-template/${created.transactionTemplateKey}`).send({ name: 'Theirs now' });
      const neighbourDelete = await templates.as(neighbour.appuser).delete(`/v1/transaction-template/${created.transactionTemplateKey}`);

      expect([partnerPatch.status, partnerDelete.status, neighbourPatch.status, neighbourDelete.status]).toEqual([404, 404, 404, 404]);
      const stored = await db.em().findOneOrFail(TransactionTemplate, { transactionTemplateKey: created.transactionTemplateKey }, { filters: false });
      expect(stored).toMatchObject({ deletedAt: null, name: 'Mine' });
    });

    it('refuses an account the member cannot see', async () => {
      const { partner, privateAccount } = await households();

      const response = await templates.as(partner).post('/v1/transaction-template').send({
        accountKey: privateAccount.accountKey,
        direction: 'out',
        name: 'Not mine',
      });

      expect(response.status).toBe(404);
      expect(await listed(partner)).toEqual([]);
    });

    it('refuses to move a template onto an account the member cannot see', async () => {
      const { partner, privateAccount } = await households();
      const created = await createTemplate(partner, { direction: 'out', name: 'Mine' });

      const response = await templates.as(partner).patch(`/v1/transaction-template/${created.transactionTemplateKey}`).send({
        accountKey: privateAccount.accountKey,
      });

      expect(response.status).toBe(404);
      expect((await listed(partner))[0]?.account).toBeNull();
    });

    it('accepts the owner\'s own private account and the household\'s shared one', async () => {
      const { owner, partner, privateAccount } = await households();

      const ownPrivate = await createTemplate(owner.appuser, { accountKey: privateAccount.accountKey, direction: 'out', name: 'Private' });
      const shared = await createTemplate(partner, { accountKey: owner.account.accountKey, direction: 'out', name: 'Shared' });

      expect(ownPrivate.account?.accountKey).toBe(privateAccount.accountKey);
      expect(shared.account?.accountKey).toBe(owner.account.accountKey);
    });

    it('refuses a category or merchant from another household', async () => {
      const { neighbour, owner } = await households();
      const theirCategory = await addCategory(db.em(), neighbour, 'Theirs');
      const theirMerchant = await addMerchant(db.em(), neighbour, 'Their shop');

      const category = await templates.as(owner.appuser).post('/v1/transaction-template').send({
        categoryKey: theirCategory.categoryKey,
        direction: 'out',
        name: 'Category',
      });
      const merchant = await templates.as(owner.appuser).post('/v1/transaction-template').send({
        direction: 'out',
        name: 'Merchant',
        transactionMerchantKey: theirMerchant.transactionMerchantKey,
      });

      expect(category.status).toBe(404);
      expect(merchant.status).toBe(404);
    });
  });

  describe('copying a transaction', () => {
    async function transactionFor(household: Household, em = db.em()) {
      return addTransaction(em, household, {
        amount: -30,
        category: await addCategory(em, household, 'Coffee'),
        date: new Date('2026-07-10T12:00:00Z'),
        merchant: await addMerchant(em, household, 'Cafe'),
        status: 'BOOKED',
      });
    }

    it('copies the account, amount, direction, description, merchant, category and notes', async () => {
      const { owner } = await households();
      const em = db.em();
      const transaction = await transactionFor(owner, em);
      transaction.notes = 'Flat white';
      await em.flush();

      const created = await createTemplate(owner.appuser, { fromTransactionId: transaction.transactionKey });

      expect(created).toMatchObject({
        account: { accountKey: owner.account.accountKey },
        amount: 30,
        category: { name: 'Coffee' },
        description: 'Cafe',
        direction: 'out',
        name: 'Cafe',
        notes: 'Flat white',
        transactionMerchant: { name: 'Cafe' },
      });
    });

    it('lets an explicit field win over the copied one', async () => {
      const { owner } = await households();
      const transaction = await transactionFor(owner);

      const created = await createTemplate(owner.appuser, {
        amount: 5,
        direction: 'in',
        fromTransactionId: transaction.transactionKey,
        name: 'My coffee',
      });

      expect(created).toMatchObject({ amount: 5, direction: 'in', name: 'My coffee' });
    });

    it('does not copy another household\'s transaction', async () => {
      const { neighbour, owner } = await households();
      const theirs = await transactionFor(neighbour);

      const response = await templates.as(owner.appuser).post('/v1/transaction-template').send({ fromTransactionId: theirs.transactionKey });

      expect(response.status).toBe(404);
    });

    it('does not copy the other member\'s private-account transaction', async () => {
      const { owner, partner, privateAccount } = await households();
      const secret = await addTransaction(db.em(), owner, {
        account: privateAccount,
        amount: -80,
        date: new Date('2026-07-11T12:00:00Z'),
        status: 'BOOKED',
      });

      const response = await templates.as(partner).post('/v1/transaction-template').send({ fromTransactionId: secret.transactionKey });

      expect(response.status).toBe(404);
    });
  });
});
