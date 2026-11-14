import { useTranslation } from 'react-i18next'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackControl } from '@/components/ui/back-control'
import { Card } from '@/components/ui/card'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { List, ListGroupHeading, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text as UiText } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

import type { HouseholdMembersModel, MemberFilter } from '@/features/household/member-attribution'
import { MemberFilterButton } from '@/features/household/member-filter-control'

import { formatPercent } from './budget-parts'
import { budgetedLineCount, groupBudgetsByVisibility, monthlyIncome, type BudgetViewModel } from './budgets-view-model'

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
  /**
   * Whose part of each budget: everyone, one member or Shared. It never changes which budgets are
   * listed. Omitted (a household of one), not shown; nor on an empty list, which it could not fill.
   */
  memberFilter?: Readonly<{ model: HouseholdMembersModel; value: MemberFilter; onChange: (value: MemberFilter) => void }>
}


export function BudgetsScreen({ state, onOpenBudget, onEditBudget, onRefresh, onBack, onCreateBudget, memberFilter }: BudgetsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
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

  const empty = state.budgets.length === 0
  // The empty state's own "Create your first budget" is the one add there.
  const showCreate = Boolean(onCreateBudget) && !empty
  return (
    <View style={styles.safeArea}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <ScrollView
          contentContainerStyle={[styles.content, showCreate && styles.contentUnderButton]}
          refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
        >
          {empty ? (
            <BudgetsEmpty locale={locale} onCreateBudget={onCreateBudget} stale={state.status === 'refresh-error'} />
          ) : (
            <View style={[styles.page, styles.listPage]}>
              <PageHeader title={t('budgets.overviewTitle')} />
              {memberFilter ? (
                <View style={styles.memberFilter}>
                  <MemberFilterButton model={memberFilter.model} onChange={memberFilter.onChange} value={memberFilter.value} />
                </View>
              ) : null}
              {state.status === 'refresh-error' ? <StaleBanner label={t('budgets.stale')} palette={palette} /> : null}
              <BudgetsList budgets={state.budgets} locale={locale} onEditBudget={onEditBudget} onOpenBudget={onOpenBudget} />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
      {showCreate && onCreateBudget ? <FloatingActionButton aboveTabBar accessibilityLabel={t('budgets.create')} onPress={onCreateBudget} testID="budgets-create" /> : null}
    </View>
  )
}

/**
 * The budgets as flat rows separated by hairlines, the same treatment as a budget's lines. With
 * both household and personal budgets, each kind is its own group under a heading, which then
 * labels the personal rows; otherwise each personal row carries its own badge.
 */
function BudgetsList({ budgets, locale, onOpenBudget, onEditBudget }: { budgets: readonly BudgetViewModel[]; locale: string; onOpenBudget: BudgetsScreenProps['onOpenBudget']; onEditBudget?: (budgetId: number) => void }) {
  const { t } = useTranslation()
  return (
    <View>
      {groupBudgetsByVisibility(budgets).map((group, groupIndex) => (
        <View key={group.visibility ?? 'all'}>
          {group.visibility ? <ListGroupHeading first={groupIndex === 0} title={t(group.visibility === 'personal' ? 'budgets.groupPersonal' : 'budgets.groupHousehold')} variant="heading" /> : null}
          <List>
            {group.budgets.map((budget, index) => (
              <BudgetRow key={budget.id} budget={budget} grouped={group.visibility !== null} locale={locale} separated={index > 0} onPress={() => onOpenBudget(budget.id, budget.year, budget.month)} onEdit={onEditBudget ? () => onEditBudget(budget.id) : undefined} />
            ))}
          </List>
        </View>
      ))}
    </View>
  )
}

function BudgetRow({ budget, grouped, locale, separated, onPress, onEdit }: { budget: BudgetViewModel; grouped: boolean; locale: string; separated: boolean; onPress: () => void; onEdit?: () => void }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const money = (value: number) => formatMoney(value, { locale, currency: budget.currencyCode })
  const facts = [
    budget.incomes.length > 0 ? t('budgets.rowIncomeSummary', { amount: money(monthlyIncome(budget.incomes)), sources: budget.incomes.map((income) => income.name).join(', ') }) : null,
    t('budgets.rowCategoryCount', { count: budgetedLineCount(budget.categories) }),
    budget.accounts.length === 1 ? budget.accounts[0]!.name : budget.accounts.length > 1 ? t('budgets.rowAccountCount', { count: budget.accounts.length }) : null,
  ].filter((fact): fact is string => Boolean(fact))
  const { planned, spent, overspent, meterPercentage } = budget.totals
  const progressText = planned <= 0 ? t('budgets.nothingBudgeted') : spent === 0 ? t('budgets.nothingSpent') : formatPercent(spent / planned, locale)
  const personal = budget.visibility === 'personal'
  const label = [
    budget.name,
    personal ? t('budgets.personal') : null,
    ...facts,
    `${t('budgets.planned')}, ${money(planned)}`,
    `${t('budgets.spent')}, ${money(spent)}`,
    `${t('budgets.progress')}, ${progressText}`,
    overspent ? t('budgets.overspent') : null,
  ].filter(Boolean).join(', ')
  const hasProgress = planned > 0 && spent > 0
  return (
    <ListRow
      accessibilityLabel={label}
      badge={personal && !grouped ? <Badge label={t('budgets.personal')} testID={`budget-personal-${budget.id}`} tone="outline" /> : undefined}
      density="comfortable"
      figure={hasProgress ? <UiText tone={overspent ? 'destructive' : 'default'} variant="amount">{progressText}</UiText> : undefined}
      leading={<EntityMark glyph="wallet-cards" />}
      // Web's desktop-only row menu (Edit, Delete); the phone keeps Edit behind "…".
      moreAccessibilityLabel={t('budgets.actionsFor', { name: budget.name })}
      onMorePress={onEdit ? () => Alert.alert(budget.name, undefined, [{ text: t('budgets.edit'), onPress: onEdit }, { text: t('common.cancel'), style: 'cancel' }], { cancelable: true }) : undefined}
      onPress={onPress}
      separated={separated}
      title={budget.name}
    >
      <View style={styles.rowBody}>
        <ProgressBar color={overspent ? palette.destructive : palette.primary} height={6} testID={`budget-progress-${budget.id}`} value={hasProgress ? meterPercentage : 0} />
        {/* Facts set apart by space, not joined with middle dots (web's comment). */}
        <UiText numberOfLines={1} tone="muted" variant="meta">{hasProgress ? facts.join('   ') : [progressText, ...facts].join('   ')}</UiText>
      </View>
    </ListRow>
  )
}

/**
 * Web's `BudgetsEmptyState`: the envelope-method title and line, the one action, then a sample
 * of what a budget looks like, marked as a preview.
 */
function BudgetsEmpty({ locale, onCreateBudget, stale }: { locale: string; onCreateBudget?: () => void; stale: boolean }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const money = (value: number) => formatMoney(value, { locale, currency: 'EUR' })
  const categories = [
    { name: t('budgets.previewHousing'), icon: 'house', spent: 1200, planned: 1500, color: palette.chart1 },
    { name: t('budgets.previewFood'), icon: 'cooking-pot', spent: 320, planned: 400, color: palette.chart2 },
    { name: t('budgets.previewTransport'), icon: 'navigation', spent: 85, planned: 150, color: palette.chart3 },
  ]
  const totalSpent = categories.reduce((sum, category) => sum + category.spent, 0)
  const totalPlanned = categories.reduce((sum, category) => sum + category.planned, 0)
  return (
    <View style={styles.page}>
      <View style={styles.emptyHead}>
        <UiText accessibilityRole="header" variant="section">{t('budgets.emptyTitle')}</UiText>
        <UiText tone="muted" variant="meta">{t('budgets.emptyMessage')}</UiText>
      </View>
      {stale ? <StaleBanner label={t('budgets.stale')} palette={palette} /> : null}
      {onCreateBudget ? <View style={styles.emptyAction}><Button icon="plus" label={t('budgets.createFirst')} onPress={onCreateBudget} /></View> : null}
      <Card style={styles.previewCard}>
        <View style={[styles.previewHead, { borderBottomColor: palette.border }]}>
          <UiText variant="metaStrong">{t('budgets.title')}</UiText>
          <PreviewLabel />
        </View>
        <View style={styles.previewBody}>
          {categories.map((category) => (
            <View key={category.name} style={styles.previewRow}>
              <View style={styles.previewTop}>
                <View style={styles.previewName}>
                  <EntityMark icon={{ name: category.icon, bgColor: null, textColor: category.color }} />
                  <UiText variant="meta">{category.name}</UiText>
                </View>
                <UiText tone="muted" variant="amount">{money(category.spent)} <UiText tone="muted" variant="amountSmall">/ {money(category.planned)}</UiText></UiText>
              </View>
              <View style={[styles.previewTrack, { backgroundColor: palette.muted }]}>
                <View style={[styles.previewFill, { width: `${Math.min((category.spent / category.planned) * 100, 100)}%`, backgroundColor: category.color }]} />
              </View>
            </View>
          ))}
          <View style={[styles.previewTotal, { borderTopColor: palette.border }]}>
            <UiText variant="metaStrong">{t('budgets.total')}</UiText>
            <UiText style={styles.semibold} variant="amount">{money(totalSpent)} <UiText tone="muted" variant="amount">/ {money(totalPlanned)}</UiText></UiText>
          </View>
        </View>
      </Card>
    </View>
  )
}

/** Back on its own row, then the title; `action` is the screen's one primary action. */
export function BudgetHeader({ title, provenance, helpText, action, onBack, disabled = false }: { title: string; provenance?: string; helpText?: string; action?: React.ReactNode; backLabel?: string; onBack?: () => void; palette?: Palette; disabled?: boolean }) {
  return <View style={styles.header}>{onBack ? <BackControl fallback="/budgets" onPress={onBack} disabled={disabled} /> : null}<PageHeader action={action} helpText={helpText} provenance={provenance} title={title} /></View>
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
  safeArea: { flex: 1 },
  // The member filter sits under the title, at the start of the row, sized to its label.
  memberFilter: { flexDirection: 'row' },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[6] },
  listPage: { gap: themeTokens.spacing[4] },
  rowBody: { gap: 6, paddingTop: themeTokens.spacing[2] },
  emptyHead: { gap: 2 },
  emptyAction: { flexDirection: 'row' },
  previewCard: { padding: 0 },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: themeTokens.spacing[6], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  previewBody: { padding: themeTokens.spacing[6], gap: themeTokens.spacing[4] },
  previewRow: { gap: 6 },
  previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  previewName: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flexShrink: 1 },
  previewTrack: { height: 6, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  previewFill: { height: '100%', borderRadius: themeTokens.radius.pill },
  previewTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: themeTokens.spacing[3] },
  semibold: { fontWeight: '600' },
  header: { gap: themeTokens.spacing[4] },
  body: { ...textStyles.body },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { height: 72, borderRadius: themeTokens.radius.lg },
  failure: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  failureMarker: { width: 42, height: 3 },
  failureTitle: { ...textStyles.title },
  failureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  action: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: themeTokens.spacing[4] },
  actionText: { ...textStyles.action },
  pressed: { opacity: 0.68 },
})
