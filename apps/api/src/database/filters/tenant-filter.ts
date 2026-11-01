import type { Dictionary } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Request-scoped tenant filter.
 *
 * A MikroORM global filter (default-enabled) that scopes "shared household"
 * entities to the current tenant, with a per-account privacy carve-out.
 *
 * STRATEGY: scope-when-present. The filter only restricts once a tenant context
 * has been stamped onto the EM via `setTenantContext` — which
 * `resolveTenantForRequest` does on every authed route. Non-request contexts
 * (workers, webhooks, CLI scripts, seeders) never set it, so the filter is a
 * no-op there and needs no per-site bypass. A fail-loud guard on authed data
 * routes (see `@middleware/tenant-scope`) turns a forgotten context into a crash
 * rather than a silent cross-member leak.
 *
 * `args: false` on each `@Filter` disables MikroORM's "no arguments provided"
 * check, so a query with no tenant context set does not throw — it passes
 * through (the `cond` returns `{}`).
 */
export const TENANT_FILTER = 'tenant';

export interface TenantContext {
  appuserKey: number;
  tenantKey: number;
}

type TenantFilterArgs = Partial<TenantContext>;

/** Stamp the tenant context onto a request-scoped EM so the filter engages. */
export function setTenantContext(em: EntityManager, ctx: TenantContext): void {
  em.setFilterParams(TENANT_FILTER, ctx);
}

const hasTenant = (args?: TenantFilterArgs): args is TenantContext => args?.tenantKey != null;

/** tenantKey = current tenant. For NOT-NULL tenant entities with no privacy dimension. */
export const tenantScopedCond = (args?: TenantFilterArgs): Dictionary => (hasTenant(args) ? { tenantKey: args.tenantKey } : {});

/** tenantKey = current tenant OR NULL — NULL-tenant rows are global/system and shared across tenants. */
export const tenantOrGlobalCond = (args?: TenantFilterArgs): Dictionary =>
  hasTenant(args) ? { $or: [{ tenantKey: args.tenantKey }, { tenantKey: null }] } : {};

/**
 * Transaction scope: tenant + privacy carve-out via the linked account. A transaction
 * on a private account is visible only to that account's owner; account-less
 * transactions are tenant-scoped only.
 */
export const transactionTenantCond = (args?: TenantFilterArgs): Dictionary =>
  hasTenant(args)
    ? {
        $and: [
          { tenantKey: args.tenantKey },
          {
            $or: [
              { accountKey: null },
              { accountKey: { isPrivate: false } },
              { accountKey: { accountOwnerAppuserKey: args.appuserKey } },
            ],
          },
        ],
      }
    : {};

/** Account scope + per-account privacy carve-out: private accounts are visible only to their owner. */
export const accountTenantCond = (args?: TenantFilterArgs): Dictionary =>
  hasTenant(args)
    ? { $and: [{ tenantKey: args.tenantKey }, { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: args.appuserKey }] }] }
    : {};

/**
 * RecurringSeries privacy: a recurring series carries the source account,
 * so a series detected from a private account stays owner-only — same shape as Transaction.
 * Prevents the tenant-wide recurring detection from leaking a private account's recurring
 * spend to other household members.
 */
export const recurringSeriesTenantCond = transactionTenantCond;

/**
 * User-toggled visibility flag. Unconditional (no tenant/user args, no
 * scope-when-present): a transaction hidden by either household member is hidden
 * for both, everywhere transaction data is aggregated. Applied on Transaction only.
 * Net worth is deliberately NOT filtered by this: account balances still include
 * hidden rows.
 */
export const HIDDEN_FILTER = 'hidden';

export const hiddenTransactionCond = () => ({ hidden: false });
