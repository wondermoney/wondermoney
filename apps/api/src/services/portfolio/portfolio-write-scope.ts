import type { Appuser } from '@entity/Appuser';

/**
 * The portfolios a user may write to, as Portfolio criteria.
 *
 * Portfolios belong to the household, so with a resolved tenant (request paths) any member
 * may write to any of the tenant's portfolios. Without one (worker paths, where the tenant
 * filter is a deliberate bypass) only the portfolio's owner may. The tenant is sent
 * explicitly rather than left to the filter, so the scope holds on every entity manager.
 *
 * Portfolios have no linked cash account, so `Account.isPrivate` does not apply to them.
 */
export function portfolioWriteScope(
  appuser: Pick<Appuser, 'appuserKey'>,
  tenantKey?: number,
): { portfolioOwnerAppuserKey: { appuserKey: number } } | { tenantKey: { tenantKey: number } } {
  return tenantKey == null
    ? { portfolioOwnerAppuserKey: { appuserKey: appuser.appuserKey } }
    : { tenantKey: { tenantKey } };
}
