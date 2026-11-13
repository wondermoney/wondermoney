import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addBudget } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addCategory, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import { InsightsService } from '@service/insights/insights.service';

import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';
import { TenantFinancialAggregationService } from '../tenant-financial-aggregation.service';

/*
 * Budget alerts (email and push), the budget-left email, the Money Story's budget pressure and the
 * insights all read a member's budgets through one repository. A personal budget reaches its owner
 * there and nobody else: not the household's owner, not an admin, not another member.
 */
describe('a personal budget in alerts, emails and insights', () => {
  const db = useTestDatabase();
  const at = (day: string) => new Date(`${day}T12:00:00.000Z`);
  const scheduledFor = '2026-11-26T09:00:00Z';

  async function setup() {
    const em = db.em();
    const home = await seedHousehold(em);
    const admin = await addPartner(em, home, { role: HouseholdRole.ADMIN });
    const owner = await addPartner(em, home);
    const account = await addAccount(em, home, { owner });
    const food = await addCategory(em, home, 'Food');
    const groceries = await addCategory(em, home, 'Groceries', food);
    food.appuserKey = owner;
    groceries.appuserKey = owner;
    const { budget } = await addBudget(em, home, { lines: [{ accounts: [account], amount: 100, category: groceries, months: [11], year: 2026 }], name: 'Mine' });
    budget.appuserKey = owner;
    budget.ownerAppuserKey = owner;
    await em.flush();
    await addTransaction(em, home, { account, amount: -95, appuser: owner, category: groceries, date: at('2026-11-20'), status: 'BOOKED' });
    return { admin, home, owner, service: new TenantFinancialAggregationService(new MikroOrmTenantAggregationRepository(em)) };
  }

  const input = (home: Household, member: Appuser) => ({ appuserKey: member.appuserKey, scheduledFor, tenantKey: home.tenant.tenantKey });

  it('alerts its owner', async () => {
    const { home, owner, service } = await setup();

    const thresholds = await service.aggregateBudgetThresholds(input(home, owner));
    const remaining = await service.aggregateBudgetRemaining(input(home, owner));

    expect(thresholds.facts).toEqual([expect.objectContaining({ amountBudgeted: '100', amountSpent: '95', month: 11, year: 2026 })]);
    expect(remaining).toMatchObject({ facts: { spent: '95', totalBudgeted: '100' }, status: 'ok' });
  });

  it('alerts no other member, the household owner and an admin included', async () => {
    const { admin, home, service } = await setup();

    for (const member of [home.appuser, admin]) {
      const thresholds = await service.aggregateBudgetThresholds(input(home, member));
      const remaining = await service.aggregateBudgetRemaining(input(home, member));
      const pressure = await service.aggregateMonthlyInsights(input(home, member));

      expect(thresholds.facts).toEqual([]);
      expect(remaining.status).not.toBe('ok');
      expect(JSON.stringify(pressure)).not.toContain('Mine');
    }
  });

  it('is not in another member\'s insights', async () => {
    const { admin, home, owner } = await setup();
    const repository = new MikroOrmTenantAggregationRepository(db.em());
    const insightsOf = (member: Appuser) => new InsightsService(repository).getInsights({ appuserKey: member.appuserKey, currency: 'EUR', now: at('2026-11-25'), tenantKey: home.tenant.tenantKey });

    expect(JSON.stringify(await insightsOf(owner))).toContain('Mine');
    for (const member of [home.appuser, admin]) expect(JSON.stringify(await insightsOf(member))).not.toContain('Mine');
  });

});
