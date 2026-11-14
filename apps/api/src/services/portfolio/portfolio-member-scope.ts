import type { EntityManager } from '@mikro-orm/postgresql';

import { Portfolio } from '@entity/Portfolio';
import { type MemberFilter, portfoliosOfMembers } from '@service/household/member-attribution';

/**
 * The keys of the household portfolios a member filter keeps (`portfoliosOfMembers`: a member's
 * own, a former member's under Shared), for the aggregate portfolio reads. Undefined without a
 * filter, or without a tenant (worker paths), so those reads cover every portfolio as before; an
 * empty list when the filter keeps none. Only the household's portfolios are ever listed, so a
 * member of another household keeps nothing.
 */
export async function memberPortfolioKeys(em: EntityManager, tenantKey: number | undefined, members: MemberFilter | undefined): Promise<number[] | undefined> {
  if (!members || tenantKey == null) return undefined;
  const portfolios = await em.find(Portfolio, { deletedAt: undefined, tenantKey: { tenantKey } });
  return (await portfoliosOfMembers(em, tenantKey, portfolios, members)).map((portfolio) => portfolio.portfolioKey);
}
