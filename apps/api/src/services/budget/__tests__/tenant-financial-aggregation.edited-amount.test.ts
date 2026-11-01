import { describe, expect, it } from 'vitest';

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { Transaction } from '@entity/Transaction';

import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';
import { TenantFinancialAggregationService } from '../tenant-financial-aggregation.service';

/*
 * The financial emails (monthly insights, weekly insights, budget thresholds, monthly story) sum
 * spending in the user's currency. An amount edit stores the account-currency value in
 * `editedSettlementAmount` and the converted value in `appuserSettlementAmount`, so an
 * edited transaction on a foreign-currency account counts at its converted amount.
 */
describe('financial email aggregation of an edited foreign-currency transaction', () => {
  const db = useTestDatabase();

  it('counts the edit in the user currency, not the account currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const gbp = em.create(Currency, { code: 'GBP', num: '826' }, { partial: true });
    const gbpAccount = em.create(Account, { accountName: 'UK account', accountOwnerAppuserKey: household.appuser, balance: 0, closed: false, currencyKey: gbp, isPrivate: false, tenantKey: household.tenant }, { partial: true });
    const food = em.create(Category, { appuserKey: household.appuser, name: 'Food', tenantKey: household.tenant }, { partial: true });
    const groceries = em.create(Category, { appuserKey: household.appuser, name: 'Groceries', parentCategory: food, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    // A £100 charge edited down to £80, which is €92 at the edit's rate (1.15).
    const charge = await addTransaction(em, household, { account: gbpAccount, amount: -115, category: groceries, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    await em.nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { appuserSettlementAmount: -92, editedSettlementAmount: -80, settlementAmount: -80, settlementCurrencyKey: gbp });

    const service = new TenantFinancialAggregationService(new MikroOrmTenantAggregationRepository(db.em()));
    const result = await service.aggregateMonthlyInsights({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-07-20T09:00:00Z', tenantKey: household.tenant.tenantKey });

    expect(result).toMatchObject({ facts: { monthTotal: '92', topCategory: { amount: '92' } }, status: 'ok' });
  });
});
