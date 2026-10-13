import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BudgetViewModel } from './budgets-view-model'

export type BudgetsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; budgets: readonly BudgetViewModel[]; refreshing?: boolean }
  | { status: 'refresh-error'; budgets: readonly BudgetViewModel[]; refreshing?: boolean }

export type BudgetsScreenProps = {
  state: BudgetsViewState
  onOpenBudget: (budgetId: number, year: number, month: number) => void
  onEditBudget?: (budgetId: number) => void
  onRefresh: () => void | Promise<void>
  onBack: () => void
  onCreateBudget?: () => void
}


export function BudgetsScreen({ state, onOpenBudget, onEditBudget, onRefresh, onBack, onCreateBudget }: BudgetsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <BudgetLoading label={t('budgets.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    return (
      <BudgetFailure
        title={t(state.status === 'invalid-response' ? 'budgets.invalidTitle' : 'budgets.errorTitle')}
        message={t(state.status === 'invalid-response' ? 'budgets.invalidMessage' : 'budgets.errorMessage')}
        onRetry={onRefresh}
        onBack={onBack}
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
          <BudgetHeader title={t('budgets.title')} palette={palette} />
          {onCreateBudget && state.budgets.length > 0 ? <Button label={t('budgets.create')} onPress={onCreateBudget} palette={palette} variant="primary" /> : null}
          {state.status === 'refresh-error' ? <StaleBanner label={t('budgets.stale')} palette={palette} /> : null}
          {state.budgets.length === 0 ? (
            <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t('budgets.emptyTitle')}</Text>
               <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{t('budgets.emptyMessage')}</Text>
               <BudgetPreview locale={locale} palette={palette} />
               {onCreateBudget ? <Button label={t('budgets.create')} onPress={onCreateBudget} palette={palette} variant="primary" /> : null}
             </View>
           ) : (
            <View style={styles.list}>
              {state.budgets.map((budget) => (
                <View key={budget.id} style={styles.cardGroup}>
                  <BudgetCard budget={budget} locale={locale} onPress={() => onOpenBudget(budget.id, budget.year, budget.month)} palette={palette} />
                  {onEditBudget ? <Action label={t('budgets.edit')} onPress={() => onEditBudget(budget.id)} palette={palette} /> : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function BudgetPreview({ locale, palette }: { locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const money = (value: number) => formatCurrency(value, { locale, currency: 'EUR' })
  const categories = [
    { name: t('budgets.previewHousing'), spent: 1200, planned: 1500 },
    { name: t('budgets.previewFood'), spent: 320, planned: 400 },
    { name: t('budgets.previewTransport'), spent: 85, planned: 150 },
  ]
  return <View style={[styles.budgetPreview, { borderColor: palette.border, backgroundColor: palette.background }]}>
    <View style={styles.previewHeading}><Text style={[styles.metricLabel, { color: palette.mutedForeground }]}>{t('budgets.preview')}</Text><PreviewLabel /></View>
    {categories.map((category) => { const progress = Math.min(category.spent / category.planned * 100, 100); return <View key={category.name} style={styles.previewCategory}><View style={styles.previewCategoryTop}><Text style={[styles.cardName, { color: palette.foreground }]}>{category.name}</Text><Text style={[styles.previewValue, { color: palette.foreground }]}>{money(category.spent)} <Text style={[styles.period, { color: palette.mutedForeground }]}>/ {money(category.planned)}</Text></Text></View><View style={[styles.track, { backgroundColor: palette.muted }]}><View style={[styles.fill, { width: `${progress}%`, backgroundColor: palette.chart1 }]} /></View></View> })}
  </View>
}

function BudgetCard({ budget, locale, onPress, palette }: { budget: BudgetViewModel; locale: string; onPress: () => void; palette: Palette }) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const money = (value: number) => formatCurrency(value, { locale, currency: budget.currencyCode })
  const period = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(budget.year, budget.month - 1, 15)))
  const progress = budget.totals.progressPercentage === null
    ? t('budgets.progressUnavailable')
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(budget.totals.progressPercentage / 100)
  const remaining = money(budget.totals.remaining)
  const label = [
    budget.name,
    period,
    `${t('budgets.planned')}, ${money(budget.totals.planned)}, ${budget.currencyCode}`,
    `${t('budgets.spent')}, ${money(budget.totals.spent)}, ${budget.currencyCode}`,
    `${t('budgets.remaining')}, ${remaining}, ${budget.currencyCode}`,
    t('budgets.progressValue', { value: progress }),
    budget.totals.overspent ? t('budgets.overspent') : null,
  ].filter(Boolean).join(', ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { borderColor: palette.border, backgroundColor: palette.card }, focused && { borderWidth: 2, borderColor: palette.foreground }, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardHeading}>
          <Text allowFontScaling style={[styles.cardName, { color: palette.foreground }]}>{budget.name}</Text>
          <Text allowFontScaling style={[styles.period, { color: palette.mutedForeground }]}>{period}</Text>
        </View>
        <Text accessible={false} style={[styles.arrow, { color: palette.primary }]}>›</Text>
      </View>
      <View style={styles.heroMetric}>
        <Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{t('budgets.remaining')}</Text>
        <Text allowFontScaling style={[styles.heroAmount, { color: palette.foreground }]}>{remaining}</Text>
        {budget.totals.overspent ? <Text allowFontScaling style={[styles.cue, { color: palette.destructiveText }]}>{t('budgets.overspent')}</Text> : null}
      </View>
      <View style={[styles.track, { backgroundColor: palette.muted }]}>
        <View testID={`budget-progress-${budget.id}`} style={[styles.fill, { width: `${budget.totals.meterPercentage}%`, backgroundColor: budget.totals.overspent ? palette.destructiveText : palette.chart1 }]} />
      </View>
      <Text allowFontScaling style={[styles.progress, { color: palette.mutedForeground }]}>{t('budgets.progressValue', { value: progress })}</Text>
      <View style={styles.metrics}>
        <SmallMetric label={t('budgets.planned')} value={money(budget.totals.planned)} palette={palette} />
        <SmallMetric label={t('budgets.spent')} value={money(budget.totals.spent)} palette={palette} />
      </View>
      {/* Web's Budgets screen shows categories directly, with their own
          progress bars, instead of only the aggregate above — this list used
          to stop at the aggregate and put categories behind the detail
          screen. Same data (budget.categories), same shape as web now; see
          DESIGN_HISTORY.md's Known Cross-Platform Gaps. */}
      {budget.categories.length > 0 ? (
        <View style={[styles.categoryList, { borderTopColor: palette.border }]}>
          {budget.categories.map((category) => (
            <View key={category.id} style={styles.categoryRow}>
              <View style={styles.categoryRowTop}>
                <Text allowFontScaling style={[styles.categoryRowName, { color: palette.foreground }]}>{category.name}</Text>
                <Text allowFontScaling style={[styles.categoryRowValue, { color: palette.foreground }]}>
                  {money(category.spent)} <Text style={[styles.period, { color: palette.mutedForeground }]}>/ {money(category.planned)}</Text>
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: palette.muted }]}>
                <View style={[styles.fill, { width: `${category.meterPercentage}%`, backgroundColor: category.overspent ? palette.destructiveText : palette.chart1 }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
}

function SmallMetric({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.smallMetric}><Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.metricValue, { color: palette.foreground }]}>{value}</Text></View>
}

export function BudgetHeader({ title, provenance, backLabel, onBack, palette, disabled = false }: { title: string; provenance?: string; backLabel?: string; onBack?: () => void; palette: Palette; disabled?: boolean }) {
  return <View style={styles.header}>{onBack ? <BackControl fallback="/budgets" onPress={onBack} color={palette.primary} disabled={disabled} /> : null}<PageHeader provenance={provenance} title={title} /></View>
}

export function StaleBanner({ label, palette }: { label: string; palette: Palette }) {
  return <Text accessible accessibilityRole="alert" accessibilityLabel={label} allowFontScaling style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{label}</Text>
}

export function BudgetLoading({ label, palette }: { label: string; palette: Palette }) {
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>{[140, 90, 240].map((width, index) => <View key={index} style={[styles.skeleton, { width, maxWidth: '100%', backgroundColor: palette.muted }]} />)}</View></SafeAreaView>
}

export function BudgetFailure({ title, message, onRetry, onBack, backLabel, palette }: { title: string; message: string; onRetry?: () => void | Promise<void>; onBack: () => void; backLabel?: string; palette: Palette }) {
  const { t } = useTranslation()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.failure}><View style={[styles.failureMarker, { backgroundColor: palette.destructive }]} /><Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>{title}</Text><Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{message}</Text><View style={styles.failureActions}>{onRetry ? <Action label={t('common.retry')} onPress={onRetry} palette={palette} primary /> : null}<Action label={backLabel ?? t('budgets.back')} onPress={onBack} palette={palette} /></View></View></SafeAreaView>
}

export function Action({ label, onPress, palette, primary = false, disabled = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.action, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.actionText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { gap: themeTokens.spacing[4] }, back: { minHeight: themeTokens.touchTarget.minimum, alignSelf: 'flex-start', justifyContent: 'center' }, backText: { ...textStyles.action }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title, fontWeight: '700' as const }, helper: { ...textStyles.body },
  list: { gap: themeTokens.spacing[5] }, cardGroup: { gap: themeTokens.spacing[2] }, card: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[4] }, cardHeading: { flex: 1, gap: themeTokens.spacing[1] }, cardName: { ...textStyles.section }, period: { ...textStyles.body, textTransform: 'capitalize' }, arrow: { ...textStyles.title, fontWeight: '400' as const }, heroMetric: { gap: themeTokens.spacing[1] }, metricLabel: { ...textStyles.label, fontWeight: '600' as const }, heroAmount: { ...textStyles.display }, cue: { ...textStyles.meta, fontWeight: '600' as const }, track: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' }, fill: { height: '100%', borderRadius: themeTokens.radius.pill }, progress: { ...textStyles.meta }, metrics: { flexDirection: 'row', gap: themeTokens.spacing[6] }, smallMetric: { flex: 1, gap: themeTokens.spacing[1] }, metricValue: { ...textStyles.amount },
  categoryList: { borderTopWidth: 1, paddingTop: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, categoryRow: { gap: themeTokens.spacing[2] }, categoryRowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, categoryRowName: { ...textStyles.body }, categoryRowValue: { ...textStyles.amount },
   empty: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.layout.sectionGap }, emptyTitle: { ...textStyles.section }, body: { ...textStyles.body }, budgetPreview: { gap: themeTokens.layout.sectionGap }, previewHeading: { flexDirection: 'row', justifyContent: 'space-between' }, previewCategory: { gap: themeTokens.spacing[2] }, previewCategoryTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, previewValue: { ...textStyles.amount }, banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] }, skeleton: { height: 72, borderRadius: themeTokens.radius.lg }, failure: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] }, failureMarker: { width: 42, height: 3 }, failureTitle: { ...textStyles.title }, failureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, action: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: themeTokens.spacing[4] }, actionText: { ...textStyles.action }, pressed: { opacity: 0.68 },
})
