import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';

import { Account } from '@entity/Account';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import { Category } from '@entity/Category';
import { Tenant } from '@entity/Tenant';

import { BudgetSeeder } from '../seeders/BudgetSeeder';

/**
 * DB-free assertions on the household entity defaults and seeder behaviour.
 */
describe('household entity defaults', () => {
  it('exposes the household roles with the expected string values', () => {
    expect(HouseholdRole.OWNER).toBe('owner');
    expect(HouseholdRole.MEMBER).toBe('member');
  });

  it('defaults a new membership to owner (every historical link owns its tenant)', () => {
    expect(new AppuserTenant().role).toBe(HouseholdRole.OWNER);
  });

  it('defaults a new account to shared (not private)', () => {
    expect(new Account().isPrivate).toBe(false);
  });

  it('lets a budget carry a tenant (household-shared) and a category carry an optional tenant', () => {
    const tenant = Object.assign(new Tenant(), { tenantKey: 7 });

    const budget = new Budget();
    budget.tenantKey = tenant;
    expect(budget.tenantKey).toBe(tenant);

    // Category tenant is optional: system categories stay global (undefined tenant).
    const systemCategory = new Category();
    expect(systemCategory.tenantKey).toBeUndefined();
  });

  it('seeds the demo budget with its tenant so the NOT NULL tenant_key holds', async () => {
    const created: Record<string, unknown>[] = [];
    const em = {
      create: (entity: new () => Record<string, unknown>, data: Record<string, unknown>) => {
        const record = Object.assign(new entity(), data);
        created.push(record);
        return record;
      },
    } as unknown as EntityManager;

    const demoTenant = { tenantKey: 2 };
    const ctx: Dictionary = {
      _DEMO_appuser: { appuserKey: 2 },
      _DEMO_tenant: demoTenant,
      currencies: [{ code: 'EUR', currencyKey: 1 }],
    };

    await new BudgetSeeder().run(em, ctx);

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(expect.objectContaining({ tenantKey: demoTenant }));
  });
});
