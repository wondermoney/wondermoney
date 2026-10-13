import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { BudgetCategoryEditor } from './budget-category-editor'
import type { BudgetCategoryWrite } from './budgets-contract'
import type { BudgetCategoryChildViewModel, BudgetCategoryGroupViewModel, BudgetViewModel } from './budgets-view-model'
import { Action, BudgetFailure, BudgetHeader, BudgetLoading, StaleBanner } from './budgets-screen'
import { classifyBudgetCategoryDeleteFailure, type BudgetCategoryDeleteFailure, type BudgetCategoryRemovalScope } from './use-budget-category-delete-mutation'

export type BudgetMonthViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'not-found' }
  | { status: 'invalid-route' }
  | { status: 'access-transition' }
  | { status: 'loaded'; budget: BudgetViewModel; hasPrevious: boolean; hasNext: boolean; refreshing?: boolean }
  | { status: 'refresh-error'; budget: BudgetViewModel; hasPrevious: boolean; hasNext: boolean; refreshing?: boolean }

export type BudgetMonthScreenProps = {
  state: BudgetMonthViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onPrevious: () => void
  onNext: () => void
  onEdit?: () => void
  onAddCategory?: () => void
  categoryPending?: boolean
  onSaveCategory?: (categoryId: number, value: BudgetCategoryWrite) => Promise<void>
  onRemoveCategory?: (categoryId: number, scope: BudgetCategoryRemovalScope) => Promise<void>
  onManageAccounts?: () => void
  onViewYear?: () => void
}


export function BudgetMonthScreen({ state, onBack, onRetry, onPrevious, onNext, onEdit, onAddCategory, categoryPending = false, onSaveCategory, onRemoveCategory, onManageAccounts, onViewYear }: BudgetMonthScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  useEffect(() => {
    if (!categoryPending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [categoryPending])
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <BudgetLoading label={t('budgetMonth.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response' || state.status === 'not-found' || state.status === 'invalid-route') {
    const copyKey = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-route' ? 'invalidRoute' : 'error'
    return <BudgetFailure title={t(`budgetMonth.${copyKey}Title`)} message={t(`budgetMonth.${copyKey}Message`)} onRetry={state.status === 'invalid-route' ? undefined : onRetry} onBack={onBack} backLabel={t('budgetMonth.back')} palette={palette} />
  }
  const { budget } = state
  const money = (value: number) => formatCurrency(value, { locale, currency: budget.currencyCode })
  const period = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(budget.year, budget.month - 1, 15)))
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl enabled={!categoryPending} refreshing={Boolean(state.refreshing)} onRefresh={() => { if (!categoryPending) void onRetry() }} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BudgetHeader title={budget.name} provenance={period} backLabel={t('budgetMonth.back')} onBack={onBack} disabled={categoryPending} palette={palette} />
          <View style={styles.headerActions}>{onAddCategory ? <Button disabled={categoryPending} label={t('budgetMonth.addCategory')} onPress={onAddCategory} palette={palette} variant="primary" /> : null}{onEdit ? <Action label={t('budgetMonth.edit')} onPress={onEdit} disabled={categoryPending} palette={palette} /> : null}{onViewYear ? <Action label={t('budgetMonth.viewYear')} onPress={onViewYear} disabled={categoryPending} palette={palette} /> : null}</View>
          {state.status === 'refresh-error' ? <StaleBanner label={t('budgetMonth.stale')} palette={palette} /> : null}
          <View style={[styles.summary, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.summaryHero}>
              <Text allowFontScaling style={[styles.kicker, { color: palette.mutedForeground }]}>{t('budgets.remaining')}</Text>
              <Text allowFontScaling style={[styles.summaryAmount, { color: palette.foreground }]}>{money(budget.totals.remaining)}</Text>
              {budget.totals.overspent ? <Text allowFontScaling style={[styles.overspent, { color: palette.destructiveText }]}>{t('budgets.overspent')}</Text> : null}
            </View>
            <View style={styles.summaryMetrics}>
              <SummaryMetric label={t('budgets.planned')} value={money(budget.totals.planned)} palette={palette} />
              <SummaryMetric label={t('budgets.spent')} value={money(budget.totals.spent)} palette={palette} />
            </View>
          </View>
          <View style={styles.monthNav}>
            <Action label={t('budgetMonth.previous')} onPress={onPrevious} disabled={categoryPending || !state.hasPrevious} palette={palette} />
            <Text accessibilityLabel={t('budgetMonth.periodNavigation', { period })} allowFontScaling style={[styles.navPeriod, { color: palette.foreground }]}>{period}</Text>
            <Action label={t('budgetMonth.next')} onPress={onNext} disabled={categoryPending || !state.hasNext} palette={palette} />
          </View>
          <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetMonth.categories')}</Text>
            <Text allowFontScaling style={[styles.sectionHelper, { color: palette.mutedForeground }]}>{t('budgetMonth.categoriesHelper')}</Text>
          </View>
          {budget.categories.length === 0 ? <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}><Text accessibilityRole="header" allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t('budgetMonth.noCategoriesTitle')}</Text><Text allowFontScaling style={[styles.emptyText, { color: palette.mutedForeground }]}>{t('budgetMonth.noCategories')}</Text>{onAddCategory ? <Button disabled={categoryPending} label={t('budgetMonth.addCategory')} onPress={onAddCategory} palette={palette} variant="primary" /> : null}</View> : (
            <View style={styles.categories}>{budget.categories.map((category) => <CategoryGroup key={category.id} category={category} year={budget.year} month={budget.month} currency={budget.currencyCode} locale={locale} pending={categoryPending} onSaveCategory={onSaveCategory} onRemoveCategory={onRemoveCategory} palette={palette} />)}</View>
          )}
          <View style={[styles.accounts, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.accountsTitle, { color: palette.foreground }]}>{t('budgetMonth.accounts')}</Text>
            <Text allowFontScaling style={[styles.accountNames, { color: palette.foreground }]}>{budget.accounts.length > 0 ? budget.accounts.map((account) => account.name ?? t('budgetMonth.unnamedAccount')).join(', ') : t('budgetMonth.noAccounts')}</Text>
            <Text allowFontScaling style={[styles.accountNote, { color: palette.mutedForeground }]}>{onManageAccounts ? t('budgetMonth.accountsEditableNote') : t('budgetMonth.accountsNote')}</Text>
            {onManageAccounts ? <Action label={t('budgetMonth.manageAccounts')} onPress={onManageAccounts} disabled={categoryPending} palette={palette} /> : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function SummaryMetric({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.summaryMetric}><Text allowFontScaling style={[styles.kicker, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.metricAmount, { color: palette.foreground }]}>{value}</Text></View>
}

function CategoryGroup({ category, year, month, currency, locale, pending, onSaveCategory, onRemoveCategory, palette }: { category: BudgetCategoryGroupViewModel; year: number; month: number; currency: string; locale: string; pending: boolean; onSaveCategory?: (categoryId: number, value: BudgetCategoryWrite) => Promise<void>; onRemoveCategory?: (categoryId: number, scope: BudgetCategoryRemovalScope) => Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const money = (value: number) => formatCurrency(value, { locale, currency })
  const progress = (value: number | null) => value === null
    ? t('budgets.progressUnavailable')
    : t('budgets.progressValue', { value: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100) })
  const remainingColor = palette.foreground
  return (
    <View style={[styles.category, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded, disabled: pending }} disabled={pending} accessibilityLabel={t(expanded ? 'budgetMonth.hideCategory' : 'budgetMonth.showCategory', { name: category.name })} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.categoryButton, (pressed || pending) && styles.pressed]}>
        <View style={styles.categoryTitleGroup}><Text allowFontScaling style={[styles.categoryName, { color: palette.foreground }]}>{category.name}</Text><Text allowFontScaling style={[styles.categoryCount, { color: palette.mutedForeground }]}>{t('budgetMonth.categoryCount', { count: category.children.length })}</Text></View>
        <Text accessible={false} style={[styles.disclosure, { color: palette.primary }]}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      <View style={styles.categoryMetrics}>
        <CategoryMetric label={t('budgets.planned')} value={money(category.planned)} palette={palette} />
        <CategoryMetric label={t('budgets.spent')} value={money(category.spent)} palette={palette} />
        <CategoryMetric label={t('budgets.remaining')} value={money(category.remaining)} valueColor={remainingColor} palette={palette} />
      </View>
      {expanded ? <View style={[styles.children, { borderTopColor: palette.border }]}>{category.children.length === 0 ? <Text allowFontScaling style={[styles.noChildren, { color: palette.mutedForeground }]}>{t('budgetMonth.noSubcategories')}</Text> : category.children.map((child) => <ChildCategory key={child.id} child={child} year={year} month={month} currency={currency} locale={locale} progress={progress} editing={editingId === child.id} pending={pending} onEdit={onSaveCategory ? () => setEditingId(child.id) : undefined} onCancel={() => setEditingId(null)} onSave={onSaveCategory ? (value) => onSaveCategory(child.id, value) : undefined} onRemove={onRemoveCategory ? (scope) => onRemoveCategory(child.id, scope) : undefined} palette={palette} />)}</View> : null}
    </View>
  )
}

function ChildCategory({ child, year, month, currency, locale, progress, editing, pending, onEdit, onCancel, onSave, onRemove, palette }: { child: BudgetCategoryChildViewModel; year: number; month: number; currency: string; locale: string; progress: (value: number | null) => string; editing: boolean; pending: boolean; onEdit?: () => void; onCancel: () => void; onSave?: (value: BudgetCategoryWrite) => Promise<void>; onRemove?: (scope: BudgetCategoryRemovalScope) => Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState(false)
  const [removeFailure, setRemoveFailure] = useState<BudgetCategoryDeleteFailure | null>(null)
  const money = (value: number) => formatCurrency(value, { locale, currency })

  const confirmRemoval = () => new Promise<BudgetCategoryRemovalScope | null>((resolve) => {
    Alert.alert(
      t('budgetMonth.removeCategory.confirmTitle', { name: child.name }),
      t('budgetMonth.removeCategory.confirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
        { text: t('budgetMonth.removeCategory.thisMonth'), style: 'destructive', onPress: () => resolve('month') },
        { text: t('budgetMonth.removeCategory.forward'), style: 'destructive', onPress: () => resolve('forward') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })

  const removeCategory = async () => {
    if (!onRemove || pending || removing) return
    const scope = await confirmRemoval()
    if (!scope) return
    setRemoving(true)
    setRemoveFailure(null)
    try {
      await onRemove(scope)
    } catch (error) {
      setRemoveFailure(classifyBudgetCategoryDeleteFailure(error))
    } finally {
      setRemoving(false)
    }
  }

  return <View style={styles.child}>
    <View style={styles.childHeading}><Text allowFontScaling style={[styles.childName, { color: palette.foreground }]}>{child.name}</Text><Text allowFontScaling style={[styles.recurrence, { color: palette.mutedForeground }]}>{child.recurrence ? t(`budgetMonth.recurrence.${child.recurrence}`) : t('budgetMonth.recurrenceUnavailable')}</Text></View>
    <View style={styles.categoryMetrics}><CategoryMetric label={t('budgets.planned')} value={money(child.planned)} palette={palette} /><CategoryMetric label={t('budgets.spent')} value={money(child.spent)} palette={palette} /><CategoryMetric label={t('budgets.remaining')} value={money(child.remaining)} valueColor={palette.foreground} palette={palette} /></View>
    <View accessible accessibilityLabel={progress(child.progressPercentage)} style={styles.childProgress}><View style={[styles.progressTrack, { backgroundColor: palette.muted }]}><View testID={`budget-child-progress-${child.id}`} style={[styles.progressFill, { width: `${child.meterPercentage}%`, backgroundColor: child.overspent ? palette.destructiveText : palette.chart1 }]} /></View><Text allowFontScaling style={[styles.progressText, { color: child.overspent ? palette.destructiveText : palette.mutedForeground }]}>{progress(child.progressPercentage)}</Text></View>
    {removeFailure ? <Text accessibilityRole="alert" style={[styles.removeFailure, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetMonth.removeCategory.failures.${removeFailure}`)}</Text> : null}
    <View style={styles.childActions}>
      {onEdit && !editing ? <Action label={t('budgetCategory.edit', { name: child.name })} disabled={pending} onPress={onEdit} palette={palette} /> : null}
      {onRemove ? <Action label={removing ? t('budgetMonth.removeCategory.removing') : t('budgetMonth.removeCategory.action', { name: child.name })} disabled={pending || removing} onPress={removeCategory} palette={palette} /> : null}
    </View>
    {editing && onSave ? <BudgetCategoryEditor child={child} year={year} month={month} locale={locale} pending={pending} palette={palette} onSave={onSave} onCancel={onCancel} /> : null}
  </View>
}

function CategoryMetric({ label, value, palette, valueColor }: { label: string; value: string; palette: Palette; valueColor?: string }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.categoryMetric}><Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.categoryAmount, { color: valueColor ?? palette.foreground }]}>{value}</Text></View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap }, headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  summary: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[5] }, summaryHero: { gap: themeTokens.spacing[1] }, kicker: { ...textStyles.label, fontWeight: '600' as const }, summaryAmount: { ...textStyles.display }, overspent: { ...textStyles.meta, fontWeight: '600' as const }, summaryMetrics: { flexDirection: 'row', gap: themeTokens.spacing[6] }, summaryMetric: { flex: 1, gap: themeTokens.spacing[1] }, metricAmount: { ...textStyles.amount },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, navPeriod: { ...textStyles.bodyStrong, fontWeight: '600' as const, flex: 1, textAlign: 'center', textTransform: 'capitalize' }, sectionHeading: { gap: themeTokens.spacing[1] }, sectionTitle: { ...textStyles.section }, sectionHelper: { ...textStyles.body }, categories: { gap: themeTokens.spacing[3] },
  category: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' }, categoryButton: { minHeight: themeTokens.touchTarget.minimum, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, categoryTitleGroup: { flex: 1, gap: themeTokens.spacing[1] }, categoryName: { ...textStyles.section }, categoryCount: { ...textStyles.label }, disclosure: { ...textStyles.title, fontWeight: '400' as const }, categoryMetrics: { flexDirection: 'row', paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, categoryMetric: { flex: 1, gap: themeTokens.spacing[1] }, metricLabel: { ...textStyles.label }, categoryAmount: { ...textStyles.amountSmall }, children: { borderTopWidth: 1, padding: themeTokens.spacing[4], gap: themeTokens.spacing[5] }, child: { gap: themeTokens.spacing[3] }, childHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[2] }, childName: { ...textStyles.action, flexShrink: 1 }, recurrence: { ...textStyles.label }, noChildren: { ...textStyles.body }, childProgress: { gap: themeTokens.spacing[2], paddingHorizontal: themeTokens.spacing[4] }, progressTrack: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' }, progressFill: { height: '100%', borderRadius: themeTokens.radius.pill }, progressText: { ...textStyles.label },
  accounts: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, accountsTitle: { ...textStyles.section }, accountNames: { ...textStyles.body }, accountNote: { ...textStyles.label }, empty: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, emptyTitle: { ...textStyles.section }, emptyText: { ...textStyles.body }, pressed: { opacity: 0.68 },
  childActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, removeFailure: { ...textStyles.meta, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
})
