/**
 * A portfolio's link to the account that holds it, so net worth counts the same money once.
 *
 * `includes_holdings`: the account's balance already contains the securities; net worth counts
 * the account and shows the portfolio without adding it. `cash_only`: the account holds only the
 * uninvested cash, so both count.
 */
export type PortfolioAccountBalanceMode = "includes_holdings" | "cash_only";

export interface PortfolioAccountLink {
  accountKey: number;
  accountName: string | null;
  mode: PortfolioAccountBalanceMode;
}

/** What the API takes to set a link; null removes it. */
export interface PortfolioAccountLinkInput {
  accountId: number;
  mode: PortfolioAccountBalanceMode;
}

/** The link being edited in a form: no account means "not linked". */
export interface PortfolioAccountLinkDraft {
  accountId: number | null;
  mode: PortfolioAccountBalanceMode;
}

interface LinkableAccount {
  accountKey: number;
  accountType?: string | null;
  source: "manual" | "open_banking";
}

/**
 * The answer to preselect for "Does this account's balance include your investments?". Bank
 * APIs usually report only the cash, so a synced account starts on "No, cash only"; a manual
 * account is usually typed in as the whole statement balance, so it starts on "Yes".
 */
export function defaultBalanceMode(
  account: Pick<LinkableAccount, "source">,
): PortfolioAccountBalanceMode {
  return account.source === "open_banking" ? "cash_only" : "includes_holdings";
}

export function isInvestmentAccount(
  account: Pick<LinkableAccount, "accountType">,
): boolean {
  return account.accountType === "INVESTMENT";
}

/**
 * Whether to ask "Is this the same money?" for a new portfolio: an investment account the viewer
 * can see that no portfolio is linked to yet. A link to an account the viewer can see is always
 * visible to them, whichever member made it, so a pair either member linked is never suggested.
 */
export function hasUnlinkedInvestmentAccount(
  accounts: Pick<LinkableAccount, "accountKey" | "accountType">[],
  portfolios: { accountLink?: Pick<PortfolioAccountLink, "accountKey"> | null }[],
): boolean {
  const linked = new Set(
    portfolios.map((portfolio) => portfolio.accountLink?.accountKey),
  );
  return accounts.some(
    (account) => isInvestmentAccount(account) && !linked.has(account.accountKey),
  );
}

/** The draft after choosing an account: the mode resets to that account's default. */
export function chooseLinkAccount(
  accounts: LinkableAccount[],
  accountId: number | null,
): PortfolioAccountLinkDraft {
  const account = accounts.find(
    (candidate) => candidate.accountKey === accountId,
  );
  if (!account) return { accountId: null, mode: "includes_holdings" };
  return { accountId: account.accountKey, mode: defaultBalanceMode(account) };
}

export function draftFromLink(
  link: PortfolioAccountLink | null | undefined,
): PortfolioAccountLinkDraft {
  return link
    ? { accountId: link.accountKey, mode: link.mode }
    : { accountId: null, mode: "includes_holdings" };
}

export function linkInputFromDraft(
  draft: PortfolioAccountLinkDraft,
): PortfolioAccountLinkInput | null {
  return draft.accountId === null
    ? null
    : { accountId: draft.accountId, mode: draft.mode };
}

/** Whether saving the draft changes the stored link. */
export function linkChanged(
  link: PortfolioAccountLink | null | undefined,
  draft: PortfolioAccountLinkDraft,
): boolean {
  if (!link) return draft.accountId !== null;
  return draft.accountId !== link.accountKey || draft.mode !== link.mode;
}

/** Investment accounts first, so the likely match leads the list. */
export function sortLinkableAccounts<T extends LinkableAccount>(
  accounts: T[],
): T[] {
  return [...accounts].sort(
    (a, b) => Number(isInvestmentAccount(b)) - Number(isInvestmentAccount(a)),
  );
}
