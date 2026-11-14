import type { EntityManager } from '@mikro-orm/postgresql';

import { Portfolio } from '@entity/Portfolio';
import { type MemberFilter, portfoliosOfMembers } from '@service/household/member-attribution';

/**
 * The keys of the household portfolios a member filter keeps (`portfoliosOfMembers`: a member's
 * own, a former member's under Shared). Undefined without a filter, or without a tenant (worker
 * paths), so those reads cover every portfolio as before; an empty list when the filter keeps
 * none. Only the household's portfolios are ever listed, so a member of another household keeps
 * nothing. A portfolio excluded from the aggregate dashboard is kept: this narrows by who, for a
 * read that names one portfolio. The combined views use `aggregatePortfolioKeys`.
 */
export async function memberPortfolioKeys(em: EntityManager, tenantKey: number | undefined, members: MemberFilter | undefined): Promise<number[] | undefined> {
  if (!members || tenantKey == null) return undefined;
  const portfolios = await em.find(Portfolio, { deletedAt: undefined, tenantKey: { tenantKey } });
  return (await portfoliosOfMembers(em, tenantKey, portfolios, members)).map((portfolio) => portfolio.portfolioKey);
}

/** The household portfolios a combined view is about, split by the "Exclude from aggregate dashboard" switch. */
export interface AggregatePortfolioScope {
  /**
   * Excluded portfolios the member filter keeps: left out of every combined figure, but still
   * listed (marked) in the dashboard's breakdown so their own page can be opened.
   */
  excluded: Portfolio[];
  /**
   * The portfolios every combined figure covers: the member filter's, less the excluded ones.
   * Undefined when that is every portfolio in scope (no filter, none excluded, or no tenant), so
   * the reads keep their unfiltered path.
   */
  included: number[] | undefined;
}

/**
 * The portfolios the combined (all-portfolios) views cover: the household's, narrowed by the
 * member filter as `memberPortfolioKeys` narrows them, less every portfolio switched to "Exclude
 * from aggregate dashboard" (`Portfolio.excluded`). Net worth and a read of one portfolio do not
 * use this: an excluded portfolio still counts in net worth, and its own page reads it in full.
 */
export async function aggregatePortfolioScope(em: EntityManager, tenantKey: number | undefined, members: MemberFilter | undefined): Promise<AggregatePortfolioScope> {
  if (tenantKey == null) return { excluded: [], included: undefined };
  const household = await em.find(Portfolio, { deletedAt: undefined, tenantKey: { tenantKey } }, { orderBy: { portfolioKey: 'asc' } });
  const kept = members ? await portfoliosOfMembers(em, tenantKey, household, members) : household;
  const excluded = kept.filter((portfolio) => portfolio.excluded);
  if (!members && excluded.length === 0) return { excluded, included: undefined };
  return { excluded, included: kept.filter((portfolio) => !portfolio.excluded).map((portfolio) => portfolio.portfolioKey) };
}

/** The `included` keys of `aggregatePortfolioScope`: what every combined figure covers. */
export async function aggregatePortfolioKeys(em: EntityManager, tenantKey: number | undefined, members: MemberFilter | undefined): Promise<number[] | undefined> {
  return (await aggregatePortfolioScope(em, tenantKey, members)).included;
}
