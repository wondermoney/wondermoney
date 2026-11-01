import { describe, expect, it } from 'vitest';

import { addAccount, addCategory, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';

import { setTenantContext } from '../filters/tenant-filter';

/*
 * A row that hangs off a transaction (its category, a loan repayment, a goal funding...) is read
 * through the transaction's tenant filter: MikroORM joins the transaction and applies the
 * household and privacy condition there. A member sees the rows of the household's transactions
 * on shared accounts and on their own private ones, never those on the other member's private
 * account, and nothing of another household.
 */
describe('tenant filter through a relation to a transaction', () => {
  const db = useTestDatabase();

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const groceries = await addCategory(em, owner, 'Groceries');
    await addTransaction(em, owner, { amount: -20, category: groceries, date: new Date(), status: 'BOOKED' });
    await addTransaction(em, owner, { account: privateAccount, amount: -80, category: groceries, date: new Date(), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    await addTransaction(em, neighbour, { amount: -500, category: await addCategory(em, neighbour, 'Rent'), date: new Date(), status: 'BOOKED' });
    return { neighbour, owner, partner };
  }

  const visibleCategorisations = (appuserKey: number, tenantKey: number) => {
    const em = db.em();
    setTenantContext(em, { appuserKey, tenantKey });
    return em.count(AppuserTransactionCategory, {});
  };

  it('shows the owner the categories of shared and of their own private transactions', async () => {
    const { owner } = await household();

    await expect(visibleCategorisations(owner.appuser.appuserKey, owner.tenant.tenantKey)).resolves.toBe(2);
  });

  it('hides the categories of the other member\'s private transactions from the partner', async () => {
    const { owner, partner } = await household();

    await expect(visibleCategorisations(partner.appuserKey, owner.tenant.tenantKey)).resolves.toBe(1);
  });

  it('shows another household only its own', async () => {
    const { neighbour } = await household();

    await expect(visibleCategorisations(neighbour.appuser.appuserKey, neighbour.tenant.tenantKey)).resolves.toBe(1);
  });
});
