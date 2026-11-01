import { describe, expect, it } from 'vitest';

import { accountTenantCond, tenantOrGlobalCond, tenantScopedCond, transactionTenantCond } from '../filters/tenant-filter';

/**
 * Tenant filter condition logic (DB-free). The end-to-end proof that
 * MikroORM actually applies these conditions lives in the integration script
 * `src/database/scripts/verify-tenant-filter.ts`.
 */
describe('tenant filter conditions', () => {
  it('scope-when-present: no tenant context → pass-through (empty condition)', () => {
    expect(tenantScopedCond(undefined)).toEqual({});
    expect(tenantScopedCond({})).toEqual({});
    expect(tenantScopedCond({ appuserKey: 1 })).toEqual({}); // appuser without tenant is still pass-through
    expect(tenantOrGlobalCond(undefined)).toEqual({});
    expect(accountTenantCond(undefined)).toEqual({});
    expect(transactionTenantCond(undefined)).toEqual({});
  });

  it('tenantScopedCond scopes strictly to the current tenant', () => {
    expect(tenantScopedCond({ appuserKey: 1, tenantKey: 7 })).toEqual({ tenantKey: 7 });
  });

  it('tenantOrGlobalCond also admits NULL-tenant global/system rows', () => {
    expect(tenantOrGlobalCond({ appuserKey: 1, tenantKey: 7 })).toEqual({
      $or: [{ tenantKey: 7 }, { tenantKey: null }],
    });
  });

  it('accountTenantCond adds the privacy carve-out (private = owner-only)', () => {
    expect(accountTenantCond({ appuserKey: 3, tenantKey: 7 })).toEqual({
      $and: [{ tenantKey: 7 }, { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: 3 }] }],
    });
  });

  it('transactionTenantCond scopes by tenant + account privacy (via the linked account)', () => {
    expect(transactionTenantCond({ appuserKey: 3, tenantKey: 7 })).toEqual({
      $and: [
        { tenantKey: 7 },
        {
          $or: [
            { accountKey: null },
            { accountKey: { isPrivate: false } },
            { accountKey: { accountOwnerAppuserKey: 3 } },
          ],
        },
      ],
    });
  });
});
