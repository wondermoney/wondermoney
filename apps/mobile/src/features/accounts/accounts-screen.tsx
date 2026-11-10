import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { Badge } from '@/components/ui/badge'
import { accountMark, EntityMark } from '@/components/ui/entity-mark'
import { describeFxState, FxStatusLabel } from '@/components/ui/fx-status-label'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { EmptyState, Section } from '@/components/ui/section'
import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { formatRelativeTime } from '@/lib/formatters/relative-time'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import { ACCOUNTS_TIMEFRAMES, type AccountsTimeframe } from '@/features/account-insights/accounts-timeframe'
import { BalanceGrowthChart } from '@/features/account-insights/balance-growth-chart'
import type { BalancePoint } from '@/features/account-insights/balance-growth'
import { CashflowChart } from '@/features/account-insights/cashflow-chart'
import { CategorySpendingList } from '@/features/account-insights/category-spending-list'
import type { CashflowRow, CategoryRow } from '@/features/account-insights/insights-view-model'
import { MetricsStats, type MetricsSectionState } from '@/features/account-insights/metrics-stats'
import type { TransactionViewModel } from '@/features/transactions/transactions-view-model'

import { aggregateFreshness } from './account-freshness'
import { freshnessStatus } from './balances-provenance'
import type { AccountSummaryViewModel } from './accounts-view-model'
import { FailureState, LoadingState, SectionMessage } from './screen-states'

export type SectionState<T> = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; data: T }

/** Period-scoped figures, each loaded on its own so one failing never hides the accounts. */
export type AccountsInsights = Readonly<{
  timeframe: AccountsTimeframe
  metrics: MetricsSectionState
  categories: SectionState<readonly CategoryRow[]>
  /** Category spending left out for want of an exchange rate, when the API says so. */
  categoriesCompleteness?: AmountsCompleteness
  balance: SectionState<readonly BalancePoint[]>
  transactions: SectionState<readonly TransactionViewModel[]>
  cashflow: SectionState<readonly CashflowRow[]>
}>

export type AccountsData = {
  accounts: readonly AccountSummaryViewModel[]
  insights?: AccountsInsights
}

export type AccountsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: AccountsData; refreshing?: boolean }
  | { status: 'refresh-error'; data: AccountsData; refreshing?: boolean }

export type AccountsScreenProps = {
  state: AccountsViewState
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onSelectAccount: (accountId: number) => void
  /** Manual ("Unlinked") account. */
  onCreateAccount: () => void
  /** Bank connection ("Linked") account. Without it, "Add account" goes straight to manual. */
  onConnectBank?: () => void
  onCreateTransaction?: () => void
  onEditAccount?: (accountId: number) => void
  onViewTransactions: () => void
  onTimeframeChange?: (timeframe: AccountsTimeframe) => void
  /** Import a bank statement; listed behind the title row's overflow menu. */
  onImportTransactions?: () => void
}

const LAST_TRANSACTIONS = 8

/**
 * Web's Accounts overview (`app/[locale]/(full-layout)/accounts/accounts-client.tsx`)
 * at phone width: title + Help with one "+" (Add transaction / Add account) on
 * the same row, the period select,
 * Total balance with its change and provenance, Inflow / Outflow / Savings
 * rate, then Spending by category, Balance growth, Accounts (with total),
 * Last transactions and Cashflow, each under a ruled section head.
 */
export function AccountsScreen({
  state,
  onRefresh,
  onLogout,
  onSelectAccount,
  onCreateAccount,
  onConnectBank,
  onCreateTransaction,
  onEditAccount,
  onViewTransactions,
  onTimeframeChange,
  onImportTransactions,
}: AccountsScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const selectAccount = useCallback((accountId: number) => onSelectAccount(accountId), [onSelectAccount])
  const [periodOpen, setPeriodOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [menuAccount, setMenuAccount] = useState<AccountSummaryViewModel | null>(null)
  // The spinner belongs to the gesture: background refetches (an invalidation,
  // a period change) must not pin it, and on iOS a RefreshControl mounted with
  // `refreshing` already true sticks and pushes the title down.
  const [pulling, setPulling] = useState(false)
  const pullToRefresh = useCallback(async () => {
    setPulling(true)
    try {
      await onRefresh()
    } finally {
      setPulling(false)
    }
  }, [onRefresh])

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState label={t('accounts.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <FailureState
        message={t(invalid ? 'accounts.invalidMessage' : 'accounts.errorMessage')}
        onLogout={onLogout}
        onRetry={onRefresh}
        title={t(invalid ? 'accounts.invalidTitle' : 'accounts.errorTitle')}
      />
    )
  }

  const { accounts, insights } = state.data
  const hasAccounts = accounts.length > 0
  const currency = accounts[0]?.primaryCurrencyCode ?? 'EUR'
  const timeframe = insights?.timeframe ?? 'YTD'
  // The floating "+" holds both add actions (account and transaction). With
  // no accounts, or no transaction route, it is Add account itself.
  const canAddTransaction = hasAccounts && Boolean(onCreateTransaction)
  const add = () => (canAddTransaction ? setAddOpen(true) : onCreateAccount())
  // Secondary actions sit behind the title row's overflow glyph.
  const moreActions = [
    ...(onConnectBank ? [{ value: 'linked' as const, label: t('accountsOverview.linkedAccount'), meta: t('accountsOverview.linkedDescription') }] : []),
    ...(onImportTransactions && hasAccounts ? [{ value: 'import' as const, label: t('accountsOverview.importTransactions') }] : []),
  ]

  const header = (
    <View style={styles.headerBlock}>
      <PageHeader
        action={moreActions.length > 0 ? (
          <IconButton accessibilityLabel={t('common.moreActions')} icon="more-vertical" onPress={() => setMoreOpen(true)} style={styles.overflow} testID="accounts-more" />
        ) : undefined}
        helpLabel={false}
        helpText={t('accountsOverview.help')}
        title={t('accountsOverview.title')}
      />
    </View>
  )

  // The one control: the period the change and the flow stats cover.
  const periodControl = hasAccounts && insights && onTimeframeChange ? (
    <View style={styles.controls}>
      <SelectTrigger
        accessibilityLabel={t('accountsOverview.period')}
        icon="calendar"
        onPress={() => setPeriodOpen(true)}
        size="sm"
        testID="accounts-period"
        value={t(`accountsOverview.timeframes.${timeframe}`)}
      />
    </View>
  ) : null

  const sheets = (
    <>
      {onTimeframeChange ? (
        <OptionSheet
          onClose={() => setPeriodOpen(false)}
          onSelect={onTimeframeChange}
          options={ACCOUNTS_TIMEFRAMES.map((value) => ({ value, label: t(`accountsOverview.timeframes.${value}`) }))}
          title={t('accountsOverview.period')}
          value={timeframe}
          visible={periodOpen}
        />
      ) : null}
      {canAddTransaction ? (
        <OptionSheet
          mode="menu"
          onClose={() => setAddOpen(false)}
          onSelect={(value) => {
            if (value === 'transaction') onCreateTransaction?.()
            else onCreateAccount()
          }}
          options={[
            { value: 'account' as const, label: t('accountsOverview.addAccount'), meta: t('accountsOverview.unlinkedDescription') },
            { value: 'transaction' as const, label: t('accountsOverview.addTransaction') },
          ]}
          title={t('accountsOverview.add')}
          visible={addOpen}
        />
      ) : null}
      {moreActions.length > 0 ? (
        <OptionSheet
          mode="menu"
          onClose={() => setMoreOpen(false)}
          onSelect={(value) => {
            if (value === 'linked') onConnectBank?.()
            else onImportTransactions?.()
          }}
          options={moreActions}
          title={t('common.moreActions')}
          visible={moreOpen}
        />
      ) : null}
      {onEditAccount ? (
        <OptionSheet
          mode="menu"
          onClose={() => setMenuAccount(null)}
          onSelect={(value) => {
            if (!menuAccount) return
            if (value === 'details') onSelectAccount(menuAccount.accountId)
            else onEditAccount(menuAccount.accountId)
          }}
          options={[
            { value: 'details', label: t('accountsOverview.accountDetails') },
            { value: 'edit', label: t('accountsOverview.edit') },
            { value: 'delete', label: t('accountsOverview.delete'), destructive: true },
          ]}
          title={menuAccount?.accountName ?? t('accounts.unnamed')}
          visible={menuAccount !== null}
        />
      ) : null}
    </>
  )

  const fab = (
    <FloatingActionButton
      aboveTabBar
      accessibilityLabel={canAddTransaction ? t('accountsOverview.add') : t('accountsOverview.addAccount')}
      onPress={add}
      testID="accounts-add"
    />
  )

  const stale = state.status === 'refresh-error'
    ? <Notice action={<Button label={t('common.retry')} onPress={onRefresh} size="sm" variant="outline" />} message={t('accounts.stale')} />
    : null

  if (!hasAccounts) {
    return (
      <View style={styles.safeArea}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
          <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl onRefresh={() => void pullToRefresh()} refreshing={pulling} tintColor={palette.primary} />}>
            <View style={styles.page}>
              {header}
              {stale}
              <EmptyState preview={<AccountPreview locale={locale} />} title={t('accounts.empty')} />
            </View>
          </ScrollView>
          {sheets}
        </SafeAreaView>
        {fab}
      </View>
    )
  }

  // A total with one balance missing is not a smaller total: it is unknown.
  const totalBalance = accounts.reduce<number | null>(
    (sum, account) => (sum === null || account.convertedBalance === null ? null : sum + account.convertedBalance),
    0,
  )
  const metrics = insights?.metrics
  const netChange = metrics?.status === 'loaded' && metrics.summary
    ? metrics.summary.inflowCurrent - metrics.summary.outflowCurrent
    : null

  const freshness = aggregateFreshness(accounts)

  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl onRefresh={() => void pullToRefresh()} refreshing={pulling} tintColor={palette.primary} />}>
        <View style={styles.page}>
          {header}
          {stale}

          <View style={styles.lead}>
            <HeadlineFigure
              currency={currency}
              deltas={totalBalance !== null && netChange !== null ? [{ value: netChange, label: t('accountsOverview.vsLastPeriod'), trend: true }] : []}
              footer={totalBalance === null ? <Text tone="muted" variant="label">{t('accountsOverview.totalIncomplete')}</Text> : undefined}
              label={t('accountsOverview.totalBalance')}
              labelIsHeader
              locale={locale}
              status={freshnessStatus(freshness, t)}
              testID="accounts-total-balance"
              value={totalBalance}
            />
            {periodControl}
            {metrics ? <MetricsStats currency={currency} locale={locale} state={metrics} testID="accounts-metrics" /> : null}
          </View>

          {insights ? (
            <Section title={t('accountsOverview.spendingByCategory')} variant="open">
              <SectionBody state={insights.categories} render={(rows) => <CategorySpendingList completeness={insights.categoriesCompleteness} currency={currency} locale={locale} rows={rows} />} />
            </Section>
          ) : null}

          {insights ? (
            <Section title={t('accountsOverview.balanceGrowth')} variant="open">
              <SectionBody state={insights.balance} render={(points) => <BalanceGrowthChart locale={locale} points={points} testID="accounts-balance-chart" />} />
            </Section>
          ) : null}

          <Section title={t('accountsOverview.accounts')} variant="open">
            <View>
              <List>
                {accounts.map((account, index) => (
                  <AccountRow
                    account={account}
                    key={account.accountId}
                    locale={locale}
                    onMore={onEditAccount ? setMenuAccount : undefined}
                    onSelect={selectAccount}
                    separated={index > 0}
                  />
                ))}
              </List>
              <View style={[styles.total, { borderTopColor: palette.border }]}>
                <Text tone="muted" variant="metaStrong">{t('accountsOverview.total')}</Text>
                {totalBalance === null
                  ? <Text tone="muted" variant="label">{t('accountsOverview.totalIncomplete')}</Text>
                  : <Text style={styles.totalFigure} variant="amount">{formatMoney(totalBalance, { locale, currency })}</Text>}
              </View>
            </View>
          </Section>

          {insights ? (
            <Section
              action={<Button label={t('accountsOverview.viewAll')} onPress={onViewTransactions} size="sm" variant="link" />}
              title={t('accountsOverview.lastTransactions')}
              variant="open"
            >
              <SectionBody
                render={(rows) => rows.length === 0 ? (
                  <View style={styles.emptyBlock}>
                    <Text style={styles.center} tone="muted" variant="meta">{t('accountsOverview.emptyTransactions')}</Text>
                    {onCreateTransaction ? <Button icon="plus" label={t('accountsOverview.addTransaction')} onPress={onCreateTransaction} /> : null}
                  </View>
                ) : (
                  <List>
                    {rows.slice(0, LAST_TRANSACTIONS).map((row, index) => <TransactionRow key={row.id} locale={locale} row={row} separated={index > 0} />)}
                  </List>
                )}
                state={insights.transactions}
              />
            </Section>
          ) : (
            <Button label={t('accounts.viewTransactions')} onPress={onViewTransactions} variant="link" />
          )}

          {insights ? (
            <Section title={t('accountsOverview.cashflow')} variant="open">
              <SectionBody state={insights.cashflow} render={(rows) => <CashflowChart locale={locale} rows={rows} testID="accounts-cashflow-chart" />} />
            </Section>
          ) : null}
        </View>
      </ScrollView>
      {sheets}
    </SafeAreaView>
    {fab}
    </View>
  )
}

function SectionBody<T>({ state, render }: { state: SectionState<T>; render: (data: T) => React.ReactNode }) {
  if (state.status === 'loading') return <SectionMessage loading />
  if (state.status === 'error') return <SectionMessage />
  return <>{render(state.data)}</>
}

/**
 * Web's `AccountsList` row: name (with a lock when private), shared-by,
 * institution and sync freshness muted beneath; the balance in the reader's
 * currency on the right with the account's own currency under it when they
 * differ, and the "…" menu. Memoized so a period change doesn't re-format
 * every row.
 */
const AccountRow = memo(function AccountRow({ account, separated, locale, onSelect, onMore }: {
  account: AccountSummaryViewModel
  separated: boolean
  locale: string
  onSelect: (accountId: number) => void
  onMore?: (account: AccountSummaryViewModel) => void
}) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const name = account.accountName ?? t('accounts.unnamed')
  const differs = account.originalCurrencyCode !== account.primaryCurrencyCode
  const synced = account.source === 'open_banking' ? formatRelativeTime(account.lastSyncedAt ?? account.refreshedAt, t) : null
  const updated = synced ? t('accounts.updated', { date: synced }) : null
  const shared = !account.isOwnedByViewer && account.ownerFirstName ? t('accountsOverview.sharedBy', { name: account.ownerFirstName }) : null
  const metaLine = [shared, account.institutionDisplayName, updated].filter(Boolean).join(' · ')
  const money = (value: number, currency: string) => formatMoney(value, { locale, currency })
  const fx = account.fx ?? { status: 'exact' as const }
  const fxCopy = describeFxState(fx, t, locale)
  // With no exchange rate there is no balance in the owner's currency: the row leads with the
  // account's own, once, marked "Not converted".
  const unconverted = fx.status === 'missing' && account.originalBalance !== null
  const primary = unconverted && account.originalBalance !== null
    ? money(account.originalBalance, account.originalCurrencyCode)
    : account.convertedBalance !== null ? money(account.convertedBalance, account.primaryCurrencyCode) : t('accounts.balanceUnavailable')
  const original = differs && !unconverted && account.originalBalance !== null ? money(account.originalBalance, account.originalCurrencyCode) : null
  const available = account.convertedAvailableBalance != null && account.convertedBalance !== null && account.convertedAvailableBalance !== account.convertedBalance
    ? money(account.convertedAvailableBalance, account.primaryCurrencyCode)
    : null
  const accessibilityLabel = [
    name,
    account.isPrivate ? t('accountsOverview.private') : null,
    shared,
    account.institutionDisplayName,
    primary,
    original,
    available ? `${t('accountsOverview.available')}: ${available}` : null,
    fxCopy ? `${fxCopy.label}. ${fxCopy.hint}` : null,
    updated,
  ].filter(Boolean).join(', ')

  return (
    <ListRow
      accessibilityLabel={accessibilityLabel}
      badge={account.isPrivate ? <Badge label={t('accountsOverview.private')} tone="outline" /> : undefined}
      figure={unconverted
        ? <Amount currency={account.originalCurrencyCode} locale={locale} value={account.originalBalance} />
        : <Amount currency={account.primaryCurrencyCode} locale={locale} value={account.convertedBalance} />}
      leading={<EntityMark {...accountMark({ logoUrl: account.institutionLogoUrl, institutionName: account.institutionDisplayName, type: account.accountType })} testID="account-mark" />}
      figureMeta={original || available ? (
        <View style={styles.figureMeta}>
          {original ? <Text align="right" tone="muted" variant="amountSmall">{original}</Text> : null}
          {available ? <Text align="right" tone="muted" variant="label">{`${t('accountsOverview.available')}: ${available}`}</Text> : null}
        </View>
      ) : null}
      meta={[metaLine || null]}
      moreAccessibilityLabel={t('accountsOverview.actionsFor', { name })}
      onMorePress={onMore ? () => onMore(account) : undefined}
      onPress={() => onSelect(account.accountId)}
      separated={separated}
      testID="account-row"
      title={name}
    >
      {fxCopy ? <FxStatusLabel locale={locale} state={fx} testID="account-fx-status" /> : null}
    </ListRow>
  )
})

/** Web's `TransactionsList` row: merchant or description, date · category · account, the amount. */
function TransactionRow({ row, locale, separated }: { row: TransactionViewModel; locale: string; separated: boolean }) {
  const { t } = useTranslation()
  const date = Number.isFinite(Date.parse(row.date))
    ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(row.date))
    : null
  const title = row.title ?? row.description ?? t('accounts.unnamed')
  // With no exchange rate the row shows its original amount, marked "Not converted".
  const value = row.fx.status === 'missing' ? row.fx.amount : row.amount
  const currency = row.fx.status === 'missing' ? row.fx.currency : row.currency
  return (
    <ListRow
      figure={<Amount currency={currency} locale={locale} value={value} />}
      leading={<EntityMark {...(row.mark ?? { glyph: 'tag' })} />}
      meta={[[date, row.category ? formatCategoryName(row.category) : null, row.accountName].filter(Boolean).join(' · ')]}
      separated={separated}
      title={title}
    >
      {row.fx.status === 'exact' ? null : <FxStatusLabel locale={locale} state={row.fx} testID="transaction-fx-status" />}
    </ListRow>
  )
}

/** Web's empty-state preview: the shape of the page with sample accounts, labelled as a preview. */
function AccountPreview({ locale }: { locale: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const rows = [
    { name: t('accounts.previewMain'), institution: t('accounts.previewBank'), balance: 3280.5 },
    { name: t('accounts.previewSavings'), institution: t('accounts.previewSavingsBank'), balance: 8150 },
    { name: t('accounts.previewCard'), institution: t('accounts.previewCardBank'), balance: -1000.5 },
  ]
  return (
    <View accessibilityLabel={t('accounts.preview')} style={[styles.preview, { borderColor: palette.border }]}>
      <View style={styles.previewHead}>
        <PreviewLabel />
        <Text tone="muted" variant="label">{t('accounts.previewBalance')}</Text>
        <Amount currency="EUR" locale={locale} size="stat" value={10430} />
      </View>
      <List divided>
        {rows.map((row) => (
          <ListRow figure={<Amount currency="EUR" locale={locale} value={row.balance} />} key={row.name} leading={<EntityMark {...accountMark({ institutionName: row.institution })} />} meta={[row.institution]} title={row.name} />
        ))}
      </List>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  headerBlock: { gap: themeTokens.spacing[3] },
  overflow: { marginRight: -11, marginVertical: -6 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  lead: { gap: themeTokens.spacing[6] },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], borderTopWidth: 1, paddingVertical: themeTokens.spacing[3] },
  totalFigure: { fontWeight: '600' },
  figureMeta: { alignItems: 'flex-end' },
  emptyBlock: { alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[6] },
  center: { textAlign: 'center' },
  preview: { borderWidth: 1, borderRadius: themeTokens.radius.lg, paddingHorizontal: themeTokens.spacing[4] },
  previewHead: { gap: themeTokens.spacing[1], paddingVertical: themeTokens.spacing[4] },
})
