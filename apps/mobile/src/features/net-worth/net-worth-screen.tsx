import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type NetWorthSource = {
  id: string
  label: string
  value: number
  currency: string
  kind: 'account' | 'portfolio' | 'loan' | 'liability'
}

export type NetWorthData = {
  primaryCurrency: string
  total: number
  accounts: number
  portfolio: number
  liabilities: number
  sources: NetWorthSource[]
  completeness: 'partial' | 'unknown'
  unsupportedLoanCount: number
  unsupportedPortfolioCount: number
}

export type NetWorthViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'loaded'; data: NetWorthData; refreshing?: boolean }
  | { status: 'refresh-error'; data: NetWorthData; refreshing?: boolean }

export type BudgetHealthCardData = Readonly<{
  planned: number
  spent: number
  remaining: number
  currencyCode: string
  meterPercentage: number
  overspent: boolean
}>

export type BudgetHealthState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: BudgetHealthCardData }

export type InsightCardData = Readonly<{
  name: string
  amount: number
  currency: string | null
}>

export type InsightState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: InsightCardData }

export type NetWorthScreenProps = {
  state: NetWorthViewState
  budgetHealth: BudgetHealthState
  insight: InsightState
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onViewHistory: () => void
}

export function NetWorthScreen({ state, budgetHealth, insight, onRefresh, onLogout, onViewHistory }: NetWorthScreenProps) {
  const { t, i18n } = useTranslation()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'loading') {
    return <LoadingState label={t('netWorth.loading')} palette={palette} />
  }

  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={styles.centeredContent}>
          <View style={styles.errorPanel}>
            <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
            <Text accessibilityRole="header" allowFontScaling style={[styles.stateTitle, { color: palette.foreground }]}>
              {invalid ? t('netWorth.invalidTitle') : t('netWorth.errorTitle')}
            </Text>
            <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>
              {invalid ? t('netWorth.invalidMessage') : t('netWorth.errorMessage')}
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

  const data = state.data
  const money = (value: number, currency?: string) =>
    formatCurrency(value, { locale, currency: currency ?? data.primaryCurrency })

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
          <PageHeader helpText={t('netWorth.helpText')} title={t('netWorth.title')} />

          {state.status === 'refresh-error' ? (
            <View style={[styles.banner, { backgroundColor: palette.muted, borderColor: palette.border }]}>
              <View accessible accessibilityLabel={t('netWorth.stale')} accessibilityRole="alert" style={styles.bannerCopy}><View style={[styles.bannerMarker, { backgroundColor: palette.destructive }]} /><Text allowFontScaling style={[styles.bannerText, { color: palette.foreground }]}>{t('netWorth.stale')}</Text></View>
              <Button label={t('common.retry')} onPress={onRefresh} palette={palette} variant="secondary" />
            </View>
          ) : null}

          <View
            accessible
            accessibilityLabel={`${t('netWorth.estimate')}, ${money(data.total)}, ${data.primaryCurrency}`}
            style={styles.totalBlock}
          >
            <Text allowFontScaling style={[styles.eyebrow, { color: palette.mutedForeground }]}>{t('netWorth.estimate')}</Text>
            <Text testID="net-worth-total" allowFontScaling style={[styles.total, { color: palette.foreground }]}>
              {money(data.total)}
            </Text>
          </View>

          {data.completeness === 'partial' ? (
            <Text allowFontScaling style={[styles.completeness, { color: palette.warningText }]}>
              {t('netWorth.completeness.partial')}
            </Text>
          ) : null}

          <View style={[styles.summaryGrid, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
            <Summary label={t('netWorth.accounts')} value={money(data.accounts)} currency={data.primaryCurrency} palette={palette} />
            <Summary label={t('netWorth.portfolio')} value={money(data.portfolio)} currency={data.primaryCurrency} palette={palette} separated />
            <Summary label={t('netWorth.liabilities')} value={money(data.liabilities)} currency={data.primaryCurrency} palette={palette} separated />
          </View>

          {data.unsupportedLoanCount > 0 ? (
            <Warning text={t('netWorth.unsupportedLoan', { count: data.unsupportedLoanCount })} palette={palette} />
          ) : null}
          {data.unsupportedPortfolioCount > 0 ? (
            <Warning text={t('netWorth.unsupportedPortfolio', { count: data.unsupportedPortfolioCount })} palette={palette} />
          ) : null}

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>
              {t('netWorth.sources')}
            </Text>
            <View style={[styles.sourceList, { borderTopColor: palette.border }]}>
              {data.sources.length === 0 ? (
                <Text allowFontScaling style={[styles.emptySources, { color: palette.mutedForeground }]}>
                  {t('netWorth.noSources')}
                </Text>
              ) : data.sources.map((source, index) => {
                const liability = source.kind === 'loan' || source.kind === 'liability'
                const formatted = money(source.value, source.currency)
                return (
                  <View
                    key={source.id}
                    accessible
                    accessibilityLabel={`${source.label}, ${formatted}, ${source.currency}${liability ? `, ${t('netWorth.liabilityCue')}` : ''}`}
                    style={[styles.sourceRow, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}
                  >
                    <View style={styles.sourceLabelGroup}>
                      <Text allowFontScaling style={[styles.sourceLabel, { color: palette.foreground }]}>{source.label}</Text>
                      {liability ? <Text allowFontScaling style={[styles.cue, { color: palette.mutedForeground }]}>{t('netWorth.liabilityCue')}</Text> : null}
                    </View>
                    <Text allowFontScaling style={[styles.sourceValue, { color: palette.foreground }]}>{formatted}</Text>
                  </View>
                )
              })}
            </View>
          </View>

          <BudgetHealthCard state={budgetHealth} locale={locale} palette={palette} t={t} />
          <InsightsCard state={insight} fallbackCurrency={data.primaryCurrency} locale={locale} palette={palette} t={t} />

          <View style={styles.actions}>
            <Button label={t('netWorth.viewTrend')} onPress={onViewHistory} palette={palette} variant="primary" style={{ minHeight: 48 }} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function BudgetHealthCard({ state, locale, palette, t }: {
  state: BudgetHealthState
  locale: string
  palette: Palette
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (state.status === 'hidden') return null

  if (state.status === 'loading') {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={t('netWorth.budgetHealth.loading')} style={[styles.section, styles.budgetHealthLoading, { backgroundColor: palette.muted }]} />
    )
  }

  if (state.status === 'error') {
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('netWorth.budgetHealth.title')}</Text>
        <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{t('netWorth.budgetHealth.error')}</Text>
      </View>
    )
  }

  const { data: budget } = state
  const money = (value: number) => formatCurrency(value, { locale, currency: budget.currencyCode })
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('netWorth.budgetHealth.title')}</Text>
      <Text allowFontScaling style={[styles.body, { color: palette.foreground }]}>
        {t('netWorth.budgetHealth.summary', { spent: money(budget.spent), planned: money(budget.planned) })}
      </Text>
      <View style={[styles.meterTrack, { backgroundColor: palette.muted }]}>
        <View style={[styles.meterFill, { width: `${budget.meterPercentage}%`, backgroundColor: budget.overspent ? palette.destructiveText : palette.chart1 }]} />
      </View>
      {budget.overspent ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.warning, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>
          {t('netWorth.budgetHealth.overspent')}
        </Text>
      ) : null}
    </View>
  )
}

function InsightsCard({ state, fallbackCurrency, locale, palette, t }: {
  state: InsightState
  fallbackCurrency: string
  locale: string
  palette: Palette
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (state.status === 'hidden') return null

  if (state.status === 'loading') {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={t('netWorth.insights.loading')} style={[styles.section, styles.budgetHealthLoading, { backgroundColor: palette.muted }]} />
    )
  }

  if (state.status === 'error') {
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('netWorth.insights.title')}</Text>
        <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{t('netWorth.insights.error')}</Text>
      </View>
    )
  }

  const { data: top } = state
  const amount = formatCurrency(top.amount, { locale, currency: top.currency ?? fallbackCurrency })
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('netWorth.insights.title')}</Text>
      <Text allowFontScaling style={[styles.body, { color: palette.foreground }]}>
        {t('netWorth.insights.topCategory', { name: formatCategoryName(top.name), amount })}
      </Text>
    </View>
  )
}


function LoadingState({ label, palette }: { label: string; palette: Palette }) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loadingContent}>
        {[168, 260, 220, 220].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}
      </View>
    </SafeAreaView>
  )
}

function Summary({ label, value, currency, palette, separated = false }: { label: string; value: string; currency: string; palette: Palette; separated?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}, ${currency}`}
      style={[styles.summary, separated && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: palette.border }]}
    >
      <Text allowFontScaling style={[styles.summaryLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.summaryValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  )
}

function Warning({ text, palette }: { text: string; palette: Palette }) {
  return <Text accessibilityRole="alert" allowFontScaling style={[styles.warning, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{text}</Text>
}

function Action({ label, onPress, palette, primary = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean }) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable accessibilityRole="button" onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={() => void onPress()} style={({ pressed }) => [styles.action, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, focused && { borderWidth: 2, borderColor: palette.foreground }, pressed && styles.pressed]}>
      <Text allowFontScaling style={[styles.actionLabel, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap },

  headerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  headingGroup: { flex: 1, minWidth: 240, gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body, maxWidth: 560 },
  totalBlock: { gap: 2 },
  eyebrow: { ...textStyles.meta, fontWeight: '500' as const },
  total: { ...textStyles.display },
  summaryGrid: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  summary: { minHeight: themeTokens.layout.rowMinHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] },
  summaryLabel: { ...textStyles.meta },
  summaryValue: { ...textStyles.amount },
  completeness: { ...textStyles.body },
  warning: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  section: { gap: themeTokens.spacing[3] },
  budgetHealthLoading: { height: 88, borderRadius: themeTokens.radius.lg },
  meterTrack: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: themeTokens.radius.pill },
  sectionTitle: { ...textStyles.section },
  sourceList: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  emptySources: { ...textStyles.body, padding: themeTokens.spacing[4] },
  sourceRow: { minHeight: themeTokens.layout.rowMinHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] },
  sourceLabelGroup: { flex: 1, gap: themeTokens.spacing[1] },
  sourceLabel: { ...textStyles.body },
  cue: { ...textStyles.label },
  sourceValue: { ...textStyles.amount, textAlign: 'right' },
  banner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, bannerCopy: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  bannerMarker: { width: 2, alignSelf: 'stretch', borderRadius: themeTokens.radius.pill },
  bannerText: { ...textStyles.body, flex: 1 },
  centeredContent: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  errorPanel: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: themeTokens.spacing[4] },
  errorMarker: { width: 36, height: 2, borderRadius: themeTokens.radius.pill },
  stateTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[2] },
  action: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
  loadingContent: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  skeleton: { height: 22, borderRadius: themeTokens.radius.sm },
})
