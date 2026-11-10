import { type EntityManager, wrap } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { type Portfolio, PortfolioAccountBalanceMode } from '@entity/Portfolio';
import { ForbiddenError, NotFoundError } from '@utils/errors';

/**
 * A portfolio's link to the bank or brokerage account that holds it.
 *
 * A link guards net worth against counting the same money twice. With `includes_holdings` the
 * account's balance already contains the securities, so net worth counts the account and shows the
 * portfolio without adding it; with `cash_only` the account holds only the uninvested cash and
 * both count.
 *
 * Every rule here is relative to the viewer. Portfolios are shared with the household, but the
 * linked account can be private to one member. The portfolio is left out of a total only when that
 * total counts the linked account, so each member counts the money exactly once: the account's
 * owner through the account, the other member (who cannot see it) through the portfolio. The same
 * rule covers an account that is deleted, has no balance in the viewer's currency, or did not exist
 * yet at a history point. A link is only ever shown to a member who can see its account.
 */
export interface PortfolioAccountLinkView {
  accountKey: number;
  accountName: null | string;
  mode: PortfolioAccountBalanceMode;
}

export interface PortfolioLinkFields {
  accountBalanceMode?: null | PortfolioAccountBalanceMode;
  linkedAccountKey?: null | { accountKey: number };
}

/** The account whose counted balance already includes this portfolio, or undefined when the portfolio counts on its own. */
export function portfolioCountedInAccount(portfolio: PortfolioLinkFields, countedAccountKeys: ReadonlySet<number>): number | undefined {
  const accountKey = portfolio.linkedAccountKey?.accountKey;
  if (accountKey == null || portfolio.accountBalanceMode !== PortfolioAccountBalanceMode.INCLUDES_HOLDINGS) return undefined;
  return countedAccountKeys.has(accountKey) ? accountKey : undefined;
}

/** The link as this viewer may see it: null when there is none or its account is hidden from them. */
function visiblePortfolioAccountLink(portfolio: PortfolioLinkFields, visibleAccounts: ReadonlyMap<number, { accountName?: null | string }>): null | PortfolioAccountLinkView {
  const accountKey = portfolio.linkedAccountKey?.accountKey;
  if (accountKey == null || !portfolio.accountBalanceMode) return null;
  const account = visibleAccounts.get(accountKey);
  if (!account) return null;
  return { accountKey, accountName: account.accountName ?? null, mode: portfolio.accountBalanceMode };
}

/**
 * Whether to ask "Is this the same money?": the viewer can see an investment account and the
 * household has a portfolio with no link. Amounts are not compared.
 */
export function shouldSuggestPortfolioLink(visibleAccounts: { accountTypeKey?: null | { description?: string } }[], portfolios: PortfolioLinkFields[]): boolean {
  return visibleAccounts.some((account) => account.accountTypeKey?.description === INVESTMENT_ACCOUNT_TYPE)
    && portfolios.some((portfolio) => portfolio.linkedAccountKey == null);
}

const INVESTMENT_ACCOUNT_TYPE = 'INVESTMENT';

export interface PortfolioAccountLinkInput {
  accountId: number;
  mode: `${PortfolioAccountBalanceMode}`;
}

/** Each portfolio's link as this viewer may see it, keyed by portfolio key. The account read runs under the request's tenant and privacy filter. */
export async function loadVisiblePortfolioAccountLinks(em: EntityManager, tenantKey: number, portfolios: (PortfolioLinkFields & { portfolioKey: number })[]): Promise<Map<number, null | PortfolioAccountLinkView>> {
  const accountKeys = [...new Set(portfolios.map((portfolio) => portfolio.linkedAccountKey?.accountKey).filter((key): key is number => key != null))];
  const accounts = accountKeys.length === 0
    ? []
    : await em.find(Account, { accountKey: { $in: accountKeys }, deletedAt: undefined, tenantKey: { tenantKey } }, { fields: ['accountKey', 'accountName'] });
  const visible = new Map(accounts.map((account) => [account.accountKey, account]));
  return new Map(portfolios.map((portfolio) => [portfolio.portfolioKey, visiblePortfolioAccountLink(portfolio, visible)]));
}

/**
 * Link `portfolio` to an account the viewer can see, or unlink it with null. A link to another
 * member's private account belongs to that member: the viewer may neither replace nor remove it
 * (403). An account the viewer cannot see, in this household or another, is not found (404).
 */
export async function setPortfolioAccountLink(em: EntityManager, input: { link: null | PortfolioAccountLinkInput; portfolio: Portfolio; tenantKey: number; viewerAppuserKey: number }): Promise<void> {
  const { link, portfolio, tenantKey, viewerAppuserKey } = input;
  // A portfolio being created has no key yet, and no stored link.
  if (wrap(portfolio).isManaged()) {
    // Read the stored link past every filter: the viewer's privacy filter may hide its account.
    const rows = await em.getConnection().execute<{ linked_account_key: null | number }[]>('select "linked_account_key" from "portfolio" where "portfolio_key" = ?', [portfolio.portfolioKey]);
    const currentKey = rows[0]?.linked_account_key ?? null;
    if (currentKey != null && currentKey !== link?.accountId) {
      const current = await em.findOne(Account, { accountKey: currentKey }, { fields: ['accountKey', 'accountOwnerAppuserKey', 'deletedAt', 'isPrivate'], filters: false });
      if (current && current.deletedAt == null && current.isPrivate && current.accountOwnerAppuserKey?.appuserKey !== viewerAppuserKey) {
        throw new ForbiddenError('This portfolio is linked to an account only the other household member can see.');
      }
    }
  }

  if (!link) {
    portfolio.linkedAccountKey = null;
    portfolio.accountBalanceMode = null;
    return;
  }
  const account = await em.findOne(Account, { accountKey: link.accountId, deletedAt: undefined, tenantKey: { tenantKey } });
  if (!account) throw new NotFoundError('Account not found');
  portfolio.linkedAccountKey = account;
  portfolio.accountBalanceMode = link.mode === 'cash_only' ? PortfolioAccountBalanceMode.CASH_ONLY : PortfolioAccountBalanceMode.INCLUDES_HOLDINGS;
}
