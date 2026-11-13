import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { Transaction } from '@entity/Transaction';
import { linkInstallmentsAfterImport } from '@service/account/account-statement-transaction';

import {
  createInstallmentPlan,
  deleteInstallmentPlan,
  describePlan,
  linkInstallment,
  linkPostedInstallments,
  listCommitments,
  unlinkInstallment,
  updateInstallmentPlan,
} from '../installment-plan.service';

const utc = (day: string) => new Date(`${day}T12:00:00.000Z`);

/*
 * An installment plan's future installments are projections: they are schedule rows, never
 * transactions. A posted bank row is linked to its schedule row, which then reads as paid; the
 * posted row stays the only record of the money.
 */
describe('installment plans', () => {
  const db = useTestDatabase();

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    // A card closing at month end and due on the 10th.
    em.create(CreditCardDetail, { accountKey: owner.account, paymentDueDay: 10, statementCloseDay: 31, tenantKey: owner.tenant }, { partial: true });
    await em.flush();
    return { em, owner };
  }

  async function plan(em: EntityManager, owner: Household, input: { account?: Account; count?: number; description?: string; purchase?: string; total?: number } = {}) {
    const created = await createInstallmentPlan(em, {
      accountKey: (input.account ?? owner.account).accountKey,
      description: input.description ?? 'Lojas X',
      installmentCount: input.count ?? 3,
      purchaseDate: new Date(`${input.purchase ?? '2026-01-10'}T00:00:00.000Z`),
      totalAmount: input.total ?? 100,
    }, { tenant: owner.tenant, tenantKey: owner.tenant.tenantKey, user: owner.appuser });
    return em.findOneOrFail(InstallmentPlan, { installmentPlanKey: created.installmentPlanKey }, { populate: ['accountKey', 'accountKey.currencyKey', 'categoryKey'] });
  }

  const charge = (em: EntityManager, owner: Household, description: string, amount: number, day: string, account?: Account, status: 'BOOKED' | 'EXPIRED' | 'PENDING' | null = 'BOOKED') =>
    addTransaction(em, owner, { account, amount, date: utc(day), status }).then(async (row) => {
      row.description = description;
      await em.flush();
      return row;
    });

  const accountRows = (em: EntityManager, account: Account) => em.count(Transaction, { accountKey: { accountKey: account.accountKey }, deletedAt: null });

  it('creates N schedule rows that sum exactly to the total, and no transaction', async () => {
    const { em, owner } = await household();

    const created = await plan(em, owner, { count: 3, total: 100 });
    const described = await describePlan(em, created, utc('2026-01-01'));

    expect(described.installments.map((row) => row.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(described.installments.map((row) => row.statementDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(described.remainingAmount).toBe(100);
    await expect(accountRows(em, owner.account)).resolves.toBe(0);
  });

  it('links a posted bank installment to its schedule row as paid, without a second row', async () => {
    const { em, owner } = await household();
    const created = await plan(em, owner);
    await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
    const second = await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2026-02-10');

    await expect(linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey })).resolves.toBe(2);
    const described = await describePlan(em, created, utc('2026-02-20'));

    expect(described.installments.map((row) => row.status)).toEqual(['paid', 'paid', 'upcoming']);
    expect(described.installments[1]).toMatchObject({ postedAmount: 33.33, postedDate: '2026-02-10', transactionKey: second.transactionKey });
    expect(described).toMatchObject({ paidCount: 2, remainingAmount: 33.34, remainingCount: 1 });
    // The bank's two rows are the only transactions: the plan added none and the link added none.
    await expect(accountRows(em, owner.account)).resolves.toBe(2);
    // Linking again finds nothing new.
    await expect(linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey })).resolves.toBe(0);
  });

  it('links the installments a bank already posted when the plan is created', async () => {
    const { em, owner } = await household();
    await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');

    const created = await plan(em, owner);
    const described = await describePlan(em, created, utc('2026-01-20'));

    expect(described.installments.map((row) => row.status)).toEqual(['paid', 'upcoming', 'upcoming']);
  });

  it('links a pending charge only once it posts, never one the bank dropped, and a row with no status as posted', async () => {
    const { em, owner } = await household();
    const created = await plan(em, owner);
    const pending = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10', undefined, 'PENDING');
    const dropped = await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2026-02-10', undefined, 'EXPIRED');
    // Hand-entered and older rows carry no status; they are posted.
    const unstated = await charge(em, owner, 'LOJAS X PARC 03/03', -33.34, '2026-03-10', undefined, null);
    const tenantKey = owner.tenant.tenantKey;

    await expect(linkPostedInstallments(em, { tenantKey })).resolves.toBe(1);
    expect((await describePlan(em, created, utc('2026-03-20'))).installments.map((row) => row.transactionKey)).toEqual([null, null, unstated.transactionKey]);

    // When the bank posts the charge, the sync promotes the pending row in place; its linking pass, over every unlinked charge, then picks it up.
    pending.transactionStatusKey = owner.statuses.BOOKED;
    await em.flush();
    await expect(linkPostedInstallments(em, { tenantKey })).resolves.toBe(1);

    const described = await describePlan(em, created, utc('2026-03-20'));
    expect(described.installments.map((row) => [row.status, row.transactionKey])).toEqual([['paid', pending.transactionKey], ['unmatched', null], ['paid', unstated.transactionKey]]);
    expect((await em.fork().findOneOrFail(Transaction, { transactionKey: dropped.transactionKey }, { filters: false })).installmentPlanKey).toBeNull();
  });

  it('leaves a row that does not fit the plan for the user to link', async () => {
    const { em, owner } = await household();
    const otherCard = await addAccount(em, owner, { name: 'Other card' });
    const created = await plan(em, owner);
    await charge(em, owner, 'LOJAS X PARC 02/03', -50, '2026-02-10'); // another amount
    await charge(em, owner, 'LOJAS X PARC 02/04', -33.33, '2026-02-10'); // another count
    await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2026-02-10', otherCard); // another card
    await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2027-06-10'); // long after the schedule

    await expect(linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey })).resolves.toBe(0);
    expect((await describePlan(em, created, utc('2026-01-01'))).paidCount).toBe(0);
  });

  it('lets the purchase name choose between two plans that both fit', async () => {
    const { em, owner } = await household();
    const shoes = await plan(em, owner, { description: 'Shoe shop' });
    const phone = await plan(em, owner, { description: 'Phone shop' });
    await charge(em, owner, 'PHONE SHOP PARC 02/03', -33.33, '2026-02-10');
    await charge(em, owner, 'SOMEWHERE PARC 03/03', -33.34, '2026-03-10');

    await expect(linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey })).resolves.toBe(1);
    expect((await describePlan(em, phone, utc('2026-01-01'))).paidCount).toBe(1);
    expect((await describePlan(em, shoes, utc('2026-01-01'))).paidCount).toBe(0);
  });

  it('keeps the links when a plan is rescheduled, and refuses fewer installments than are paid', async () => {
    const { em, owner } = await household();
    const created = await plan(em, owner);
    await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
    await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2026-02-10');
    await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
    const context = { tenant: owner.tenant, tenantKey: owner.tenant.tenantKey, user: owner.appuser };

    await updateInstallmentPlan(em, created, { totalAmount: 100.01 }, context);
    const described = await describePlan(em, created, utc('2026-02-20'));

    expect(described.installments.map((row) => row.amount)).toEqual([33.33, 33.33, 33.35]);
    expect(described.paidCount).toBe(2);
    await expect(updateInstallmentPlan(em, created, { installmentCount: 1 }, context)).rejects.toThrow(/already paid/);
  });

  it('sums the upcoming installments of every plan on a card as its remaining commitment', async () => {
    const { em, owner } = await household();
    const otherCard = await addAccount(em, owner, { name: 'Other card' });
    await plan(em, owner, { count: 3, purchase: '2026-01-10', total: 300 });
    await plan(em, owner, { count: 2, description: 'Sofa', purchase: '2026-02-15', total: 50 });
    await plan(em, owner, { account: otherCard, count: 4, total: 400 });
    await charge(em, owner, 'LOJAS X PARC 02/03', -100, '2026-02-10');
    await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });

    // On 1 February the first installment has passed unmatched, the second is paid, the third is to come.
    const commitments = await listCommitments(em, { tenantKey: owner.tenant.tenantKey, today: utc('2026-02-01') });
    const card = commitments.find((entry) => entry.accountKey === owner.account.accountKey);

    expect(card).toMatchObject({ activePlanCount: 2, currency: 'EUR', remainingAmount: 150, remainingCount: 3 });
    expect(card?.nextInstallment).toMatchObject({ amount: 25, date: '2026-02-15', description: 'Sofa', installmentNumber: 1 });
    expect(commitments.find((entry) => entry.accountKey === otherCard.accountKey)?.remainingAmount).toBe(300);
  });

  it('frees an installment again when its posted row is deleted', async () => {
    const { em, owner } = await household();
    const created = await plan(em, owner);
    const posted = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
    await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });

    posted.deletedAt = new Date();
    await em.flush();

    expect((await describePlan(em, created, utc('2026-01-01'))).installments[0]?.status).toBe('upcoming');
  });

  describe('a manual unlink', () => {
    /** The row as stored: which installment it pays, and the plan it was unlinked from by hand. */
    const stored = async (em: EntityManager, row: Transaction) => {
      const fresh = await em.fork().findOneOrFail(Transaction, { transactionKey: row.transactionKey }, { filters: false });
      return { installmentNumber: fresh.installmentNumber ?? null, planKey: fresh.installmentPlanKey?.installmentPlanKey ?? null, unlinkedFrom: fresh.installmentUnlinkedPlanKey?.installmentPlanKey ?? null };
    };

    /** Every way the automatic linker runs: after a sync (the whole household), an import or a hand entry (the card), and a reschedule. */
    async function everyAutomaticLink(em: EntityManager, owner: Household, created: InstallmentPlan) {
      await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
      await linkInstallmentsAfterImport(em, owner.account, [utc('2026-01-10')]);
      await linkPostedInstallments(em, { accountKeys: [owner.account.accountKey], tenantKey: owner.tenant.tenantKey });
      await updateInstallmentPlan(em, created, { totalAmount: 100 }, { tenant: owner.tenant, tenantKey: owner.tenant.tenantKey, user: owner.appuser });
      em.clear();
    }

    it('is not undone by the next sync, import, hand entry or reschedule', async () => {
      const { em, owner } = await household();
      const created = await plan(em, owner);
      const first = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
      await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
      expect(await stored(em, first)).toMatchObject({ installmentNumber: 1, planKey: created.installmentPlanKey });

      await unlinkInstallment(em, created, 1);
      await everyAutomaticLink(em, owner, created);

      expect(await stored(em, first)).toEqual({ installmentNumber: null, planKey: null, unlinkedFrom: created.installmentPlanKey });
      expect((await describePlan(em, created, utc('2026-01-20'))).installments[0]).toMatchObject({ status: 'unmatched', transactionKey: null });
    });

    it('still links the plan’s other rows, and the household’s other plans', async () => {
      const { em, owner } = await household();
      const created = await plan(em, owner);
      const sofa = await plan(em, owner, { count: 2, description: 'Sofa', total: 50 });
      const first = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
      await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
      await unlinkInstallment(em, created, 1);

      const second = await charge(em, owner, 'LOJAS X PARC 02/03', -33.33, '2026-02-10');
      const sofaRow = await charge(em, owner, 'SOFA PARC 1/2', -25, '2026-01-10');
      await expect(linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey })).resolves.toBe(2);

      expect(await stored(em, first)).toMatchObject({ planKey: null });
      expect(await stored(em, second)).toEqual({ installmentNumber: 2, planKey: created.installmentPlanKey, unlinkedFrom: null });
      expect(await stored(em, sofaRow)).toEqual({ installmentNumber: 1, planKey: sofa.installmentPlanKey, unlinkedFrom: null });
    });

    it('is taken back by linking the row to that plan by hand, and recorded again by the next unlink', async () => {
      const { em, owner } = await household();
      const created = await plan(em, owner);
      const first = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
      await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
      await unlinkInstallment(em, created, 1);

      await linkInstallment(em, created, 1, first.transactionKey);

      expect(await stored(em, first)).toEqual({ installmentNumber: 1, planKey: created.installmentPlanKey, unlinkedFrom: null });
      expect((await describePlan(em, created, utc('2026-01-20'))).installments[0]).toMatchObject({ status: 'paid', transactionKey: first.transactionKey });

      await unlinkInstallment(em, created, 1);
      await everyAutomaticLink(em, owner, created);
      expect(await stored(em, first)).toEqual({ installmentNumber: null, planKey: null, unlinkedFrom: created.installmentPlanKey });
    });

    it('is forgotten when the plan is deleted', async () => {
      const { em, owner } = await household();
      const created = await plan(em, owner);
      const first = await charge(em, owner, 'LOJAS X PARC 01/03', -33.33, '2026-01-10');
      await linkPostedInstallments(em, { tenantKey: owner.tenant.tenantKey });
      await unlinkInstallment(em, created, 1);

      await deleteInstallmentPlan(em, created);

      expect(await stored(em, first)).toEqual({ installmentNumber: null, planKey: null, unlinkedFrom: null });
    });
  });
});
