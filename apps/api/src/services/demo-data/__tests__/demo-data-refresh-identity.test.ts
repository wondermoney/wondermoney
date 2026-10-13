import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { AppuserAccountType } from '@entity/Appuser';
import { TenantType } from '@entity/Tenant';
import { resolveDemoRefreshIdentity } from '@service/demo-data/demo-data-refresh-identity';

function createEm(overrides: Partial<{ appusers: unknown[]; links: unknown[]; tenants: unknown[] }> = {}): EntityManager {
  const find = vi.fn((entity: unknown, criteria: unknown) => {
    const name = (entity as { name?: string }).name;
    if (name === 'Appuser') {
      expect(criteria).toEqual({
        accountType: AppuserAccountType.DEMO,
        deletedAt: null,
        emailAddress: demoPersona.email,
        recordActive: true,
      });
      return overrides.appusers ?? [];
    }
    if (name === 'Tenant') {
      expect(criteria).toEqual({
        deletedAt: null,
        name: demoPersona.householdName,
        recordActive: true,
        tenantType: TenantType.DEMO,
      });
      return overrides.tenants ?? [];
    }
    if (name === 'AppuserTenant') {
      expect(criteria).toEqual({
        appuserKey: demoAppuser,
        deletedAt: null,
        recordActive: true,
        tenantKey: demoTenant,
      });
      return overrides.links ?? [];
    }
    return [];
  });
  return {
    find,
  } as unknown as EntityManager;
}

const demoAppuser = {
  accountType: AppuserAccountType.DEMO,
  appuserKey: 11,
  deletedAt: null,
  emailAddress: demoPersona.email,
  recordActive: true,
};
const demoTenant = {
  deletedAt: null,
  name: demoPersona.householdName,
  ownerAppuserKey: { appuserKey: demoAppuser.appuserKey },
  recordActive: true,
  tenantKey: 22,
  tenantType: TenantType.DEMO,
};
const demoLink = {
  appuserKey: demoAppuser,
  appuserTenantKey: 33,
  deletedAt: null,
  recordActive: true,
  tenantKey: demoTenant,
};

describe('resolveDemoRefreshIdentity', () => {
  it('returns missing when the demo appuser is missing', async () => {
    await expect(
      resolveDemoRefreshIdentity(createEm({ links: [demoLink], tenants: [demoTenant] })),
    ).resolves.toEqual({
      reason: 'missing-demo-appuser',
      status: 'missing',
    });
  });

  it('throws when multiple demo appusers exist', async () => {
    await expect(
      resolveDemoRefreshIdentity(
        createEm({ appusers: [demoAppuser, demoAppuser], links: [demoLink], tenants: [demoTenant] }),
      ),
    ).rejects.toThrow('Expected exactly one demo appuser, found 2');
  });

  it('returns missing when the demo tenant is missing', async () => {
    await expect(
      resolveDemoRefreshIdentity(createEm({ appusers: [demoAppuser], links: [demoLink] })),
    ).resolves.toEqual({
      reason: 'missing-demo-tenant',
      status: 'missing',
    });
  });

  it('throws when multiple demo tenants exist', async () => {
    await expect(
      resolveDemoRefreshIdentity(
        createEm({ appusers: [demoAppuser], links: [demoLink], tenants: [demoTenant, demoTenant] }),
      ),
    ).rejects.toThrow('Expected exactly one demo tenant, found 2');
  });

  it('returns missing when the demo link is missing', async () => {
    await expect(
      resolveDemoRefreshIdentity(createEm({ appusers: [demoAppuser], tenants: [demoTenant] })),
    ).resolves.toEqual({
      reason: 'missing-demo-appuser-tenant-link',
      status: 'missing',
    });
  });

  it('throws when multiple demo links exist', async () => {
    await expect(
      resolveDemoRefreshIdentity(
        createEm({ appusers: [demoAppuser], links: [demoLink, demoLink], tenants: [demoTenant] }),
      ),
    ).rejects.toThrow('Expected exactly one demo appuser-tenant link, found 2');
  });

  it('throws when tenant owner does not match the demo appuser', async () => {
    const mismatchedTenant = { ...demoTenant, ownerAppuserKey: { appuserKey: 999 } };
    await expect(
      resolveDemoRefreshIdentity(
        createEm({
          appusers: [demoAppuser],
          links: [{ ...demoLink, tenantKey: mismatchedTenant }],
          tenants: [mismatchedTenant],
        }),
      ),
    ).rejects.toThrow('Demo tenant owner does not match demo appuser');
  });

  it.each([
    ['missing owner', undefined],
    ['null owner', null],
  ])('throws when tenant owner is %s', async (_label, ownerAppuserKey) => {
    const tenant = { ...demoTenant, ownerAppuserKey };
    await expect(
      resolveDemoRefreshIdentity(
        createEm({ appusers: [demoAppuser], links: [{ ...demoLink, tenantKey: tenant }], tenants: [tenant] }),
      ),
    ).rejects.toThrow('Demo tenant owner is missing');
  });

  it('resolves the demo refresh identity', async () => {
    const em = createEm({ appusers: [demoAppuser], links: [demoLink], tenants: [demoTenant] });
    await expect(resolveDemoRefreshIdentity(em)).resolves.toEqual({
      appuser: demoAppuser,
      appuserTenant: demoLink,
      status: 'found',
      tenant: demoTenant,
    });
  });
});
