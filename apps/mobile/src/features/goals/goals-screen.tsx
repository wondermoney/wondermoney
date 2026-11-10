import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Divider, Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatCell, StatColumns } from '@/components/ui/stat'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { GoalListItemViewModel } from './goals-view-model'

export type GoalsData = { goals: readonly GoalListItemViewModel[] }
export type GoalsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: GoalsData; refreshing?: boolean }
  | { status: 'refresh-error'; data: GoalsData; refreshing?: boolean }

export type GoalsScreenProps = {
  state: GoalsViewState
  view: 'active' | 'archived'
  onSelectView: (view: 'active' | 'archived') => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onViewGoal: (goalId: number) => void
  onCreateGoal: () => void
  onViewDebtStrategy: () => void
  createBlocked: boolean
  onRestoreGoal: (goalId: number) => void
  restorePending: (goalId: number) => boolean
}

/**
 * Web's Goals page (`app/[locale]/(full-layout)/goals/goals-client.tsx`) at phone width, in the
 * calm structure: the title and its description; the Active | Archived tabs (the one control);
 * then Target / Active / Funded as a stat list, the goals as flat rows led by their mark, and the
 * debt payoff strategy as an open section. Creating a goal is the floating "+".
 */
export function GoalsScreen({ state, view, onSelectView, onRefresh, onLogout, onViewGoal, onCreateGoal, onViewDebtStrategy, createBlocked, onRestoreGoal, restorePending }: GoalsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState label={t('goals.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <FailureState
        title={t(invalid ? 'goals.invalidTitle' : 'goals.errorTitle')}
        message={t(invalid ? 'goals.invalidMessage' : 'goals.errorMessage')}
        onRefresh={onRefresh}
        onLogout={onLogout}
      />
    )
  }

  const goals = state.data.goals
  // While the active list is empty the empty state's own button is the one add, not the same
  // label twice on one screen (web drops its header button there too).
  const showCreate = !(view === 'active' && goals.length === 0)
  const debtGoals = goals.filter((goal) => goal.isDebt).length

  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, showCreate && styles.contentUnderButton]}
        refreshControl={(
          <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />
        )}
      >
        <View style={styles.page}>
          <PageHeader title={t('goals.title')} description={t('goals.subtitle')} />

          {createBlocked ? <Notice tone="destructive" title={t('goals.createUnknownTitle')} message={t('goals.createUnknownMessage')} /> : null}
          {state.status === 'refresh-error' ? <Notice title={t('goals.stale')} /> : null}

          <View style={styles.tabs}>
            <SegmentedControl
              accessibilityLabel={t('goals.title')}
              options={[{ value: 'active', label: t('goals.tabActive') }, { value: 'archived', label: t('goals.tabArchived') }]}
              value={view}
              onChange={onSelectView}
            />

            {view === 'active' ? (
              goals.length === 0 ? (
                <GoalsEmptyState createBlocked={createBlocked} locale={locale} onCreateGoal={onCreateGoal} />
              ) : (
                <View style={styles.activeContent}>
                  <GoalSummary goals={goals} locale={locale} />
                  <View>
                    {goals.map((goal, index) => (
                      <View key={goal.goalId}>
                        {index > 0 ? <Divider /> : null}
                        <GoalRow goal={goal} locale={locale} onView={() => onViewGoal(goal.goalId)} />
                      </View>
                    ))}
                  </View>
                  {debtGoals >= 2 ? (
                    <Section title={t('goals.debtStrategy.title')} variant="open">
                      <View style={styles.strategy}>
                        <Text tone="muted" variant="meta">{t('goals.debtStrategy.subtitle')}</Text>
                        <Button
                          accessibilityLabel={t('goals.debtStrategy.linkLabel')}
                          label={t('goals.debtStrategy.linkLabel')}
                          onPress={onViewDebtStrategy}
                          trailingIcon="chevron-right"
                          variant="outline"
                          style={styles.hug}
                        />
                      </View>
                    </Section>
                  ) : null}
                </View>
              )
            ) : goals.length === 0 ? (
              <Text style={styles.archivedEmpty} tone="muted" variant="meta">{t('goals.archivedEmpty')}</Text>
            ) : (
              <View style={styles.archivedList}>
                {goals.map((goal) => {
                  const pending = restorePending(goal.goalId)
                  return (
                    <View key={goal.goalId} style={styles.archivedItem}>
                      <View style={styles.dimmed} testID="goal-row-dimmed">
                        <GoalRow goal={goal} locale={locale} onView={() => onViewGoal(goal.goalId)} />
                      </View>
                      <Button
                        disabled={pending}
                        icon="refresh-cw"
                        label={pending ? t('goals.restoring') : t('goals.restore')}
                        onPress={() => onRestoreGoal(goal.goalId)}
                        size="sm"
                        variant="outline"
                        style={styles.hug}
                      />
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
    {showCreate ? <FloatingActionButton accessibilityLabel={t('goals.create')} disabled={createBlocked} onPress={onCreateGoal} testID="goals-create" /> : null}
    </View>
  )
}

/** Web `GoalSummaryCards`: Target, Active, Funded (of the target) — sums only in one currency. */
function GoalSummary({ goals, locale }: { goals: readonly GoalListItemViewModel[]; locale: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const currencies = [...new Set(goals.map((goal) => goal.currencyCode))]
  const currency = currencies.length === 1 ? currencies[0] : null
  const targetTotal = goals.reduce((sum, goal) => sum + goal.targetAmount, 0)
  const fundedTotal = goals.reduce((sum, goal) => sum + goal.fundedHistorically, 0)
  const activeCount = goals.filter((goal) => goal.lifecycleStatus === 'active' || goal.lifecycleStatus === 'paused').length
  const completedCount = goals.filter((goal) => goal.lifecycleStatus === 'completed').length
  // One headline (funded so far, of the target), then the counts as columns.
  // Sums only in one currency; mixed currencies fall back to counts.
  return (
    <View style={styles.summary} testID="goals-summary">
      {currency ? (
        <HeadlineFigure
          currency={currency}
          label={t('goals.status.funded')}
          locale={locale}
          status={{ label: t('goals.ofAmount', { amount: formatMoney(targetTotal, { locale, currency }) }) }}
          value={fundedTotal}
        />
      ) : null}
      <StatColumns>
        {currency ? (
          <StatCell key="target" currency={currency} label={t('goals.target')} locale={locale} value={targetTotal} />
        ) : (
          <StatCell key="count" label={t('goals.title')} locale={locale}>{String(goals.length)}</StatCell>
        )}
        <StatCell key="active" label={t('goals.tabActive')} locale={locale}>{String(activeCount)}</StatCell>
        {currency ? null : <StatCell key="funded" label={t('goals.status.funded')} locale={locale}>{String(completedCount)}</StatCell>}
      </StatColumns>
    </View>
  )
}

/** Web `GoalStatusBadge`: the goal's lifecycle status as a chip. */
export function goalStatusTone(status: GoalListItemViewModel['lifecycleStatus']): BadgeTone {
  if (status === 'completed') return 'success'
  if (status === 'paused' || status === 'archived') return 'muted'
  return 'outline'
}

export function goalStatusLabelKey(status: GoalListItemViewModel['lifecycleStatus']): string {
  return `goals.status.${status}`
}

function formatPercent(value: number | null, locale: string): string {
  if (value === null) return '—'
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)
}

export function formatGoalDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

/**
 * Web `GoalCard`: one goal as a ledger row — name and chips on the left, its figure on the
 * right ("Remaining" for a debt, "Available" otherwise), the progress bar, then the payoff date
 * or the target, and the percentage. The whole row opens the goal.
 */
function GoalRow({ goal, locale, onView }: { goal: GoalListItemViewModel; locale: string; onView: () => void }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const status = t(goalStatusLabelKey(goal.lifecycleStatus))
  const figure = goal.isDebt ? goal.debtBalance : goal.availableAmount
  const figureLabel = goal.isDebt ? t('goals.debtRemaining') : t('goals.available')
  const money = (value: number) => formatMoney(value, { locale, currency: goal.currencyCode })
  const footnote = goal.isDebt
    ? goal.payoff?.paysOff && goal.payoff.payoffDate
      ? t('goals.payoffBy', { date: formatGoalDate(goal.payoff.payoffDate, locale) })
      : goal.payoff && !goal.payoff.paysOff
        ? t('goals.payoffTooLow')
        : t('goals.payoffTimeline')
    : t('goals.ofAmount', { amount: money(goal.targetAmount) })
  const percent = formatPercent(goal.displayProgress, locale)
  const accessibilityLabel = [
    goal.name,
    goal.isDebt ? t('goals.typeDebt') : null,
    status,
    `${figureLabel}, ${figure === null ? '—' : money(figure)}`,
    footnote,
    `${t('goalDetail.progress')} ${percent}`,
  ].filter(Boolean).join(', ')

  return (
    <Pressable
      accessibilityHint={t('goals.viewGoal')}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onView}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.muted }]}
      testID="goal-row"
    >
      <View style={styles.rowTop}>
        <EntityMark glyph={goal.isDebt ? 'hand-coins' : 'target'} />
        <View style={styles.rowIdentity}>
          <Text numberOfLines={1} variant="bodyStrong">{goal.name}</Text>
          <View style={styles.chips}>
            {goal.isDebt ? <Badge label={t('goals.typeDebt')} tone="outline" /> : null}
            <Badge label={status} tone={goalStatusTone(goal.lifecycleStatus)} />
          </View>
        </View>
        <View style={styles.rowFigure}>
          <Amount currency={goal.currencyCode} locale={locale} size="amountLarge" value={figure} />
          <Text tone="muted" variant="label">{figureLabel}</Text>
        </View>
      </View>
      <View style={styles.rowProgress}>
        {goal.displayProgress !== null ? <ProgressBar track="border" testID={`goal-progress-fill-${goal.goalId}`} value={goal.displayProgress} /> : null}
        <View style={styles.rowFoot}>
          <Text style={styles.shrink} tone="muted" variant="meta">{footnote}</Text>
          <Text style={styles.mono} tone="muted" variant="amount">{percent}</Text>
        </View>
      </View>
    </Pressable>
  )
}

/** Web `GoalsEmptyState`: what a goal is, a preview of the list, and the one create button. */
function GoalsEmptyState({ createBlocked, locale, onCreateGoal }: { createBlocked: boolean; locale: string; onCreateGoal: () => void }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const money = (value: number) => formatMoney(value, { locale, currency: 'EUR' })
  const samples = [
    { name: t('goals.previewEmergency'), available: 2400, target: 6000, progress: 40 },
    { name: t('goals.previewVacation'), available: 850, target: 2000, progress: 43 },
    { name: t('goals.previewTaxes'), available: 1200, target: 3000, progress: 40 },
  ]
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCopy}>
        <Text accessibilityRole="header" variant="title">{t('goals.emptyTitle')}</Text>
        <Text tone="muted" variant="meta">{t('goals.empty')}</Text>
      </View>
      <Card>
        <View style={styles.preview}>
          <View style={styles.previewHead}>
            <Text variant="metaStrong">{t('goals.title')}</Text>
            <PreviewLabel />
          </View>
          {samples.map((goal) => (
            <View key={goal.name} style={styles.previewGoal}>
              <View style={styles.rowTop}>
                <View style={styles.rowIdentity}>
                  <Text variant="metaStrong">{goal.name}</Text>
                  <Text tone="muted" variant="label">{t('goals.available')} / {t('goals.target')}</Text>
                </View>
                <View style={styles.rowFigure}>
                  <Text variant="amount">{money(goal.available)}</Text>
                  <Text tone="muted" variant="amountSmall">{money(goal.target)}</Text>
                </View>
              </View>
              <ProgressBar track="border" value={goal.progress} />
              <Text tone="muted" variant="amountSmall">{formatPercent(goal.progress, locale)}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Button disabled={createBlocked} icon="plus" label={t('goals.create')} onPress={onCreateGoal} style={styles.hug} />
    </View>
  )
}

function LoadingState({ label }: { label: string }) {
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loading}>
        <View style={[styles.skeleton, styles.skeletonTitle, { backgroundColor: palette.muted }]} />
        {[0, 1, 2].map((key) => <View key={key} style={[styles.skeleton, { backgroundColor: palette.muted }]} />)}
      </View>
    </SafeAreaView>
  )
}

function FailureState({ title, message, onRefresh, onLogout }: { title: string; message: string; onRefresh: GoalsScreenProps['onRefresh']; onLogout: GoalsScreenProps['onLogout'] }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card density="standalone">
          <View style={styles.failure}>
            <Text accessibilityRole="header" variant="section">{title}</Text>
            <Text tone="muted" variant="meta">{message}</Text>
            <View style={styles.failureActions}>
              <Button label={t('common.retry')} onPress={onRefresh} />
              <Button label={t('common.signOut')} onPress={onLogout} variant="secondary" />
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  hug: { alignSelf: 'flex-start' },
  tabs: { gap: themeTokens.spacing[4] },
  activeContent: { gap: themeTokens.spacing[10] },
  row: { paddingVertical: themeTokens.spacing[4], gap: themeTokens.spacing[3], borderRadius: themeTokens.radius.md },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  rowIdentity: { flex: 1, minWidth: 0, gap: themeTokens.spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  rowFigure: { alignItems: 'flex-end', gap: 2 },
  rowProgress: { gap: themeTokens.spacing[2], paddingLeft: themeTokens.mark.md + themeTokens.spacing[3] },
  archivedEmpty: { paddingVertical: themeTokens.spacing[4] },
  summary: { gap: themeTokens.spacing[6] },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  shrink: { flexShrink: 1 },
  mono: { flexShrink: 0 },
  strategy: { gap: themeTokens.spacing[3] },
  archivedList: { gap: themeTokens.spacing[4] },
  archivedItem: { gap: themeTokens.spacing[3] },
  dimmed: { opacity: 0.6 },
  empty: { gap: themeTokens.spacing[6] },
  emptyCopy: { gap: themeTokens.spacing[2] },
  preview: { gap: themeTokens.spacing[4] },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  previewGoal: { gap: themeTokens.spacing[2] },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  skeleton: { height: 72, borderRadius: themeTokens.radius.lg },
  skeletonTitle: { width: 160, height: 32 },
  failure: { gap: themeTokens.spacing[3] },
  failureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
