import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import type { InsightPeriod } from '@/features/account-insights/insights-contract'
import type { CashflowRow, CategoryRow, MetricGroup } from '@/features/account-insights/insights-view-model'

import type { AccountSummaryViewModel } from './accounts-view-model'

export type AccountsData = {
  accounts: readonly AccountSummaryViewModel[]
  insights?: { period: InsightPeriod; metricGroups: readonly MetricGroup[]; categories: readonly CategoryRow[]; cashflow: readonly CashflowRow[] }
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
  onCreateAccount: () => void
  onViewTransactions: () => void
  onViewRecurring: () => void
  onInsightPeriodChange: (period: InsightPeriod) => void
}


export function AccountsScreen({
  state,
  onRefresh,
  onLogout,
  onSelectAccount,
  onCreateAccount,
  onViewTransactions,
  onViewRecurring,
  onInsightPeriodChange,
}: AccountsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // Stable across renders so AccountRow (React.memo) doesn't re-render every
  // row when unrelated state changes (e.g. switching the insights period).
  const selectAccount = useCallback((accountId: number) => onSelectAccount(accountId), [onSelectAccount])

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return <LoadingState label={t('accounts.loading')} palette={palette} />
  }

  if (state.status === 'error' || state.status === 'invalid-response') {
    return (
      <StateFailure
        invalid={state.status === 'invalid-response'}
        onRefresh={onRefresh}
        onLogout={onLogout}
        palette={palette}
      />
    )
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
          <PageHeader title={t('accounts.title')} />

          {state.data.accounts.length > 0 ? <>
            {/* Only "Add manual account" is bordered/filled — it's the one
                action on this screen that wants emphasis. "View transactions"
                and "Recurring bills" are borderless (ghost), or three
                independently-bordered elements stack directly against each
                other with no shared container (the No-Nesting rule in
                DESIGN.md). */}
            <View style={styles.primaryActions}>
              <Button label={t('accounts.addManual')} onPress={onCreateAccount} variant="primary" style={{ minHeight: 48 }} />
              <Button label={t('accounts.viewTransactions')} onPress={onViewTransactions} variant="ghost" />
            </View>
            <Button label={t('accounts.viewRecurring')} onPress={onViewRecurring} variant="ghost" block style={{ minHeight: 48 }} />
          </> : null}

          {state.data.insights ? <InsightsSection data={state.data.insights} locale={locale} palette={palette} onPeriodChange={onInsightPeriodChange} /> : null}

          {state.status === 'refresh-error' ? (
            <View style={[styles.banner, { backgroundColor: palette.muted, borderColor: palette.border }]}><Text
              accessible
              accessibilityRole="alert"
              accessibilityLabel={t('accounts.stale')}
              allowFontScaling
              style={[
                styles.banner,
                {
                  color: palette.foreground,
                  backgroundColor: palette.muted,
                  borderColor: palette.border,
                },
              ]}
            >
              {t('accounts.stale')}
            </Text><Button label={t('common.retry')} onPress={onRefresh} palette={palette} variant="secondary" /></View>
          ) : null}

          {state.data.accounts.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>
                {t('accounts.empty')}
              </Text>
              <AccountPreview locale={locale} palette={palette} />
              <Button label={t('accounts.addManual')} onPress={onCreateAccount} palette={palette} variant="primary" style={{ minHeight: 48 }} />
            </View>
          ) : (
            <View style={styles.listSection}>
              {/* Insights above shows period-scoped inflow/outflow; this list
                  shows current balance. Same accounts, different numbers — an
                  explicit heading here keeps the two from reading as one
                  section repeating itself (see DESIGN_HISTORY.md). */}
              {state.data.insights ? (
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>
                  {t('accounts.balances')}
                </Text>
              ) : null}
              <View style={[styles.list, { borderColor: palette.border }]}>
                {state.data.accounts.map((account, index) => (
                  <AccountRow
                    key={account.accountId}
                    account={account}
                    separated={index > 0}
                    locale={locale}
                    palette={palette}
                    onSelect={selectAccount}
                  />
                ))}
              </View>
            </View>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * RAD-193 — extracted and memoized so switching the insights period (which
 * re-renders AccountsScreen with a new `state.data.insights`, but the same
 * `state.data.accounts`) doesn't re-run every account row's currency/date
 * formatting.
 */
const AccountRow = memo(function AccountRow({ account, separated, locale, palette, onSelect }: {
  account: AccountSummaryViewModel
  separated: boolean
  locale: string
  palette: Palette
  onSelect: (accountId: number) => void
}) {
  const { t } = useTranslation()
  const money = (value: number, currency: string) => formatCurrency(value, { locale, currency })
  const name = account.accountName ?? t('accounts.unnamed')
  const source = t(`accounts.source.${account.source === 'manual' ? 'manual' : 'openBanking'}`)
  const original = account.originalBalance !== null
    ? money(account.originalBalance, account.originalCurrencyCode)
    : t('accounts.balanceUnavailable')
  const converted = account.convertedBalance !== null
    && account.originalCurrencyCode !== account.primaryCurrencyCode
    ? money(account.convertedBalance, account.primaryCurrencyCode)
    : null
  const validDate = account.refreshedAt
    && !Number.isNaN(Date.parse(account.refreshedAt))
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(account.refreshedAt))
    : null
  const updated = validDate ? t('accounts.updated', { date: validDate }) : null
  const accessibilityLabel = [
    name,
    account.institutionDisplayName,
    source,
    original,
    account.originalBalance !== null ? account.originalCurrencyCode : null,
    converted
      ? `${t('accounts.convertedBalance')}, ${converted}, ${account.primaryCurrencyCode}`
      : null,
    updated,
  ].filter(Boolean).join(', ')

  return (
    <Pressable
      testID="account-row"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onSelect(account.accountId)}
      style={({ pressed }) => [
        styles.row,
        separated && {
          borderTopWidth: 1,
          borderTopColor: palette.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowMain}>
        <Text
          allowFontScaling
          style={[styles.name, { color: palette.foreground }]}
        >
          {name}
        </Text>
        {account.institutionDisplayName ? (
          <Text
            allowFontScaling
            style={[styles.meta, { color: palette.mutedForeground }]}
          >
            {account.institutionDisplayName}
          </Text>
        ) : null}
        <Text
          allowFontScaling
          style={[styles.meta, { color: palette.mutedForeground }]}
        >
          {source}
        </Text>
        {updated ? (
          <Text
            allowFontScaling
            style={[styles.updated, { color: palette.mutedForeground }]}
          >
            {updated}
          </Text>
        ) : null}
      </View>
      <View style={styles.amounts}>
        <Text
          allowFontScaling
          style={[
            styles.amount,
            {
              color: account.originalBalance === null
                ? palette.mutedForeground
                : palette.foreground,
            },
          ]}
        >
          {original}
        </Text>
        {converted ? (
          <Text
            allowFontScaling
            style={[styles.converted, { color: palette.mutedForeground }]}
          >
            {t('accounts.convertedBalance')}: {converted} {account.primaryCurrencyCode}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
})

function InsightsSection({ data, locale, palette, onPeriodChange }: { data: NonNullable<AccountsData['insights']>; locale: string; palette: Palette; onPeriodChange: (period: InsightPeriod) => void }) {
  const { t } = useTranslation()
  const money = (value: number | null, currency: string | null) => {
    if (value === null) return t('insights.unavailable')
    if (!currency) return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} · ${t('insights.currencyUnavailable')}`
    return formatCurrency(value, { locale, currency })
  }
  // Three "nothing here for this period" messages stacked inside a card that is
  // itself empty is three ways of saying the same thing. Say it once.
  const empty = !data.metricGroups.length && !data.categories.length && !data.cashflow.length

  return <View accessible accessibilityLabel={t('insights.title')} style={styles.insights}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('insights.title')}</Text>
    <SegmentedControl
      accessibilityLabel={t('insights.period')}
      onChange={onPeriodChange}
      options={(['month', '30-days', '90-days'] as const).map((period) => ({ value: period, label: t(`insights.periods.${period}`) }))}
      scrollable
      value={data.period}
    />
    {empty ? (
      <Text style={[styles.meta, { color: palette.mutedForeground }]}>{t('insights.empty')}</Text>
    ) : (
      <>
        {data.metricGroups.length ? <>
          <Text style={[styles.insightHeading, { color: palette.foreground }]}>{t('insights.accounts')}</Text>
          {data.metricGroups.map((group, groupIndex) => <View key={group.currency ?? `unavailable-${groupIndex}`} style={styles.insightGroup}><Text style={[styles.currencyHeading, { color: palette.mutedForeground }]}>{group.currency ?? t('insights.currencyUnavailable')}</Text>{group.rows.map((row) => <View key={row.accountId} accessible accessibilityLabel={[row.accountName ?? t('accounts.unnamed'), money(row.inflow, row.currency), money(row.outflow, row.currency)].join(', ')} style={styles.insightRow}><View style={styles.rowMain}><Text style={[styles.name, { color: palette.foreground }]}>{row.accountName ?? t('accounts.unnamed')}</Text><Text style={[styles.meta, { color: palette.mutedForeground }]}>{row.transactionCount === null ? t('insights.transactionCountUnavailable') : t('insights.transactionCount', { count: row.transactionCount })}</Text></View><View style={styles.amounts}><Text style={[styles.converted, { color: palette.foreground }]}>{t('insights.inflow')} {money(row.inflow, row.currency)}</Text><Text style={[styles.converted, { color: palette.foreground }]}>{t('insights.outflow')} {money(row.outflow, row.currency)}</Text></View></View>)}</View>)}
        </> : null}
        {data.categories.length ? <>
          <Text style={[styles.insightHeading, { color: palette.foreground }]}>{t('insights.topCategories')}</Text>
          {data.categories.map((category) => <View key={category.id} style={styles.summaryLine}><Text style={[styles.meta, { color: palette.foreground }]}>{formatCategoryName(category.name)}</Text><Text style={[styles.converted, { color: palette.foreground }]}>{money(category.amount, category.currency)}</Text></View>)}
        </> : null}
        {data.cashflow.length ? <>
          <Text style={[styles.insightHeading, { color: palette.foreground }]}>{t('insights.cashflow')}</Text>
          {data.cashflow.map((item) => <View key={item.date} style={styles.summaryLine}><Text style={[styles.meta, { color: palette.mutedForeground }]}>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(item.date))}</Text><Text style={[styles.converted, { color: item.amount === 0 ? palette.mutedForeground : palette.foreground }]}>{money(item.amount, item.currency)}</Text></View>)}
        </> : null}
      </>
    )}
  </View>
}

function AccountPreview({ locale, palette }: { locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const money = (value: number) => formatCurrency(value, { locale, currency: 'EUR' })
  const accounts = [
    { name: t('accounts.previewMain'), institution: t('accounts.previewBank'), balance: 3280.5 },
    { name: t('accounts.previewSavings'), institution: t('accounts.previewSavingsBank'), balance: 8150 },
    { name: t('accounts.previewCard'), institution: t('accounts.previewCardBank'), balance: -1000.5 },
  ]
  return <View accessibilityLabel={t('accounts.preview')} style={[styles.preview, { borderColor: palette.border, backgroundColor: palette.background }]}>
    <View style={styles.previewLabelWrap}><PreviewLabel /></View>
    <View style={styles.previewHero}><Text style={[styles.previewHeroLabel, { color: palette.mutedForeground }]}>{t('accounts.previewBalance')}</Text><Text style={[styles.previewAmount, { color: palette.foreground }]}>{money(10430)}</Text></View>
    {accounts.map((account) => <View key={account.name} style={[styles.previewRow, { borderTopColor: palette.border }]}><View style={styles.rowMain}><Text style={[styles.name, { color: palette.foreground }]}>{account.name}</Text><Text style={[styles.meta, { color: palette.mutedForeground }]}>{account.institution}</Text></View><Text style={[styles.previewValue, { color: palette.foreground }]}>{money(account.balance)}</Text></View>)}
  </View>
}

function LoadingState({ label, palette }: { label: string; palette: Palette }) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        style={styles.loading}
      >
        {[220, 320, 320].map((width, index) => (
          <View
            key={index}
            style={[styles.skeleton, { width, backgroundColor: palette.muted }]}
          />
        ))}
      </View>
    </SafeAreaView>
  )
}

function Action({
  label,
  onPress,
  palette,
  primary = false,
  disabled = false,
}: {
  label: string
  onPress: () => void | Promise<void>
  palette: Palette
  primary?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: primary ? 'transparent' : palette.input,
          backgroundColor: primary ? palette.primary : 'transparent',
        },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.actionLabel,
          { color: primary ? palette.primaryForeground : palette.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function StateFailure({
  invalid,
  onRefresh,
  onLogout,
  palette,
}: {
  invalid: boolean
  onRefresh: AccountsScreenProps['onRefresh']
  onLogout: AccountsScreenProps['onLogout']
  palette: Palette
}) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.center}>
        <View style={styles.failure}>
          <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text
            accessibilityRole="header"
            allowFontScaling
            style={[styles.failureTitle, { color: palette.foreground }]}
          >
            {t(invalid ? 'accounts.invalidTitle' : 'accounts.errorTitle')}
          </Text>
          <Text
            allowFontScaling
            style={[styles.helper, { color: palette.mutedForeground }]}
          >
            {t(invalid ? 'accounts.invalidMessage' : 'accounts.errorMessage')}
          </Text>
          <View style={styles.actions}>
            <Action label={t('common.retry')} onPress={onRefresh} palette={palette} primary />
            <Action label={t('common.signOut')} onPress={onLogout} palette={palette} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: themeTokens.layout.screenPadding,
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: themeTokens.layout.blockGap,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[4],
  },
  primaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: themeTokens.spacing[3],
  },
  heading: {
    flex: 1,
    minWidth: 240,
    gap: themeTokens.spacing[2],
  },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  listSection: { gap: themeTokens.layout.sectionGap },
  list: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 88,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[4],
    padding: themeTokens.spacing[4],
  },
  rowMain: {
    flex: 1,
    minWidth: 180,
    gap: themeTokens.spacing[1],
  },
  name: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '500',
  },
  meta: { ...textStyles.meta },
  updated: {
    fontFamily: themeTokens.typography.roles.caption.fontFamily,
    fontSize: themeTokens.typography.roles.caption.fontSize,
    lineHeight: 17,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: themeTokens.spacing[1],
  },
  amount: {
    fontFamily: themeTokens.typography.roles.data.fontFamily,
    fontSize: themeTokens.typography.roles.data.fontSize,
    lineHeight: themeTokens.typography.roles.data.lineHeight,
  },
  converted: {
    fontFamily: themeTokens.typography.roles.data.fontFamily,
    fontSize: themeTokens.typography.roles.caption.fontSize,
    lineHeight: 17,
  },
  empty: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.layout.sectionGap,
  },
  emptyTitle: { ...textStyles.action },
  preview: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  previewLabelWrap: { paddingHorizontal: themeTokens.layout.cardPadding, paddingTop: themeTokens.layout.cardPadding },
  previewHero: { padding: themeTokens.spacing[3], gap: themeTokens.spacing[1] },
  previewHeroLabel: { ...textStyles.label },
  previewAmount: { ...textStyles.display },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3], padding: themeTokens.spacing[3], borderTopWidth: 1 },
  previewValue: { ...textStyles.amount },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  action: {
    minWidth: themeTokens.touchTarget.minimum,
    minHeight: themeTokens.touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
  },
  actionLabel: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '600',
  },
  pressed: { opacity: 0.72 },
  loading: {
    flex: 1,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    padding: themeTokens.layout.screenPadding,
    gap: themeTokens.spacing[5],
  },
  skeleton: {
    maxWidth: '100%',
    height: themeTokens.spacing[6],
    borderRadius: themeTokens.radius.sm,
  },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: themeTokens.layout.screenPadding,
  },
  failure: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: themeTokens.spacing[4],
  },
  errorMarker: {
    width: 36,
    height: 2,
  },
  failureTitle: { ...textStyles.title },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: themeTokens.spacing[3],
  },
  insights: { width: '100%', gap: themeTokens.layout.sectionGap },
  sectionTitle: { ...textStyles.section },
  insightPeriods: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  period: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  periodText: { ...textStyles.meta, fontWeight: '500' as const },
  insightHeading: { ...textStyles.action },
  currencyHeading: { ...textStyles.amountSmall },
  insightGroup: { gap: themeTokens.spacing[2] },
  insightRow: { minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
})
