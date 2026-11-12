import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { FormGroup, FormSelectRow } from '@/components/ui/form-row'
import type { SheetOption } from '@/components/ui/sheet'

import {
  chooseLinkAccount,
  linkAccountLabel,
  sortLinkableAccounts,
  type LinkableAccount,
  type PortfolioAccountBalanceMode,
  type PortfolioAccountLinkDraft,
  type PortfolioAccountLinkInput,
} from './portfolio-account-link'

const NOT_LINKED = 'none'

const MODE_KEYS: Readonly<Record<PortfolioAccountBalanceMode, { label: string; hint: string }>> = {
  includes_holdings: { label: 'portfolioAccountLink.includesHoldings', hint: 'portfolioAccountLink.includesHoldingsHint' },
  cash_only: { label: 'portfolioAccountLink.cashOnly', hint: 'portfolioAccountLink.cashOnlyHint' },
}

/**
 * The words for a refused link change: the member who holds it, by name, and nothing about the
 * account; without the name (an older API), that only the other member can change it. Null for
 * any other failure.
 */
export function linkRefusalMessage(t: TFunction, failure: string, holder: string | null): string | null {
  if (failure === 'link-held' && holder) return t('portfolioAccountLink.alreadyLinkedBy', { name: holder })
  if (failure === 'link-held' || failure === 'link-managed') return t('portfolioAccountLink.managedByPartner')
  return null
}

export function balanceModeLabel(t: TFunction, mode: PortfolioAccountBalanceMode): string {
  return t(MODE_KEYS[mode].label)
}

/** How a link reads in a review: the account, then the answer about its balance; or "Not linked". */
export function linkSummary(t: TFunction, input: PortfolioAccountLinkInput | null, accounts: readonly LinkableAccount[], knownName?: string | null): string {
  if (input === null) return t('portfolioAccountLink.notLinked')
  const account = accounts.find((candidate) => candidate.accountKey === input.accountId)
  const name = account ? linkAccountLabel(account) : knownName ?? String(input.accountId)
  return `${name} · ${balanceModeLabel(t, input.mode)}`
}

/**
 * Web's `PortfolioAccountLinkFields` at phone width: pick the account that holds the portfolio,
 * then answer whether that account's balance already includes the investments. The answer is
 * always asked; choosing an account preselects "No, cash only" for a bank-synced account and
 * "Yes" for a manual one. Investment accounts lead the list.
 */
export function PortfolioAccountLinkFields({ accounts, value, onChange, disabled = false, linkedAccountName, testID }: {
  accounts: readonly LinkableAccount[]
  value: PortfolioAccountLinkDraft
  onChange: (value: PortfolioAccountLinkDraft) => void
  disabled?: boolean
  /** The stored link's account name, shown while the accounts list has not loaded yet. */
  linkedAccountName?: string | null
  testID?: string
}) {
  const { t } = useTranslation()
  const sorted = sortLinkableAccounts(accounts)
  const known = value.accountId === null || sorted.some((account) => account.accountKey === value.accountId)
  const accountOptions: SheetOption<string>[] = [
    { value: NOT_LINKED, label: t('portfolioAccountLink.notLinked') },
    ...sorted.map((account) => ({ value: String(account.accountKey), label: linkAccountLabel(account) })),
    ...(!known && linkedAccountName ? [{ value: String(value.accountId), label: linkedAccountName }] : []),
  ]
  const modeOptions: SheetOption<PortfolioAccountBalanceMode>[] = (Object.keys(MODE_KEYS) as PortfolioAccountBalanceMode[])
    .map((mode) => ({ value: mode, label: t(MODE_KEYS[mode].label), meta: t(MODE_KEYS[mode].hint) }))

  return (
    <FormGroup testID={testID}>
      <FormSelectRow
        key="account"
        disabled={disabled}
        label={t('portfolioAccountLink.accountLabel')}
        onChange={(next) => {
          if (next === NOT_LINKED) onChange(chooseLinkAccount(accounts, null))
          else if (Number(next) !== value.accountId) onChange(chooseLinkAccount(accounts, Number(next)))
        }}
        options={accountOptions}
        placeholder={t('portfolioAccountLink.selectAccount')}
        value={value.accountId === null ? NOT_LINKED : String(value.accountId)}
      />
      {value.accountId !== null ? (
        <FormSelectRow
          key="mode"
          disabled={disabled}
          hint={t(MODE_KEYS[value.mode].hint)}
          label={t('portfolioAccountLink.question')}
          onChange={(mode) => onChange({ ...value, mode })}
          options={modeOptions}
          placeholder={t(MODE_KEYS[value.mode].label)}
          value={value.mode}
        />
      ) : null}
    </FormGroup>
  )
}
