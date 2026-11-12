/**
 * A portfolio's link to the account that holds it, so net worth counts the same money once.
 * Mirrors web's `lib/portfolio/account-link.ts`; the API owns the rules (`portfolio-account-link.ts`).
 *
 * `includes_holdings`: the account's balance already contains the securities; net worth counts
 * the account and shows the portfolio without adding it. `cash_only`: the account holds only the
 * uninvested cash, so both count.
 *
 * A link is only ever shown to a member who can see its account. A portfolio linked to the other
 * member's private account reads as not linked here, and changing it is refused with the holder's
 * name and nothing about the account (`portfolio-link-held`).
 */
export const PORTFOLIO_ACCOUNT_BALANCE_MODES = ['includes_holdings', 'cash_only'] as const
export type PortfolioAccountBalanceMode = typeof PORTFOLIO_ACCOUNT_BALANCE_MODES[number]

export type PortfolioAccountLink = Readonly<{
  accountKey: number
  accountName: string | null
  mode: PortfolioAccountBalanceMode
}>

/** What the API takes to set a link; null removes it. */
export type PortfolioAccountLinkInput = Readonly<{
  accountId: number
  mode: PortfolioAccountBalanceMode
}>

/** The link being edited in a form: no account means "not linked". */
export type PortfolioAccountLinkDraft = Readonly<{
  accountId: number | null
  mode: PortfolioAccountBalanceMode
}>

/** The fields of an account (from `/v1/accounts`) the link picker reads. */
export type LinkableAccount = Readonly<{
  accountKey: number
  accountName: string | null
  accountType?: string | null
  source: string
  accountFinancialInstitutionKey?: Readonly<{ displayName: string | null }> | null
}>

export const NOT_LINKED_DRAFT: PortfolioAccountLinkDraft = Object.freeze({ accountId: null, mode: 'includes_holdings' })

/**
 * The answer to preselect for "Does this account's balance include your investments?". Bank
 * APIs usually report only the cash, so a synced account starts on "No, cash only"; a manual
 * account is usually typed in as the whole statement balance, so it starts on "Yes".
 */
export function defaultBalanceMode(account: Pick<LinkableAccount, 'source'>): PortfolioAccountBalanceMode {
  return account.source === 'open_banking' ? 'cash_only' : 'includes_holdings'
}

export function isInvestmentAccount(account: Pick<LinkableAccount, 'accountType'>): boolean {
  return account.accountType === 'INVESTMENT'
}

/** The draft after choosing an account: the mode resets to that account's default. */
export function chooseLinkAccount(accounts: readonly LinkableAccount[], accountId: number | null): PortfolioAccountLinkDraft {
  const account = accounts.find((candidate) => candidate.accountKey === accountId)
  if (!account) return NOT_LINKED_DRAFT
  return { accountId: account.accountKey, mode: defaultBalanceMode(account) }
}

export function draftFromLink(link: PortfolioAccountLink | null | undefined): PortfolioAccountLinkDraft {
  return link ? { accountId: link.accountKey, mode: link.mode } : NOT_LINKED_DRAFT
}

export function linkInputFromDraft(draft: PortfolioAccountLinkDraft): PortfolioAccountLinkInput | null {
  return draft.accountId === null ? null : { accountId: draft.accountId, mode: draft.mode }
}

/**
 * Whether saving the draft changes the stored link. An unchanged link is never sent, so a link
 * this member cannot see (it reads as "not linked") is never touched by an unrelated save.
 */
export function linkChanged(link: PortfolioAccountLink | null | undefined, draft: PortfolioAccountLinkDraft): boolean {
  if (!link) return draft.accountId !== null
  return draft.accountId !== link.accountKey || draft.mode !== link.mode
}

/** Whether the stored link is what `input` asked for (null: no link). */
export function linkMatches(link: PortfolioAccountLink | null | undefined, input: PortfolioAccountLinkInput | null): boolean {
  if (input === null) return link == null
  return link != null && link.accountKey === input.accountId && link.mode === input.mode
}

/** Investment accounts first, so the likely match leads the list. */
export function sortLinkableAccounts<T extends LinkableAccount>(accounts: readonly T[]): T[] {
  return [...accounts].sort((a, b) => Number(isInvestmentAccount(b)) - Number(isInvestmentAccount(a)))
}

/** An account's name as web's picker shows it: its own name, else its bank's, else its key. */
export function linkAccountLabel(account: LinkableAccount): string {
  return account.accountName ?? account.accountFinancialInstitutionKey?.displayName ?? String(account.accountKey)
}
