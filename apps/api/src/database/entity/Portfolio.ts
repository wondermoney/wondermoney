import { Collection, LoadStrategy } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { FinancialTransaction } from './FinancialTransaction';
import { Tenant } from './Tenant';

/**
 * Whether a linked account's balance already includes the portfolio's holdings. With
 * `includes_holdings` net worth counts the account and shows the portfolio without adding it;
 * with `cash_only` the account holds only the uninvested cash, so both count.
 */
export enum PortfolioAccountBalanceMode {
  CASH_ONLY = 'cash_only',
  INCLUDES_HOLDINGS = 'includes_holdings',
}

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
export class Portfolio extends Base {
  @Property({ default: 'SPY', length: 20, nullable: true })
  benchmarkSymbol?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  closedAt?: Date;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  /** Set exactly when `linkedAccountKey` is; see {@link PortfolioAccountBalanceMode}. */
  @Enum({ items: () => PortfolioAccountBalanceMode, nullable: true })
  accountBalanceMode?: null | PortfolioAccountBalanceMode;

  /**
   * How a sale relieves cost: FIFO (oldest lots first) or the running average of the open
   * position. See {@link PortfolioCostBasisMethod}.
   */
  @Enum({ default: PortfolioCostBasisMethod.FIFO, items: () => PortfolioCostBasisMethod })
  costBasisMethod: PortfolioCostBasisMethod = PortfolioCostBasisMethod.FIFO;

  @Property({ length: 500, nullable: true })
  description?: string;

  @Property({ default: false })
  excluded = false;

  @Property({ default: false })
  favored = false;

  /**
   * The bank or brokerage account that holds this portfolio, if any. The account may be private
   * to one member while the portfolio is shared: read it only through
   * `portfolio-account-link.ts`, which resolves it against the accounts the viewer can see.
   */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Account, fieldName: 'linked_account_key', nullable: true })
  linkedAccountKey?: null | Rel<Account>;

  @Property({ length: 255 })
  name!: string;

  @PrimaryKey()
  portfolioKey!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'portfolio_owner_appuser_key' })
  portfolioOwnerAppuserKey!: Rel<Appuser>;

  @Property({ columnType: 'timestamptz', nullable: true })
  refreshedAt?: Date;

  @Property({ columnType: 'jsonb', nullable: true })
  targetAllocation?: Record<string, number>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @OneToMany({
    cascade: [],
    entity: () => FinancialTransaction,
    mappedBy: 'portfolioKey',
    nullable: true,
    strategy: LoadStrategy.JOINED,
  })
  transactions = new Collection<FinancialTransaction>(this);
}
