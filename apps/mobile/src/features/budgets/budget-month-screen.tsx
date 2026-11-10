import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { BudgetCategoryEditor } from './budget-category-editor'
import { BudgetDetailHeader, BudgetLine, BudgetOverviewTable, MeasureKey, MonthNavigator, type BudgetView } from './budget-parts'
import type { BudgetCategoryWrite, BudgetRecurrence, BudgetSuggestionDto } from './budgets-contract'
import { budgetMeasureScale, overPlanLineCount, type BudgetCategoryChildViewModel, type BudgetCategoryGroupViewModel, type BudgetTotals, type BudgetViewModel } from './budgets-view-model'
import { BudgetFailure, BudgetLoading, StaleBanner } from './budgets-screen'
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
  /** The budget's full-year totals, for web's Month / Year overview table. Omitted until loaded. */
  yearTotals?: Pick<BudgetTotals, 'planned' | 'spent'> | null
  /** Suggested amounts from the household's spending, by category key. */
  suggestions?: ReadonlyMap<number, BudgetSuggestionDto>
}


export function BudgetMonthScreen({ state, onBack, onRetry, onPrevious, onNext, onEdit, onAddCategory, categoryPending = false, onSaveCategory, onRemoveCategory, onManageAccounts, onViewYear, yearTotals, suggestions }: BudgetMonthScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
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
  const date = new Date(Date.UTC(budget.year, budget.month - 1, 15))
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(date)
  const period = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
  const scaleMax = budgetMeasureScale(budget.categories)
  const onChangeView = onViewYear ? (view: BudgetView) => { if (view === 'year') onViewYear() } : undefined
  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, onAddCategory && styles.contentUnderButton]} refreshControl={<RefreshControl enabled={!categoryPending} refreshing={Boolean(state.refreshing)} onRefresh={() => { if (!categoryPending) void onRetry() }} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BudgetDetailHeader
            accountCount={budget.accounts.length}
            disabled={categoryPending}
            figure={(
              <>
                {state.status === 'refresh-error' ? <StaleBanner label={t('budgetMonth.stale')} palette={palette} /> : null}
                <MonthLead monthName={monthName} totals={budget.totals} overPlanCount={overPlanLineCount(budget.categories)} currency={budget.currencyCode} locale={locale} />
              </>
            )}
            helpText={t('budgetMonth.help')}
            lead={<MonthNavigator period={period} onPrevious={onPrevious} onNext={onNext} previousDisabled={categoryPending || !state.hasPrevious} nextDisabled={categoryPending || !state.hasNext} />}
            name={budget.name}
            onBack={onBack}
            onChangeView={onChangeView}
            onEdit={onEdit}
            onManageAccounts={onManageAccounts}
            view="month"
          />
          <Section title={t('budgetMonth.categories')} variant="open">
            <View>
              {budget.categories.length === 0 ? (
                <View style={styles.empty}>
                  <Text accessibilityRole="header" variant="subheading">{t('budgetMonth.noCategoriesTitle')}</Text>
                  <Text tone="muted" variant="meta">{t('budgetMonth.noCategories')}</Text>
                </View>
              ) : budget.categories.map((category, index) => (
                <CategoryGroup key={category.id} separated={index > 0} category={category} year={budget.year} month={budget.month} currency={budget.currencyCode} locale={locale} scaleMax={scaleMax} pending={categoryPending} suggestions={suggestions} onSaveCategory={onSaveCategory} onRemoveCategory={onRemoveCategory} />
              ))}
              <View style={styles.key}><MeasureKey /></View>
            </View>
          </Section>
          <BudgetOverviewTable
            currency={budget.currencyCode}
            locale={locale}
            rows={[
              { name: t('budgetMonth.month'), spent: budget.totals.spent, budgeted: budget.totals.planned },
              ...(yearTotals ? [{ name: t('budgetMonth.year'), spent: yearTotals.spent, budgeted: yearTotals.planned }] : []),
            ]}
          />
          {/* Not on web's page: which accounts feed the figures. Kept, below the ledger. */}
          <Section title={t('budgetMonth.accounts')} variant="open">
            <View style={styles.accounts}>
              <Text variant="body">{budget.accounts.length > 0 ? budget.accounts.map((account) => account.name ?? t('budgetMonth.unnamedAccount')).join(', ') : t('budgetMonth.noAccounts')}</Text>
              <Text tone="muted" variant="meta">{onManageAccounts ? t('budgetMonth.accountsEditableNote') : t('budgetMonth.accountsNote')}</Text>
            </View>
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
    {onAddCategory ? <FloatingActionButton accessibilityLabel={t('budgetMonth.addCategory')} disabled={categoryPending} onPress={onAddCategory} testID="budget-add-category" /> : null}
    </View>
  )
}

/** What is left (or how far over) this month, then Spent / Planned / Over plan in one row. */
function MonthLead({ monthName, totals, overPlanCount, currency, locale }: { monthName: string; totals: BudgetTotals; overPlanCount: number; currency: string; locale: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const left = totals.planned - totals.spent
  const overspent = left < 0
  const money = (value: number) => formatMoney(value, { locale, currency })
  const label = overspent ? t('budgetMonth.overspentIn', { month: monthName }) : t('budgetMonth.leftIn', { month: monthName })
  return (
    <View style={styles.leadFigures}>
      <HeadlineFigure
        accessibilityLabel={`${label}, ${money(overspent ? -left : left)}`}
        currency={currency}
        label={label}
        labelIsHeader
        locale={locale}
        size="md"
        // Over plan says so in words beside a destructive dot, not by colour alone.
        status={overspent ? { label: t('budgets.overspent'), tone: 'destructive' } : undefined}
        value={overspent ? -left : left}
      />
      <View style={styles.leadStats}>
        <LeadStat label={t('budgetMonth.spent')} value={money(totals.spent)} />
        <LeadStat label={t('budgetMonth.planned')} value={money(totals.planned)} />
        <View accessible accessibilityLabel={`${t('budgetMonth.overPlan')}, ${overPlanCount} ${t('budgetMonth.overPlanUnit', { count: overPlanCount })}`} style={styles.leadStat}>
          <Text tone="muted" variant="meta">{t('budgetMonth.overPlan')}</Text>
          <View style={styles.overPlan}>
            <Text tone={overPlanCount > 0 ? 'destructive' : 'default'} variant="amountBase">{String(overPlanCount)}</Text>
            <Text tone={overPlanCount > 0 ? 'destructive' : 'muted'} variant="label">{t('budgetMonth.overPlanUnit', { count: overPlanCount })}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

function LeadStat({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.leadStat}>
      <Text tone="muted" variant="meta">{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} variant="amountBase">{value}</Text>
    </View>
  )
}

function CategoryGroup({ category, separated, year, month, currency, locale, scaleMax, pending, suggestions, onSaveCategory, onRemoveCategory }: { category: BudgetCategoryGroupViewModel; separated: boolean; year: number; month: number; currency: string; locale: string; scaleMax: number; pending: boolean; suggestions?: ReadonlyMap<number, BudgetSuggestionDto>; onSaveCategory?: (categoryId: number, value: BudgetCategoryWrite) => Promise<void>; onRemoveCategory?: (categoryId: number, scope: BudgetCategoryRemovalScope) => Promise<void> }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  return (
    <>
      <BudgetLine category={category} currency={currency} locale={locale} scaleMax={scaleMax} separated={separated} view="month" />
      {category.children.map((child) => <ChildCategory key={child.id} child={child} year={year} month={month} currency={currency} locale={locale} scaleMax={scaleMax} editing={editingId === child.id} pending={pending} suggestion={suggestions?.get(child.id)} onEdit={onSaveCategory ? () => setEditingId(child.id) : undefined} onCancel={() => setEditingId(null)} onSave={onSaveCategory ? (value) => onSaveCategory(child.id, value) : undefined} onRemove={onRemoveCategory ? (scope) => onRemoveCategory(child.id, scope) : undefined} />)}
    </>
  )
}

const OCCURRENCES: Readonly<Record<BudgetRecurrence, number>> = { MONTHLY_14: 14, MONTHLY: 12, QUARTERLY: 4, BI_ANNUALLY: 2, ANNUALLY: 1 }

/** A subcategory line, indented under its parent, with its recurrence and the "…" menu. */
function ChildCategory({ child, year, month, currency, locale, scaleMax, editing, pending, suggestion, onEdit, onCancel, onSave, onRemove }: { child: BudgetCategoryChildViewModel; year: number; month: number; currency: string; locale: string; scaleMax: number; editing: boolean; pending: boolean; suggestion?: BudgetSuggestionDto; onEdit?: () => void; onCancel: () => void; onSave?: (value: BudgetCategoryWrite) => Promise<void>; onRemove?: (scope: BudgetCategoryRemovalScope) => Promise<void> }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [removing, setRemoving] = useState(false)
  const [removeFailure, setRemoveFailure] = useState<BudgetCategoryDeleteFailure | null>(null)

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

  // Web's `BudgetCategoryActionsMenu` behind the row's "…": edit, then remove.
  const openActions = () => {
    if (pending || removing) return
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = []
    if (onEdit && !editing) buttons.push({ text: t('budgetCategory.edit', { name: child.name }), onPress: onEdit })
    if (onRemove) buttons.push({ text: t('budgetMonth.removeCategory.action', { name: child.name }), style: 'destructive', onPress: () => { void removeCategory() } })
    buttons.push({ text: t('common.cancel'), style: 'cancel' })
    Alert.alert(child.name, undefined, buttons, { cancelable: true })
  }
  const hasActions = Boolean((onEdit && !editing) || onRemove)
  const recurrence = child.recurrence ? t('budgetMonth.timesPerYear', { count: OCCURRENCES[child.recurrence] }) : t('budgetMonth.recurrenceUnavailable')

  return (
    <BudgetLine
      category={child}
      currency={currency}
      extraMeta={recurrence}
      indented
      locale={locale}
      measureTestID={`budget-child-progress-${child.id}`}
      scaleMax={scaleMax}
      separated
      trailing={hasActions ? (
        <Pressable
          accessibilityLabel={t('budgetMonth.categoryActions', { name: child.name })}
          accessibilityRole="button"
          accessibilityState={{ disabled: pending || removing, busy: removing }}
          disabled={pending || removing}
          hitSlop={6}
          onPress={openActions}
          style={({ pressed }) => [styles.more, pressed && { backgroundColor: palette.accent }, (pending || removing) && styles.disabled]}
        >
          <Icon color={palette.mutedForeground} name="more-horizontal" />
        </Pressable>
      ) : undefined}
      view="month"
    >
      {removing ? <Text tone="muted" variant="label">{t('budgetMonth.removeCategory.removing')}</Text> : null}
      {removeFailure ? <Text accessibilityRole="alert" style={[styles.removeFailure, { borderColor: palette.destructive }]} variant="meta">{t(`budgetMonth.removeCategory.failures.${removeFailure}`)}</Text> : null}
      {editing && onSave ? <BudgetCategoryEditor child={child} currency={currency} year={year} month={month} locale={locale} pending={pending} palette={palette} suggestion={suggestion} onSave={onSave} onCancel={onCancel} /> : null}
    </BudgetLine>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  leadFigures: { gap: themeTokens.spacing[4] },
  accounts: { gap: themeTokens.spacing[1] },
  leadStats: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  leadStat: { flex: 1, minWidth: 0 },
  overPlan: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[1] },
  key: { paddingTop: themeTokens.spacing[3] },
  empty: { gap: themeTokens.spacing[1], paddingVertical: themeTokens.spacing[6] },
  more: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: themeTokens.radius.md },
  disabled: { opacity: 0.5 },
  removeFailure: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
})
