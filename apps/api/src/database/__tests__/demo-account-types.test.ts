import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Tenant, TenantType } from '@entity/Tenant';

import { AppuserSeeder } from '../seeders/AppuserSeeder';
import { demoPersona } from '../seeders/demo/demo-fixtures';
import { TenantSeeder } from '../seeders/TenantSeeder';

const mocks = vi.hoisted(() => ({
  createBetterAuthUser: vi.fn(({ email }: { email: string }) => Promise.resolve({ id: `better-auth-user-${email}` })),
  deleteBetterAuthUserByEmail: vi.fn(() => Promise.resolve()),
}));

// AppuserSeeder creates a real better-auth credential user per seeded Appuser (so seeded
// accounts can log in); mock it out here so this unit test never touches a real Postgres.
vi.mock('@service/auth/better-auth', () => ({
  createBetterAuthUser: mocks.createBetterAuthUser,
  deleteBetterAuthUserByEmail: mocks.deleteBetterAuthUserByEmail,
}));

describe('demo account metadata', () => {
  it('exports appuser account types and default regular value', () => {
    const appuser = new Appuser();

    expect(AppuserAccountType.ADMIN).toBe('admin');
    expect(AppuserAccountType.DEMO).toBe('demo');
    expect(AppuserAccountType.REGULAR).toBe('regular');
    expect(appuser.accountType).toBe(AppuserAccountType.REGULAR);
  });

  it('exports tenant types and default regular value', () => {
    const tenant = new Tenant();

    expect(TenantType.DEMO).toBe('demo');
    expect(TenantType.REGULAR).toBe('regular');
    expect(tenant.tenantType).toBe(TenantType.REGULAR);
  });

  it('seeds demo/admin/empty appusers with the expected account types', async () => {
    const created: Record<string, unknown>[] = [];
    const em = {
      create: (entity: new () => Record<string, unknown>, data: Record<string, unknown>) => {
        const record = Object.assign(new entity(), data);
        created.push(record);
        return record;
      },
    } as unknown as EntityManager;

    const ctx: Dictionary = { currencies: [{ code: 'EUR', currencyKey: 1 }] };

    await new AppuserSeeder().run(em, ctx);

    expect(mocks.deleteBetterAuthUserByEmail).toHaveBeenCalledTimes(3);
    expect(mocks.createBetterAuthUser).toHaveBeenCalledTimes(3);
    expect(created).toHaveLength(3);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountType: AppuserAccountType.ADMIN,
          emailAddress: 'admin@wonder.money',
          externalUserId: 'better-auth-user-admin@wonder.money',
        }),
        expect.objectContaining({
          accountType: AppuserAccountType.DEMO,
          emailAddress: demoPersona.email,
          externalUserId: `better-auth-user-${demoPersona.email}`,
          firstName: 'Sofia',
          lastName: 'Martins',
        }),
        expect.objectContaining({
          accountType: AppuserAccountType.REGULAR,
          emailAddress: 'empty@wonder.money',
          externalUserId: 'better-auth-user-empty@wonder.money',
        }),
      ]),
    );
  });

  it('seeds demo tenant as demo and admin/empty tenants as regular', async () => {
    const created: Record<string, unknown>[] = [];
    const em = {
      create: (entity: new () => Record<string, unknown>, data: Record<string, unknown>) => {
        const record = Object.assign(new entity(), data);
        created.push(record);
        return record;
      },
    } as unknown as EntityManager;

    const demoAppuser = { appuserKey: 2 };
    const adminAppuser = { appuserKey: 1 };
    const emptyAppuser = { appuserKey: 3 };

    const ctx: Dictionary = {
      _ADMIN_appuser: adminAppuser,
      _DEMO_appuser: demoAppuser,
      _EMPTY_appuser: emptyAppuser,
    };

    await new TenantSeeder().run(em, ctx);

    expect(created).toHaveLength(3);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: demoPersona.householdName,
          ownerAppuserKey: demoAppuser,
          tenantType: TenantType.DEMO,
        }),
        expect.objectContaining({ ownerAppuserKey: adminAppuser, tenantType: TenantType.REGULAR }),
        expect.objectContaining({ ownerAppuserKey: emptyAppuser, tenantType: TenantType.REGULAR }),
      ]),
    );
  });
});
