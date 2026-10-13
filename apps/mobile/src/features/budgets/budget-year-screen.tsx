import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BudgetCategoryGroupViewModel, BudgetYearViewModel } from './budgets-view-model'
import { BudgetFailure, BudgetHeader, BudgetLoading, StaleBanner } from './budgets-screen'


export type BudgetYearViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-route' }
  | { status: 'loaded' | 'refresh-error'; year: BudgetYearViewModel; toDate: BudgetYearViewModel; refreshing?: boolean }

export type BudgetYearScreenProps = Readonly<{
  state: BudgetYearViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
}>

export function BudgetYearScreen({ state, onBack, onRetry }: BudgetYearScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <BudgetLoading label={t('budgetYear.loading')} palette={palette} />
  if (state.status !== 'loaded' && state.status !== 'refresh-error') {
    const copyKey = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-route' ? 'invalidRoute' : 'error'
    return <BudgetFailure title={t(`budgetYear.${copyKey}Title`)} message={t(`budgetYear.${copyKey}Message`)} onRetry={state.status === 'invalid-route' ? undefined : onRetry} onBack={onBack} backLabel={t('budgetYear.back')} palette={palette} />
  }
  const { year: full, toDate } = state
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: full.currencyCode })
  const savings = full.totalIncome - full.totals.planned
  const percent = (value: number | null) => value === null ? t('budgets.progressUnavailable') : t('budgets.progressValue', { value: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100) })

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BudgetHeader provenance={t('budgetYear.helper', { year: full.year })} title={full.name} backLabel={t('budgetYear.back')} onBack={onBack} palette={palette} />
          {state.status === 'refresh-error' ? <StaleBanner label={t('budgetYear.stale')} palette={palette} /> : null}

          <View style={styles.stats}>
            <Stat label={t('budgetYear.incomePlanned')} value={money(full.totalIncome)} palette={palette} />
            <Stat label={t('budgetYear.expensesPlanned')} value={money(full.totals.planned)} palette={palette} />
            <Stat label={t('budgetYear.yearlyResult')} value={money(savings)} valueColor={palette.foreground} palette={palette} />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetYear.comparison')}</Text>
            <ComparisonRow label={t('budgetYear.yearToDate')} planned={toDate.totals.planned} spent={toDate.totals.spent} money={money} percent={percent} palette={palette} />
            <ComparisonRow label={t('budgetYear.fullYear')} planned={full.totals.planned} spent={full.totals.spent} money={money} percent={percent} palette={palette} />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetYear.categories')}</Text>
            {full.categories.length === 0 ? <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('budgetYear.noCategories')}</Text> : (
              <View style={styles.categories}>{full.categories.map((category) => <CategoryRow key={category.id} category={category} money={money} palette={palette} />)}</View>
            )}
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ label, value, valueColor, palette }: { label: string; value: string; valueColor?: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.stat, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <Text allowFontScaling style={[styles.statLabel, { color: palette.mutedForeground }]}>{label}</Text>
    <Text allowFontScaling style={[styles.statValue, { color: valueColor ?? palette.foreground }]}>{value}</Text>
  </View>
}

function ComparisonRow({ label, planned, spent, money, percent, palette }: { label: string; planned: number; spent: number; money: (value: number) => string; percent: (value: number | null) => string; palette: Palette }) {
  const { t } = useTranslation()
  const remaining = planned - spent
  const progressPercentage = planned > 0 ? (spent / planned) * 100 : null
  return <View style={[styles.comparisonRow, { borderColor: palette.border }]}>
    <Text allowFontScaling style={[styles.comparisonLabel, { color: palette.foreground }]}>{label}</Text>
    <View style={styles.categoryMetrics}>
      <CategoryMetric label={t('budgets.planned')} value={money(planned)} palette={palette} />
      <CategoryMetric label={t('budgets.spent')} value={money(spent)} palette={palette} />
      <CategoryMetric label={t('budgets.remaining')} value={money(remaining)} valueColor={palette.foreground} palette={palette} />
    </View>
    <Text allowFontScaling style={[styles.progressText, { color: palette.mutedForeground }]}>{percent(progressPercentage)}</Text>
  </View>
}

function CategoryMetric({ label, value, palette, valueColor }: { label: string; value: string; palette: Palette; valueColor?: string }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.categoryMetric}>
    <Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text>
    <Text allowFontScaling style={[styles.categoryAmount, { color: valueColor ?? palette.foreground }]}>{value}</Text>
  </View>
}

function CategoryRow({ category, money, palette }: { category: BudgetCategoryGroupViewModel; money: (value: number) => string; palette: Palette }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const remainingColor = palette.foreground
  return <View style={[styles.category, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={t(expanded ? 'budgetMonth.hideCategory' : 'budgetMonth.showCategory', { name: category.name })} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.categoryButton, pressed && styles.pressed]}>
      <Text allowFontScaling style={[styles.categoryName, { color: palette.foreground }]}>{category.name}</Text>
      <Text accessible={false} style={[styles.disclosure, { color: palette.primary }]}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    <View style={styles.categoryMetrics}>
      <CategoryMetric label={t('budgets.planned')} value={money(category.planned)} palette={palette} />
      <CategoryMetric label={t('budgets.spent')} value={money(category.spent)} palette={palette} />
      <CategoryMetric label={t('budgets.remaining')} value={money(category.remaining)} valueColor={remainingColor} palette={palette} />
    </View>
    {expanded ? <View style={[styles.children, { borderTopColor: palette.border }]}>
      {category.children.map((child) => (
        <View key={child.id} style={styles.child}>
          <Text allowFontScaling style={[styles.childName, { color: palette.foreground }]}>{child.name}</Text>
          <View style={styles.categoryMetrics}>
            <CategoryMetric label={t('budgets.planned')} value={money(child.planned)} palette={palette} />
            <CategoryMetric label={t('budgets.spent')} value={money(child.spent)} palette={palette} />
            <CategoryMetric label={t('budgets.remaining')} value={money(child.remaining)} valueColor={palette.foreground} palette={palette} />
          </View>
        </View>
      ))}
    </View> : null}
  </View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  stat: { flexGrow: 1, minWidth: 160, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  statLabel: { ...textStyles.label },
  statValue: { ...textStyles.amount },
  section: { gap: themeTokens.spacing[3] },
  sectionTitle: { ...textStyles.section },
  comparisonRow: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  comparisonLabel: { ...textStyles.action },
  progressText: { ...textStyles.label },
  categories: { gap: themeTokens.spacing[3] },
  category: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  categoryButton: { minHeight: themeTokens.touchTarget.minimum, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  categoryName: { ...textStyles.section, flex: 1 },
  disclosure: { ...textStyles.title, fontWeight: '400' as const },
  categoryMetrics: { flexDirection: 'row', paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  categoryMetric: { flex: 1, gap: themeTokens.spacing[1] },
  metricLabel: { ...textStyles.label },
  categoryAmount: { ...textStyles.amountSmall },
  children: { borderTopWidth: 1, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] },
  child: { gap: themeTokens.spacing[2] },
  childName: { ...textStyles.action },
  empty: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5] },
  action: { minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionText: { ...textStyles.action },
  pressed: { opacity: 0.68 },
})
