import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import ruleRoutes from '@route/rule';

/*
 * Rules belong to a household: both members see and manage every rule, and no other household
 * sees or changes any. A rule may only name things its owner can see: the household's own
 * categories, merchants and tags, and accounts that are shared or the owner's own. Editing a
 * rule's conditions or actions makes the editor its owner, so a member cannot use the other's
 * rule to reach their private account.
 */
describe('rules', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const rules = tenantHttp('/v1/rule', ruleRoutes);

  interface RuleDto { actions: unknown[]; active: boolean; conditions: unknown[]; match: string; name: string; ownerAppuserKey: null | number; position: number; ruleKey: number; stopProcessing: boolean }

  const netflix = { field: 'merchant', operator: 'contains', value: 'netflix' };
  const hide = { type: 'hide' };

  async function create(user: Appuser, body: Record<string, unknown> = {}): Promise<RuleDto> {
    const response = await rules.as(user).post('/v1/rule').send({ actions: [hide], conditions: [netflix], name: 'Netflix', ...body });
    expect(response.status).toBe(201);
    return response.body.rule as RuleDto;
  }

  const list = async (user: Appuser) => ((await rules.as(user).get('/v1/rule')).body.rules as RuleDto[]);

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, partner, privateAccount };
  }

  async function addTag(household: Awaited<ReturnType<typeof seedHousehold>>, name: string): Promise<Tag> {
    const em = db.em();
    const tag = em.create(Tag, { color: '#94a3b8', name, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return tag;
  }

  describe('managing rules', () => {
    it('lists a rule to both members and not to another household', async () => {
      const { neighbour, owner, partner } = await households();
      const created = await create(owner.appuser, { match: 'any', stopProcessing: true });

      expect(await list(partner)).toEqual([expect.objectContaining({ match: 'any', name: 'Netflix', ownerAppuserKey: owner.appuser.appuserKey, ruleKey: created.ruleKey, stopProcessing: true })]);
      expect(await list(neighbour.appuser)).toEqual([]);
    });

    it('applies the defaults and appends each new rule to the end of the run order', async () => {
      const { owner, partner } = await households();
      const first = await create(owner.appuser);
      const second = await create(partner, { name: 'Second' });

      expect(first).toMatchObject({ active: true, match: 'all', stopProcessing: false });
      expect((await list(owner.appuser)).map((rule) => rule.ruleKey)).toEqual([first.ruleKey, second.ruleKey]);
      expect(second.position).toBeGreaterThan(first.position);
    });

    it('lets the other member rename and switch off a rule without taking it over', async () => {
      const { owner, partner } = await households();
      const rule = await create(owner.appuser);

      const response = await rules.as(partner).patch(`/v1/rule/${rule.ruleKey}`).send({ active: false, name: 'Streaming' });

      expect(response.status).toBe(200);
      expect(response.body.rule).toMatchObject({ active: false, name: 'Streaming', ownerAppuserKey: owner.appuser.appuserKey });
    });

    it('makes the member who changes the conditions or actions the rule\'s owner', async () => {
      const { owner, partner } = await households();
      const rule = await create(owner.appuser);

      const response = await rules.as(partner).patch(`/v1/rule/${rule.ruleKey}`).send({ actions: [{ type: 'mark_reviewed' }] });

      expect(response.status).toBe(200);
      expect(response.body.rule).toMatchObject({ actions: [{ type: 'mark_reviewed' }], ownerAppuserKey: partner.appuserKey });
    });

    it('deletes a rule for the whole household', async () => {
      const { owner, partner } = await households();
      const rule = await create(owner.appuser);

      const response = await rules.as(partner).delete(`/v1/rule/${rule.ruleKey}`);

      expect(response.status).toBe(200);
      expect(await list(owner.appuser)).toEqual([]);
      expect(await db.em().findOne(Rule, { ruleKey: rule.ruleKey }, { filters: false })).toMatchObject({ deletedAt: expect.any(Date) });
    });

    it('does not let another household see, change or delete a rule', async () => {
      const { neighbour, owner } = await households();
      const rule = await create(owner.appuser);

      const patch = await rules.as(neighbour.appuser).patch(`/v1/rule/${rule.ruleKey}`).send({ active: false, name: 'Mine now' });
      const remove = await rules.as(neighbour.appuser).delete(`/v1/rule/${rule.ruleKey}`);

      expect(patch.status).toBe(404);
      expect(remove.status).toBe(404);
      expect(await db.em().findOneOrFail(Rule, { ruleKey: rule.ruleKey }, { filters: false })).toMatchObject({ active: true, deletedAt: null, name: 'Netflix' });
    });
  });

  describe('run order', () => {
    it('reorders the household\'s rules from the full list', async () => {
      const { owner, partner } = await households();
      const a = await create(owner.appuser, { name: 'A' });
      const b = await create(owner.appuser, { name: 'B' });
      const c = await create(owner.appuser, { name: 'C' });

      const response = await rules.as(partner).put('/v1/rule/order').send({ ruleIds: [c.ruleKey, a.ruleKey, b.ruleKey] });

      expect(response.status).toBe(200);
      expect((response.body.rules as RuleDto[]).map((rule) => rule.name)).toEqual(['C', 'A', 'B']);
      expect((await list(owner.appuser)).map((rule) => rule.name)).toEqual(['C', 'A', 'B']);
    });

    it('refuses a list that leaves out a rule or names one that is gone', async () => {
      const { owner } = await households();
      const a = await create(owner.appuser, { name: 'A' });
      const b = await create(owner.appuser, { name: 'B' });
      await rules.as(owner.appuser).delete(`/v1/rule/${b.ruleKey}`);
      const c = await create(owner.appuser, { name: 'C' });

      const missing = await rules.as(owner.appuser).put('/v1/rule/order').send({ ruleIds: [c.ruleKey] });
      const deleted = await rules.as(owner.appuser).put('/v1/rule/order').send({ ruleIds: [c.ruleKey, b.ruleKey, a.ruleKey] });
      const fine = await rules.as(owner.appuser).put('/v1/rule/order').send({ ruleIds: [c.ruleKey, a.ruleKey] });

      expect(missing.status).toBe(409);
      expect(deleted.status).toBe(409);
      expect(fine.status).toBe(200);
    });

    it('does not let another household reorder or slip its rules into the list', async () => {
      const { neighbour, owner } = await households();
      const a = await create(owner.appuser, { name: 'A' });
      const b = await create(owner.appuser, { name: 'B' });
      const theirs = await create(neighbour.appuser, { name: 'Theirs' });

      const foreign = await rules.as(neighbour.appuser).put('/v1/rule/order').send({ ruleIds: [b.ruleKey, a.ruleKey] });
      const mixed = await rules.as(owner.appuser).put('/v1/rule/order').send({ ruleIds: [b.ruleKey, a.ruleKey, theirs.ruleKey] });

      expect(foreign.status).toBe(409);
      expect(mixed.status).toBe(409);
      expect((await list(owner.appuser)).map((rule) => rule.name)).toEqual(['A', 'B']);
      expect((await list(neighbour.appuser)).map((rule) => rule.name)).toEqual(['Theirs']);
    });

    it('refuses a rule listed twice', async () => {
      const { owner } = await households();
      const a = await create(owner.appuser);

      const response = await rules.as(owner.appuser).put('/v1/rule/order').send({ ruleIds: [a.ruleKey, a.ruleKey] });

      expect(response.status).toBe(400);
    });
  });

  describe('what a rule may name', () => {
    it('accepts the household\'s own category, merchant, tag and accounts', async () => {
      const { owner, privateAccount } = await households();
      const category = await addCategory(db.em(), owner, 'Streaming');
      const merchant = await addMerchant(db.em(), owner, 'Netflix');
      const tag = await addTag(owner, 'Subscriptions');

      const response = await rules.as(owner.appuser).post('/v1/rule').send({
        actions: [{ categoryId: category.categoryKey, type: 'set_category' }, { merchantId: merchant.transactionMerchantKey, type: 'set_merchant' }, { tagIds: [tag.tagKey], type: 'add_tags' }],
        conditions: [{ field: 'account', operator: 'in', values: [owner.account.accountKey, privateAccount.accountKey] }, { field: 'category', operator: 'in', values: ['uncategorized', category.categoryKey] }],
        name: 'Everything',
      });

      expect(response.status).toBe(201);
    });

    it.each([
      ['category action', (n: Refs) => ({ actions: [hide, { categoryId: n.category, type: 'set_category' }] }), 'actions[1]'],
      ['merchant action', (n: Refs) => ({ actions: [{ merchantId: n.merchant, type: 'set_merchant' }] }), 'actions[0]'],
      ['tag action', (n: Refs) => ({ actions: [{ tagIds: [n.tag], type: 'add_tags' }] }), 'actions[0]'],
      ['account condition', (n: Refs) => ({ conditions: [netflix, { field: 'account', operator: 'not_in', values: [n.account] }] }), 'conditions[1]'],
      ['category condition', (n: Refs) => ({ conditions: [{ field: 'category', operator: 'in', values: [n.category] }] }), 'conditions[0]'],
    ])('refuses another household\'s %s and names it', async (_label, body, path) => {
      const { neighbour, owner } = await households();
      const refs: Refs = {
        account: neighbour.account.accountKey,
        category: (await addCategory(db.em(), neighbour, 'Theirs')).categoryKey,
        merchant: (await addMerchant(db.em(), neighbour, 'Theirs')).transactionMerchantKey,
        tag: (await addTag(neighbour, 'Theirs')).tagKey,
      };

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [hide], conditions: [netflix], name: 'Sneaky', ...body(refs) });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(path);
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });

    it('does not let the partner name the owner\'s private account', async () => {
      const { partner, privateAccount } = await households();

      const response = await rules.as(partner).post('/v1/rule').send({ actions: [hide], conditions: [{ field: 'account', operator: 'in', values: [privateAccount.accountKey] }], name: 'Peek' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('conditions[0]');
    });

    it('does not let the partner take over a rule that names the owner\'s private account', async () => {
      const { owner, partner, privateAccount } = await households();
      const rule = await create(owner.appuser, { conditions: [{ field: 'account', operator: 'in', values: [privateAccount.accountKey] }] });

      const response = await rules.as(partner).patch(`/v1/rule/${rule.ruleKey}`).send({ actions: [{ type: 'set_notes', value: 'seen' }] });

      expect(response.status).toBe(400);
      expect(await db.em().findOneOrFail(Rule, { ruleKey: rule.ruleKey }, { filters: false })).toMatchObject({ actions: [hide] });
    });

    it('refuses a deleted tag', async () => {
      const { owner } = await households();
      const tag = await addTag(owner, 'Old');
      tag.deletedAt = new Date();
      await db.em().upsert(tag);

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [{ tagIds: [tag.tagKey], type: 'add_tags' }], conditions: [netflix], name: 'Old tag' });

      expect(response.status).toBe(400);
    });
  });

  describe('previewing a draft', () => {
    const draft = { actions: [hide], conditions: [{ field: 'description', operator: 'contains', value: 'netflix' }], match: 'all' };

    async function netflixRows() {
      const { neighbour, owner, partner, privateAccount } = await households();
      const netflixMerchant = await addMerchant(db.em(), owner, 'Netflix');
      const at = new Date('2026-07-10T12:00:00Z');
      const shared = await addTransaction(db.em(), owner, { amount: -12.99, date: at, merchant: netflixMerchant, status: 'BOOKED' });
      const ownersPrivate = await addTransaction(db.em(), owner, { account: privateAccount, amount: -12.99, date: at, merchant: netflixMerchant, status: 'BOOKED' });
      await addTransaction(db.em(), neighbour, { amount: -12.99, date: at, merchant: await addMerchant(db.em(), neighbour, 'Netflix'), status: 'BOOKED' });
      return { neighbour, owner, ownersPrivate, partner, shared };
    }

    const keys = (body: { transactions: { transactionKey: number }[] }) => body.transactions.map((row) => row.transactionKey).sort();

    it('shows the partner the household\'s rows but not the owner\'s private-account rows', async () => {
      const { owner, ownersPrivate, partner, shared } = await netflixRows();

      const asPartner = await rules.as(partner).post('/v1/rule/preview').send(draft);
      const asOwner = await rules.as(owner.appuser).post('/v1/rule/preview').send(draft);

      expect(asPartner.status).toBe(200);
      expect(asPartner.body).toMatchObject({ changeCount: 1, matchCount: 1 });
      expect(keys(asPartner.body)).toEqual([shared.transactionKey]);
      expect(asOwner.body).toMatchObject({ changeCount: 2, matchCount: 2 });
      expect(keys(asOwner.body)).toEqual([shared.transactionKey, ownersPrivate.transactionKey].sort());
    });

    it('shows another household nothing of ours', async () => {
      const { neighbour, shared } = await netflixRows();

      const response = await rules.as(neighbour.appuser).post('/v1/rule/preview').send(draft);

      expect(response.status).toBe(200);
      expect(response.body.matchCount).toBe(1);
      expect(keys(response.body)).not.toContain(shared.transactionKey);
    });

    it('refuses a draft naming what the previewer cannot see, as saving would', async () => {
      const { partner, privateAccount } = await households();

      const response = await rules.as(partner).post('/v1/rule/preview').send({ ...draft, conditions: [{ field: 'account', operator: 'in', values: [privateAccount.accountKey] }] });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('conditions[0]');
    });

    it('validates the draft like a rule and caps the sample', async () => {
      const { owner } = await households();

      expect((await rules.as(owner.appuser).post('/v1/rule/preview').send({ ...draft, conditions: [] })).status).toBe(400);
      expect((await rules.as(owner.appuser).post('/v1/rule/preview').send({ ...draft, limit: 1000 })).status).toBe(400);
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });
  });

  describe('validation', () => {
    it('names the failing condition', async () => {
      const { owner } = await households();

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [hide], conditions: [netflix, { field: 'amount', max: 5, min: 10, operator: 'between' }], name: 'Bad' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('conditions[1]');
    });

    it('names the failing action', async () => {
      const { owner } = await households();

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [hide, { type: 'set_description', value: '  ' }], conditions: [netflix], name: 'Bad' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('actions[1]');
    });

    it.each(['TRANSFER_IN', 'TRANSFER_OUT'])('cannot set the transaction type to %s', async (type) => {
      const { owner } = await households();

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [{ type: 'set_transaction_type', value: type }], conditions: [netflix], name: 'Transfer' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('actions[0]');
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });

    it.each([
      ['a negative amount', { field: 'amount', operator: 'lt', value: -20 }],
      ['an amount with more than four decimals', { field: 'amount', operator: 'eq', value: 1.00001 }],
      ['a regular expression operator', { field: 'description', operator: 'matches', value: '.*' }],
      ['an unknown field', { field: 'balance', operator: 'gt', value: 1 }],
    ])('refuses %s', async (_label, condition) => {
      const { owner } = await households();

      const response = await rules.as(owner.appuser).post('/v1/rule').send({ actions: [hide], conditions: [condition], name: 'Bad' });

      expect(response.status).toBe(400);
    });

    it('refuses a rule without conditions or actions, or with the same action twice', async () => {
      const { owner } = await households();
      const post = (body: Record<string, unknown>) => rules.as(owner.appuser).post('/v1/rule').send({ actions: [hide], conditions: [netflix], name: 'Bad', ...body });

      expect((await post({ conditions: [] })).status).toBe(400);
      expect((await post({ actions: [] })).status).toBe(400);
      expect((await post({ actions: [hide, hide] })).status).toBe(400);
    });
  });
});

interface Refs { account: number; category: number; merchant: number; tag: number }
