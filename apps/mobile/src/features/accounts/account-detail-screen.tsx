import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { accountMark, EntityMark, type EntityMarkSource } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { describeFxState, FxStatusLabel } from '@/components/ui/fx-status-label'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { ObjectHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatTransactionDate } from '@/lib/dates/transaction-date'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import type { BalancePoint } from '@/features/account-insights/balance-growth'
import { BalanceGrowthChart } from '@/features/account-insights/balance-growth-chart'
import { MetricsStats, type MetricsSectionState } from '@/features/account-insights/metrics-stats'
import type { RecentTransactionsSectionState } from '@/features/transactions/recent-transactions-section'
import type { RecentTransactionRow } from '@/features/transactions/recent-transactions-view-model'
import { InstallmentPlansSection, type InstallmentPlansSectionState } from '@/features/installments/installment-plans-section'

import { accountFreshness } from './account-freshness'
import type { AccountDetailViewModel } from './account-detail-view-model'
import { CreditCardStatementSection, type CreditCardStatementState } from './credit-card-statement-section'
import { ForecastCard, type AccountForecastState } from './forecast-card'
import type { AccountRecalculationState } from './use-account-recalculation'
import type { SectionState } from './accounts-screen'
import { freshnessStatus } from './balances-provenance'
import { FailureState, LoadingState, SectionMessage } from './screen-states'

export type AccountDetailData = AccountDetailViewModel & {
  /** Inflow / outflow / savings for the API's default period, as web's account page shows. */
  metrics?: MetricsSectionState
  balance?: SectionState<readonly BalancePoint[]>
  /** The projected low point and the recurring payments still to come. */
  forecast?: AccountForecastState
  /** The current credit-card statement, when the account is a card. */
  creditCardStatement?: CreditCardStatementState
  /** The card's installment plans, their remaining commitment and detected suggestions. */
  installmentPlans?: InstallmentPlansSectionState
}
export type AccountDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: AccountDetailData }
  | { status: 'refresh-error'; data: AccountDetailData }

export type AccountDetailScreenProps = {
  state: AccountDetailViewState
  recentTransactions: RecentTransactionsSectionState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onRetryRecent: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onViewTransactions: () => void
  onCreateTransaction?: () => void
  onImportTransactions?: () => void
  onEdit: () => void
  /** "Recalculate balances" in the overflow menu, after a confirmation; its progress and result show below the header. */
  onRecalculate?: () => void
  recalculation?: AccountRecalculationState
  onDismissRecalculation?: () => void
  /** Installment plans on a card: open one, add one, or accept a detected suggestion. */
  onOpenInstallmentPlan?: (planId: number) => void
  onCreateInstallmentPlan?: () => void
  onAcceptInstallmentSuggestion?: (suggestionKey: string) => void
}

const LAST_TRANSACTIONS = 5

/**
 * Web's account page (`accounts/[accountId]/account-client.tsx`) at phone
 * width, in the calm structure: "← Accounts", the account's mark and name
 * with its institution beneath and one overflow glyph (edit, import), the
 * Account balance figure with its freshness as the status line, Inflow /
 * Outflow / Savings rate, then Balance growth and Last transactions as open
 * sections. Adding a transaction is the floating "+".
 */
export function AccountDetailScreen({ state, recentTransactions, onBack, onRetry, onRetryRecent, onLogout, onViewTransactions, onCreateTransaction, onImportTransactions, onEdit, onRecalculate, recalculation, onDismissRecalculation, onOpenInstallmentPlan, onCreateInstallmentPlan, onAcceptInstallmentSuggestion }: AccountDetailScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const back = <BackControl fallback="/accounts" onPress={onBack} />
  const [moreOpen, setMoreOpen] = useState(false)

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState header={<View style={styles.back}>{back}</View>} label={t('accountDetail.loading')} />
  if (state.status === 'error' || state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'invalid-response') {
    const key = state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    const retryable = state.status === 'error' || state.status === 'invalid-response'
    return (
      <FailureState
        header={<View style={styles.back}>{back}</View>}
        message={t(`accountDetail.${key}.message`)}
        onLogout={onLogout}
        onRetry={retryable ? onRetry : undefined}
        title={t(`accountDetail.${key}.title`)}
      />
    )
  }

  const data = state.data
  const name = data.accountName ?? t('accounts.unnamed')
  const fx = data.fx ?? { status: 'exact' as const }
  const fxCopy = describeFxState(fx, t, locale)
  // With no exchange rate there is no balance in the owner's currency: lead with the account's own.
  const multiCurrency = data.originalCurrencyCode !== data.primaryCurrencyCode && fx.status !== 'missing'
  // Web leads with the balance in the reader's currency when the account is in another one.
  const primaryValue = multiCurrency ? data.convertedBalance : data.originalBalance
  const primaryCurrency = multiCurrency ? data.primaryCurrencyCode : data.originalCurrencyCode
  const primaryText = primaryValue === null
    ? t('accounts.balanceUnavailable')
    : formatMoney(primaryValue, { locale, currency: primaryCurrency })
  const mark = accountMark({ logoUrl: data.institutionLogoUrl, institutionName: data.institutionDisplayName, type: data.accountType })
  const shared = !data.isOwnedByViewer && data.ownerFirstName ? t('accountsOverview.sharedBy', { name: data.ownerFirstName }) : null

  const moreActions = [
    { value: 'edit' as const, label: t('accountDetail.edit') },
    ...(onImportTransactions ? [{ value: 'import' as const, label: t('accountsOverview.importTransactions') }] : []),
    ...(onRecalculate ? [{ value: 'recalculate' as const, label: t('accountRecalculate.action') }] : []),
  ]

  const confirmRecalculate = () => {
    if (!onRecalculate || recalculation?.phase === 'running') return
    Alert.alert(t('accountRecalculate.confirmTitle'), t('accountRecalculate.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('accountRecalculate.confirm'), onPress: onRecalculate },
    ])
  }

  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, onCreateTransaction && styles.contentUnderButton]}>
        <View style={styles.page}>
          <View style={styles.headerBlock}>
            {back}
            <ObjectHeader
              action={moreActions.length > 1 ? (
                <IconButton accessibilityLabel={t('common.moreActions')} icon="more-vertical" onPress={() => setMoreOpen(true)} style={styles.overflow} />
              ) : (
                <IconButton accessibilityLabel={t('accountDetail.edit')} icon="pencil" onPress={onEdit} style={styles.overflow} />
              )}
              badge={data.isPrivate || shared ? (
                <View style={styles.badges}>
                  {data.isPrivate ? <Badge label={t('accountsOverview.private')} tone="outline" /> : null}
                  {shared ? <Text tone="muted" variant="label">{shared}</Text> : null}
                </View>
              ) : undefined}
              descriptor={data.institutionDisplayName ?? undefined}
              leading={<EntityMark {...mark} testID="account-detail-mark" />}
              title={name}
            />
          </View>

          {recalculation && recalculation.phase !== 'idle' ? (
            <RecalculationNotice locale={locale} onDismiss={onDismissRecalculation} state={recalculation} />
          ) : null}

          {state.status === 'refresh-error' ? (
            <Notice action={<Button label={t('common.retry')} onPress={onRetry} size="sm" variant="outline" />} message={t('accountDetail.stale')} />
          ) : null}

          <View style={styles.lead}>
            <HeadlineFigure
              accessibilityLabel={[`${t('accountsOverview.accountBalance')}, ${primaryText}`, fxCopy ? `${fxCopy.label}. ${fxCopy.hint}` : null].filter(Boolean).join(', ')}
              currency={primaryCurrency}
              footer={primaryValue === null
                ? <Text tone="muted" variant="label">{t('accounts.balanceUnavailable')}</Text>
                : fxCopy ? <FxStatusLabel locale={locale} state={fx} testID="account-balance-fx-status" /> : undefined}
              label={t('accountsOverview.accountBalance')}
              locale={locale}
              secondary={multiCurrency ? { value: data.originalBalance, currency: data.originalCurrencyCode } : null}
              size="md"
              status={data.source === 'open_banking' ? freshnessStatus(accountFreshness(data), t) : undefined}
              testID="account-balance"
              value={primaryValue}
            />
            {data.metrics ? <MetricsStats currency={data.primaryCurrencyCode} locale={locale} state={data.metrics} testID="account-metrics" /> : null}
          </View>

          {data.creditCardStatement ? (
            <CreditCardStatementSection accountId={data.accountId} currency={data.originalCurrencyCode} locale={locale} state={data.creditCardStatement} />
          ) : null}

          {data.installmentPlans && onOpenInstallmentPlan && onCreateInstallmentPlan && onAcceptInstallmentSuggestion ? (
            <InstallmentPlansSection
              locale={locale}
              onAcceptSuggestion={onAcceptInstallmentSuggestion}
              onCreatePlan={onCreateInstallmentPlan}
              onOpenPlan={onOpenInstallmentPlan}
              state={data.installmentPlans}
            />
          ) : null}

          {data.balance ? (
            <Section title={t('accountsOverview.balanceGrowth')} variant="open">
              {data.balance.status === 'loaded'
                ? <BalanceGrowthChart locale={locale} points={data.balance.data} testID="account-balance-chart" />
                : <SectionMessage loading={data.balance.status === 'loading'} />}
            </Section>
          ) : null}

          {data.forecast ? (
            <Section title={t('accountForecast.title')} variant="open">
              <ForecastCard days={30} locale={locale} state={data.forecast} />
            </Section>
          ) : null}

          <Section
            action={<Button label={t('accountsOverview.viewAll')} onPress={onViewTransactions} size="sm" variant="link" />}
            title={t('accountsOverview.lastTransactions')}
            variant="open"
          >
            <RecentRows accountMark={mark} locale={locale} onCreateTransaction={onCreateTransaction} onRetry={onRetryRecent} state={recentTransactions} />
          </Section>
        </View>
      </ScrollView>
      <OptionSheet
        mode="menu"
        onClose={() => setMoreOpen(false)}
        onSelect={(value) => {
          if (value === 'edit') onEdit()
          else if (value === 'recalculate') confirmRecalculate()
          else onImportTransactions?.()
        }}
        options={moreActions}
        title={name}
        visible={moreOpen}
      />
    </SafeAreaView>
    {onCreateTransaction ? <FloatingActionButton accessibilityLabel={t('accountsOverview.addTransaction')} onPress={onCreateTransaction} testID="account-add-transaction" /> : null}
    </View>
  )
}

function RecalculationNotice({ state, locale, onDismiss }: { state: Exclude<AccountRecalculationState, { phase: 'idle' }>; locale: string; onDismiss?: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const dismiss = onDismiss ? <Button label={t('accountRecalculate.dismiss')} onPress={onDismiss} size="sm" variant="outline" /> : undefined
  if (state.phase === 'running') return <Notice message={t('accountRecalculate.running')} testID="account-recalculation" />
  if (state.phase === 'background') return <Notice action={dismiss} message={t('accountRecalculate.background')} testID="account-recalculation" />
  if (state.phase === 'error') return <Notice action={dismiss} message={t(`accountRecalculate.failures.${state.reason}`)} testID="account-recalculation" tone="destructive" />
  const { result } = state
  if (result.rowsChanged === 0) return <Notice action={dismiss} message={t('accountRecalculate.alreadyCorrect')} testID="account-recalculation" />
  const change = result.balanceBefore !== null && result.balanceAfter !== null
    ? t('accountRecalculate.balanceChange', {
        before: formatMoney(result.balanceBefore, { locale, currency: result.currency }),
        after: formatMoney(result.balanceAfter, { locale, currency: result.currency }),
      })
    : undefined
  return <Notice action={dismiss} message={change} testID="account-recalculation" title={t('accountRecalculate.done', { count: result.rowsChanged })} />
}

function RecentRows({ state, locale, onRetry, onCreateTransaction, accountMark: openingMark }: { state: RecentTransactionsSectionState; locale: string; onRetry: () => void | Promise<void>; onCreateTransaction?: () => void; accountMark: EntityMarkSource }) {
  const { t } = useTranslation()
  if (state.status === 'loading') return <SectionMessage loading />
  if (state.status === 'error' || state.status === 'invalid-response') {
    return (
      <Notice
        action={<Button label={t('common.retry')} onPress={onRetry} size="sm" variant="outline" />}
        message={t(state.status === 'invalid-response' ? 'recentTransactions.invalidResponse' : 'recentTransactions.error')}
      />
    )
  }
  if (state.rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.center} tone="muted" variant="meta">{t('accountsOverview.emptyTransactions')}</Text>
        {onCreateTransaction ? <Button icon="plus" label={t('accountsOverview.addTransaction')} onPress={onCreateTransaction} /> : null}
      </View>
    )
  }
  return (
    <View style={styles.rows}>
      {state.stale ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('recentTransactions.stale')}</Text> : null}
      <List>
        {state.rows.slice(0, LAST_TRANSACTIONS).map((row, index) => <RecentRow accountMark={openingMark} index={index} key={index} locale={locale} row={row} />)}
      </List>
    </View>
  )
}

function RecentRow({ row, locale, index, accountMark: openingMark }: { row: RecentTransactionRow; locale: string; index: number; accountMark: EntityMarkSource }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const title = row.kind === 'synthetic-initial-balance'
    ? t('recentTransactions.initialBalance')
    : row.displayName ?? t('recentTransactions.unavailableName')
  const date = row.occurredAt && Number.isFinite(Date.parse(row.occurredAt))
    ? formatTransactionDate(row.occurredAt, locale)
    : t('recentTransactions.unavailableDate')
  const amount = row.amount === null || row.currencyCode === null
    ? t('recentTransactions.unavailableAmount')
    : formatMoney(row.amount, { locale, currency: row.currencyCode })
  return (
    <ListRow
      accessibilityLabel={[title, date, amount].join(', ')}
      figure={<Amount currency={row.currencyCode} locale={locale} value={row.currencyCode === null ? null : row.amount} />}
      // The opening balance is the account itself, so it wears the account's mark.
      leading={<EntityMark {...(row.kind === 'synthetic-initial-balance' ? openingMark : row.mark ?? { glyph: 'tag' })} />}
      meta={[date]}
      separated={index > 0}
      title={title}
    />
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  back: { alignItems: 'flex-start' },
  headerBlock: { gap: themeTokens.spacing[4] },
  badges: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  overflow: { marginRight: -11, marginVertical: -6 },
  lead: { gap: themeTokens.spacing[6] },
  rows: { gap: themeTokens.spacing[2] },
  empty: { alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[6] },
  center: { textAlign: 'center' },
})
