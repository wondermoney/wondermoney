import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import accountRoutes from '@route/account';
import installmentPlanRoutes from '@route/installment-plan';
import netWorthRoutes from '@route/net-worth';
import recurringRoutes from '@route/recurring';

const DAY_MS = 86_400_000;
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysFromToday = (days: number) => new Date(today().getTime() + days * DAY_MS);

/*
 * Installment plans over HTTP. A plan follows its card: a household member reads and changes plans
 * on a shared card, but the other member's private card's plans, like another household's, do not
 * exist for them. Future installments are projections: creating a plan changes no balance, no net
 * worth and no transaction list.
 */
describe('installment plans over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const plans = tenantHttp('/v1/installment-plans', installmentPlanRoutes);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  const netWorth = tenantHttp('/v1/net-worth', netWorthRoutes);
  const recurring = tenantHttp('/v1/recurring', recurringRoutes);

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateCard = await addAccount(em, owner, { balance: -200, isPrivate: true, name: 'Owner private card' });
    for (const card of [owner.account, privateCard]) {
      em.create(CreditCardDetail, { accountKey: card, paymentDueDay: 10, statementCloseDay: 31, tenantKey: owner.tenant }, { partial: true });
    }
    await em.flush();
    const neighbour = await seedHousehold(em);
    return { em, neighbour, owner, partner, privateCard };
  }

  const create = (user: Appuser, account: Account, body: Record<string, unknown> = {}) =>
    plans.as(user).post('/v1/installment-plans').send({
      accountKey: account.accountKey,
      description: 'Laptop store',
      installmentCount: 3,
      purchaseDate: isoDay(daysFromToday(-1)),
      totalAmount: 100,
      ...body,
    });

  async function charge(em: EntityManager, owner: Household, account: Account, description: string, amount: number, date: Date, status: 'BOOKED' | 'EXPIRED' | 'PENDING' | null = 'BOOKED') {
    const row = await addTransaction(em, owner, { account, amount, date, status });
    row.description = description;
    await em.flush();
    return row;
  }

  it('creates a plan whose installments sum to the total and lists it', async () => {
    const { owner } = await household();

    const created = await create(owner.appuser, owner.account);
    const listed = await plans.as(owner.appuser).get(`/v1/installment-plans?accountId=${owner.account.accountKey}`);

    expect(created.status).toBe(201);
    expect(created.body.installmentPlan.installments.map((row: { amount: number }) => row.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(listed.status).toBe(200);
    expect(listed.body.installmentPlans).toHaveLength(1);
    expect(listed.body.installmentPlans[0]).toMatchObject({ currency: 'EUR', installmentCount: 3, totalAmount: 100 });
  });

  it('changes no balance, net worth or transaction list for installments still to come', async () => {
    const { owner } = await household();
    const read = async () => {
      const [account, worth, history, list] = await Promise.all([
        accounts.as(owner.appuser).get(`/v1/account/${owner.account.accountKey}`),
        netWorth.as(owner.appuser).get('/v1/net-worth'),
        netWorth.as(owner.appuser).get('/v1/net-worth/history'),
        accounts.as(owner.appuser).get(`/v1/account/${owner.account.accountKey}/transaction`),
      ]);
      expect([account.status, worth.status, history.status, list.status]).toEqual([200, 200, 200, 200]);
      return { balance: account.body.account.balance, history: history.body, list: { total: list.body.total, totalAmount: list.body.totalAmount }, worth: worth.body };
    };

    const before = await read();
    expect((await create(owner.appuser, owner.account, { installmentCount: 12, purchaseDate: isoDay(daysFromToday(1)), totalAmount: 1200 })).status).toBe(201);
    const after = await read();

    expect(after).toEqual(before);
  });

  it('shows a posted installment as n/N in the transaction list, once', async () => {
    const { em, owner } = await household();
    const created = await create(owner.appuser, owner.account, { purchaseDate: isoDay(daysFromToday(-40)) });
    const planKey = created.body.installmentPlan.installmentPlanKey;
    const posted = await charge(em, owner, owner.account, 'LAPTOP STORE PARC 2/3', -33.33, daysFromToday(-9));

    const linked = await plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/2/link`).send({ transactionKey: posted.transactionKey });
    const list = await accounts.as(owner.appuser).get(`/v1/account/${owner.account.accountKey}/transaction`);

    expect(linked.status).toBe(200);
    expect(linked.body.installmentPlan.installments[1]).toMatchObject({ status: 'paid', transactionKey: posted.transactionKey });
    expect(list.body.transactions).toHaveLength(1);
    expect(list.body.transactions[0].installment).toEqual({ installmentCount: 3, installmentNumber: 2, installmentPlanKey: planKey });
  });

  it('refuses to link a row twice, or a row from another card', async () => {
    const { em, owner } = await household();
    const other = await addAccount(em, owner, { name: 'Current account' });
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    const posted = await charge(em, owner, owner.account, 'LAPTOP STORE', -33.33, daysFromToday(0));
    const elsewhere = await charge(em, owner, other, 'LAPTOP STORE', -33.33, daysFromToday(0));
    const link = (number: number, transactionKey: number) => plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/${number}/link`).send({ transactionKey });

    expect((await link(1, posted.transactionKey)).status).toBe(200);
    expect((await link(2, posted.transactionKey)).status).toBe(409);
    expect((await link(1, elsewhere.transactionKey)).status).toBe(400);
  });

  it('names each link conflict: the row already pays an installment, or the installment is already paid', async () => {
    const { em, owner } = await household();
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    const first = await charge(em, owner, owner.account, 'LAPTOP STORE 1/3', -33.33, daysFromToday(0));
    const second = await charge(em, owner, owner.account, 'LAPTOP STORE 2/3', -33.33, daysFromToday(0));
    const link = (number: number, transactionKey: number) => plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/${number}/link`).send({ transactionKey });
    expect((await link(1, first.transactionKey)).status).toBe(200);

    const rowTaken = await link(2, first.transactionKey);
    const installmentTaken = await link(1, second.transactionKey);
    // Linking the same row to the same installment again changes nothing.
    const again = await link(1, first.transactionKey);

    expect([rowTaken.status, rowTaken.body.code]).toEqual([409, 'transaction_already_linked']);
    expect([installmentTaken.status, installmentTaken.body.code]).toEqual([409, 'installment_already_paid']);
    expect(again.status).toBe(200);
    expect(again.body.installmentPlan.installments.map((row: { transactionKey: null | number }) => row.transactionKey)).toEqual([first.transactionKey, null, null]);
  });

  it('refuses a pending charge, and one the bank dropped, but links a posted one', async () => {
    const { em, owner } = await household();
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    const pending = await charge(em, owner, owner.account, 'LAPTOP STORE 1/3', -33.33, daysFromToday(0), 'PENDING');
    const dropped = await charge(em, owner, owner.account, 'LAPTOP STORE 1/3', -33.33, daysFromToday(0), 'EXPIRED');
    const booked = await charge(em, owner, owner.account, 'LAPTOP STORE 1/3', -33.33, daysFromToday(0), 'BOOKED');
    // Manual and older rows carry no status; they are posted.
    const unstated = await charge(em, owner, owner.account, 'LAPTOP STORE 2/3', -33.33, daysFromToday(0), null);
    const link = (number: number, transactionKey: number) => plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/${number}/link`).send({ transactionKey });

    const refusedPending = await link(1, pending.transactionKey);
    const refusedDropped = await link(1, dropped.transactionKey);
    expect([refusedPending.status, refusedPending.body.code]).toEqual([400, 'transaction_pending']);
    expect([refusedDropped.status, refusedDropped.body.code]).toEqual([400, 'transaction_expired']);
    expect((await plans.as(owner.appuser).get(`/v1/installment-plans/${planKey}`)).body.installmentPlan.paidCount).toBe(0);

    const linked = await link(1, booked.transactionKey);
    const linkedUnstated = await link(2, unstated.transactionKey);
    expect(linked.status).toBe(200);
    expect(linkedUnstated.status).toBe(200);
    expect(linkedUnstated.body.installmentPlan.installments.slice(0, 2)).toEqual([
      expect.objectContaining({ status: 'paid', transactionKey: booked.transactionKey }),
      expect.objectContaining({ status: 'paid', transactionKey: unstated.transactionKey }),
    ]);
  });

  it('links a posted row whose amount differs from the installment’s', async () => {
    const { em, owner } = await household();
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    // Banks round installments differently, and the last one absorbs the rounding: the amount is not checked.
    const posted = await charge(em, owner, owner.account, 'LAPTOP STORE 3/3', -40, daysFromToday(0));

    const linked = await plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/3/link`).send({ transactionKey: posted.transactionKey });

    expect(linked.status).toBe(200);
    expect(linked.body.installmentPlan.installments[2]).toMatchObject({ amount: 33.34, postedAmount: 40, status: 'paid' });
  });

  it('suggests a plan from posted installments and accepts it only when asked', async () => {
    const { em, owner } = await household();
    const first = await charge(em, owner, owner.account, 'PHONE SHOP PARC 01/04', -50, daysFromToday(-31));
    const second = await charge(em, owner, owner.account, 'PHONE SHOP PARC 02/04', -50, daysFromToday(-1));

    const suggested = await plans.as(owner.appuser).get('/v1/installment-plans/suggestions');
    expect(suggested.status).toBe(200);
    expect(suggested.body.suggestions).toHaveLength(1);
    const [suggestion] = suggested.body.suggestions;
    expect(suggestion).toMatchObject({ accountKey: owner.account.accountKey, description: 'PHONE SHOP', installmentCount: 4, totalAmount: 200 });
    // Nothing was created by suggesting it.
    expect((await plans.as(owner.appuser).get('/v1/installment-plans')).body.installmentPlans).toEqual([]);

    const accepted = await plans.as(owner.appuser).post('/v1/installment-plans').send({
      accountKey: suggestion.accountKey,
      description: suggestion.description,
      installmentCount: suggestion.installmentCount,
      links: suggestion.transactions.map((row: { installmentNumber: number; transactionKey: number }) => ({ installmentNumber: row.installmentNumber, transactionKey: row.transactionKey })),
      purchaseDate: suggestion.purchaseDate,
      totalAmount: suggestion.totalAmount,
    });

    expect(accepted.status).toBe(201);
    expect(accepted.body.installmentPlan.installments.slice(0, 2).map((row: { transactionKey: number }) => row.transactionKey)).toEqual([first.transactionKey, second.transactionKey]);
    expect(accepted.body.installmentPlan).toMatchObject({ paidCount: 2, remainingCount: 2 });
    expect((await plans.as(owner.appuser).get('/v1/installment-plans/suggestions')).body.suggestions).toEqual([]);
  });

  it('reports each card’s remaining commitment', async () => {
    const { owner } = await household();
    await create(owner.appuser, owner.account, { purchaseDate: isoDay(daysFromToday(1)), totalAmount: 300 });

    const response = await plans.as(owner.appuser).get(`/v1/installment-plans/commitments?accountId=${owner.account.accountKey}`);

    expect(response.status).toBe(200);
    expect(response.body.commitments).toEqual([expect.objectContaining({ accountKey: owner.account.accountKey, activePlanCount: 1, remainingAmount: 300, remainingCount: 3 })]);
  });

  it('puts upcoming installments in the forecast and the bills calendar, as projections', async () => {
    const { owner } = await household();
    await create(owner.appuser, owner.account, { purchaseDate: isoDay(daysFromToday(2)), totalAmount: 90 });

    const forecast = await accounts.as(owner.appuser).get(`/v1/account/forecast?days=30&accountKeys=${owner.account.accountKey}`);
    const calendar = await recurring.as(owner.appuser).get(`/v1/recurring/occurrences?from=${isoDay(today())}&to=${isoDay(daysFromToday(30))}`);

    expect(forecast.status).toBe(200);
    const series = forecast.body.accounts.find((entry: { accountKey: number }) => entry.accountKey === owner.account.accountKey);
    expect(series.projectedInstallments).toEqual([expect.objectContaining({ amount: 30, date: isoDay(daysFromToday(2)), installmentNumber: 1 })]);
    expect(series.points.at(-1).balance).toBe(series.openingBalance - 30);
    expect(calendar.status).toBe(200);
    expect(calendar.body.installments).toEqual([expect.objectContaining({ date: isoDay(daysFromToday(2)), installmentCount: 3, installmentNumber: 1, status: 'projected' })]);
  });

  it('lets the partner work with a shared card’s plans', async () => {
    const { owner, partner } = await household();
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;

    expect((await plans.as(partner).get(`/v1/installment-plans/${planKey}`)).status).toBe(200);
    expect((await plans.as(partner).patch(`/v1/installment-plans/${planKey}`).send({ description: 'New laptop' })).body.installmentPlan.description).toBe('New laptop');
    expect((await create(partner, owner.account)).status).toBe(201);
  });

  it('hides the other member’s private card’s plans, and another household’s, everywhere', async () => {
    const { em, neighbour, owner, partner, privateCard } = await household();
    const privatePlan = (await create(owner.appuser, privateCard)).body.installmentPlan.installmentPlanKey;
    const sharedPlan = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    const privateRow = await charge(em, owner, privateCard, 'SHOP PARC 1/2', -10, daysFromToday(-1));
    await charge(em, owner, privateCard, 'SHOP PARC 2/2', -10, daysFromToday(0));

    // The owner sees their own private card's plan.
    expect((await plans.as(owner.appuser).get(`/v1/installment-plans/${privatePlan}`)).status).toBe(200);

    const hidden = await Promise.all([
      plans.as(partner).get(`/v1/installment-plans/${privatePlan}`),
      plans.as(partner).patch(`/v1/installment-plans/${privatePlan}`).send({ description: 'x' }),
      plans.as(partner).delete(`/v1/installment-plans/${privatePlan}`),
      plans.as(partner).post(`/v1/installment-plans/${privatePlan}/installments/1/link`).send({ transactionKey: privateRow.transactionKey }),
      create(partner, privateCard),
      plans.as(neighbour.appuser).get(`/v1/installment-plans/${sharedPlan}`),
      plans.as(neighbour.appuser).delete(`/v1/installment-plans/${sharedPlan}`),
      create(neighbour.appuser, owner.account),
    ]);
    expect(hidden.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);

    const [list, commitments, suggestions, neighbourList] = await Promise.all([
      plans.as(partner).get('/v1/installment-plans'),
      plans.as(partner).get('/v1/installment-plans/commitments'),
      plans.as(partner).get('/v1/installment-plans/suggestions'),
      plans.as(neighbour.appuser).get('/v1/installment-plans'),
    ]);
    expect(list.body.installmentPlans.map((plan: { installmentPlanKey: number }) => plan.installmentPlanKey)).toEqual([sharedPlan]);
    expect(commitments.body.commitments.map((entry: { accountKey: number }) => entry.accountKey)).toEqual([owner.account.accountKey]);
    expect(suggestions.body.suggestions).toEqual([]);
    expect(neighbourList.body.installmentPlans).toEqual([]);
    // The owner still has the private plan and its suggestion.
    expect((await plans.as(owner.appuser).get('/v1/installment-plans/suggestions')).body.suggestions).toHaveLength(1);

    // A row the caller cannot see is not found, whatever its status: its existence and state stay hidden.
    const partnerPlan = (await create(partner, owner.account)).body.installmentPlan.installmentPlanKey;
    const privatePending = await charge(em, owner, privateCard, 'SHOP', -10, daysFromToday(0), 'PENDING');
    const neighbourRow = await charge(em, neighbour, neighbour.account, 'SHOP', -10, daysFromToday(0));
    const unseen = await Promise.all([
      plans.as(partner).post(`/v1/installment-plans/${partnerPlan}/installments/1/link`).send({ transactionKey: privateRow.transactionKey }),
      plans.as(partner).post(`/v1/installment-plans/${partnerPlan}/installments/1/link`).send({ transactionKey: privatePending.transactionKey }),
      plans.as(owner.appuser).post(`/v1/installment-plans/${sharedPlan}/installments/1/link`).send({ transactionKey: neighbourRow.transactionKey }),
    ]);
    expect(unseen.map((response): [number, unknown] => [response.status, response.body.code])).toEqual([[404, 'not_found'], [404, 'not_found'], [404, 'not_found']]);
  });

  it('deletes a plan and keeps its posted transactions, unlinked', async () => {
    const { em, owner } = await household();
    const planKey = (await create(owner.appuser, owner.account)).body.installmentPlan.installmentPlanKey;
    const posted = await charge(em, owner, owner.account, 'LAPTOP STORE', -33.33, daysFromToday(0));
    await plans.as(owner.appuser).post(`/v1/installment-plans/${planKey}/installments/1/link`).send({ transactionKey: posted.transactionKey });

    expect((await plans.as(owner.appuser).delete(`/v1/installment-plans/${planKey}`)).status).toBe(204);

    expect((await plans.as(owner.appuser).get(`/v1/installment-plans/${planKey}`)).status).toBe(404);
    const list = await accounts.as(owner.appuser).get(`/v1/account/${owner.account.accountKey}/transaction`);
    expect(list.body.transactions.map((row: { installment: unknown; transactionKey: number }) => [row.transactionKey, row.installment])).toEqual([[posted.transactionKey, null]]);
  });
});
