import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

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


export function GoalsScreen({ state, view, onSelectView, onRefresh, onLogout, onViewGoal, onCreateGoal, onViewDebtStrategy, createBlocked, onRestoreGoal, restorePending }: GoalsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState palette={palette} label={t('goals.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <FailureState
        title={t(invalid ? 'goals.invalidTitle' : 'goals.errorTitle')}
        message={t(invalid ? 'goals.invalidMessage' : 'goals.errorMessage')}
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
        refreshControl={(
          <RefreshControl
            refreshing={Boolean(state.refreshing)}
            onRefresh={() => void onRefresh()}
            tintColor={palette.primary}
          />
        )}
      >
        <View style={styles.page}>
          <PageHeader palette={palette}
            helpText={t('goals.helper')} title={t('goals.title')} />

          <View style={styles.primaryActions}>
            {state.data.goals.length > 0 || view === 'archived' ? <Button
              disabled={createBlocked}
              label={t('goals.create')}
              onPress={onCreateGoal}
              palette={palette}
              variant="primary"
            /> : null}
            {state.data.goals.length > 0 ? <Button
              label={t('goals.debtStrategy.linkLabel')}
              onPress={onViewDebtStrategy}
              palette={palette}
              variant="secondary"
            /> : null}
          </View>

          <View accessibilityRole="tablist" style={styles.tabs}>
            <Tab label={t('goals.tabActive')} selected={view === 'active'} onPress={() => onSelectView('active')} palette={palette} />
            <Tab label={t('goals.tabArchived')} selected={view === 'archived'} onPress={() => onSelectView('archived')} palette={palette} />
          </View>

          {createBlocked ? <View style={[styles.banner, { borderColor: palette.destructive, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.goalName, { color: palette.foreground }]}>{t('goals.createUnknownTitle')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('goals.createUnknownMessage')}</Text></View> : null}

          {state.status === 'refresh-error' ? (
            <Text
              accessible
              accessibilityRole="alert"
              accessibilityLabel={t('goals.stale')}
              allowFontScaling
              style={[
                styles.banner,
                {
                  color: palette.foreground,
                  borderColor: palette.border,
                  backgroundColor: palette.muted,
                },
              ]}
            >
              {t('goals.stale')}
            </Text>
          ) : null}

          {state.data.goals.length === 0 ? (
            <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t(view === 'archived' ? 'goals.archivedEmptyTitle' : 'goals.emptyTitle')}</Text>
              <Text allowFontScaling style={[styles.emptyMessage, { color: palette.mutedForeground }]}>{t(view === 'archived' ? 'goals.archivedEmpty' : 'goals.empty')}</Text>
              {view === 'active' ? <GoalPreview locale={locale} palette={palette} /> : null}
              {view === 'active' ? <Button disabled={createBlocked} label={t('goals.create')} onPress={onCreateGoal} palette={palette} variant="primary" /> : null}
            </View>
          ) : (
            <View style={styles.list}>
              {state.data.goals.map((goal) => (
                <GoalRow
                  key={goal.goalId}
                  goal={goal}
                  locale={locale}
                  palette={palette}
                  onView={() => onViewGoal(goal.goalId)}
                  archived={view === 'archived'}
                  onRestore={view === 'archived' ? () => onRestoreGoal(goal.goalId) : undefined}
                  restorePending={view === 'archived' && restorePending(goal.goalId)}
                />
              ))}
            </View>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function GoalPreview({ locale, palette }: { locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const money = (value: number) => formatCurrency(value, { locale, currency: 'EUR' })
  const goals = [
    { name: t('goals.previewEmergency'), available: 2400, target: 6000 },
    { name: t('goals.previewVacation'), available: 850, target: 2000 },
    { name: t('goals.previewTaxes'), available: 1200, target: 3000 },
  ]
  return <View style={styles.goalPreview}>
    <View style={styles.previewHeading}><Text style={[styles.valueLabel, { color: palette.mutedForeground }]}>{t('goals.title')}</Text><PreviewLabel /></View>
    {goals.map((goal) => { const progress = Math.round(goal.available / goal.target * 100); return <View key={goal.name} style={styles.previewGoal}><View style={styles.previewGoalTop}><View style={styles.comparisonGroup}><Text style={[styles.goalName, { color: palette.foreground }]}>{goal.name}</Text><Text style={[styles.note, { color: palette.mutedForeground }]}>{t('goals.available')} / {t('goals.target')}</Text></View><View style={styles.previewAmounts}><Text style={[styles.previewValue, { color: palette.foreground }]}>{money(goal.available)}</Text><Text style={[styles.note, { color: palette.mutedForeground }]}>{money(goal.target)}</Text></View></View><View style={[styles.progressTrack, { backgroundColor: palette.muted }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: palette.chart1 }]} /></View><Text style={[styles.note, { color: palette.mutedForeground }]}>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(progress / 100)}</Text></View> })}
  </View>
}

function Tab({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        // Unselected tabs carry no border — two bordered pills side by side
        // read as a wall of boxes rather than one Active/Archived toggle.
        selected ? { borderColor: palette.primary, backgroundColor: palette.primarySoft } : { borderWidth: 0, backgroundColor: palette.muted },
        pressed && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.tabText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

function GoalRow({
  goal,
  locale,
  palette,
  onView,
  archived = false,
  onRestore,
  restorePending = false,
}: {
  goal: GoalListItemViewModel
  locale: string
  palette: Palette
  onView: () => void
  archived?: boolean
  onRestore?: () => void
  restorePending?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const money = (value: number) => formatCurrency(value, { locale, currency: goal.currencyCode })
  const available = money(goal.availableAmount)
  const target = money(goal.targetAmount)
  const remaining = money(goal.remainingToTarget)
  const status = t(`goals.status.${goal.effectiveStatus}`)
  const targetDate = goal.targetDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(goal.targetDate))
    : null
  const contribution = goal.monthlyContributionTarget !== null
    ? money(goal.monthlyContributionTarget)
    : null
  const formattedProgress = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(goal.progressPercentage / 100)
  const progress = goal.progressAvailable
    ? t('goals.progressValue', { value: formattedProgress })
    : t('goals.progressUnavailable')
  const assigned = money(goal.assignedThisMonth)
  const spent = money(goal.spentAmount)
  const accessibilityLabel = [
    goal.name,
    status,
    `${t('goals.available')}, ${available}, ${goal.currencyCode}`,
    `${t('goals.target')}, ${target}, ${goal.currencyCode}`,
    progress,
    `${t('goals.remaining')}, ${remaining}, ${goal.currencyCode}`,
    goal.overTarget ? t('goals.overTarget') : null,
    contribution ? `${t('goals.monthlyContribution')}, ${contribution}, ${goal.currencyCode}` : null,
    targetDate ? t('goals.targetDate', { date: targetDate }) : null,
  ].filter(Boolean).join(', ')

  return (
    <View
      testID="goal-row"
      style={[styles.goalRow, { borderColor: palette.border, backgroundColor: palette.card }, archived && styles.archivedRow]}
    >
      <View accessible accessibilityLabel={accessibilityLabel} style={styles.goalSummary}>
      <View style={styles.goalHeader}>
        <Text allowFontScaling style={[styles.goalName, { color: palette.foreground }]}>
          {goal.name}
        </Text>
        <View style={[styles.status, { borderColor: palette.border }]}>
          <View style={[styles.statusMarker, { backgroundColor: palette.mutedForeground }]} />
          <Text allowFontScaling style={[styles.statusText, { color: palette.mutedForeground }]}>
            {status}
          </Text>
        </View>
      </View>

      <View style={styles.comparisonGroup}>
        <Text allowFontScaling style={[styles.valueLabel, { color: palette.mutedForeground }]}>
          {t('goals.available')}
        </Text>
        <View style={styles.comparison}>
          <Text allowFontScaling style={[styles.amount, { color: palette.foreground }]}>
            {available}
          </Text>
          <Text allowFontScaling style={[styles.comparisonText, { color: palette.mutedForeground }]}>
            {t('goals.ofTarget', { target })}
          </Text>
        </View>
      </View>

      <View style={styles.progressGroup}>
        <View style={[styles.progressTrack, { backgroundColor: palette.muted }]}>
          <View
            testID={`goal-progress-fill-${goal.goalId}`}
            style={[
              styles.progressFill,
              {
                width: `${goal.meterPercentage}%`,
                backgroundColor: palette.mutedForeground,
              },
            ]}
          />
        </View>
        <Text allowFontScaling style={[styles.progressText, { color: palette.mutedForeground }]}>
          {progress}{goal.overTarget ? ` · ${t('goals.overTarget')}` : ''}
        </Text>
      </View>

      <Text allowFontScaling style={[styles.detail, { color: palette.mutedForeground }]}>
        {t('goals.remainingValue', { value: remaining })}
      </Text>
      {contribution ? (
        <Text allowFontScaling style={[styles.detail, { color: palette.mutedForeground }]}>
          {t('goals.monthlyContributionValue', { value: contribution })}
        </Text>
      ) : null}
      {targetDate ? (
        <Text allowFontScaling style={[styles.detail, { color: palette.mutedForeground }]}>
          {t('goals.targetDate', { date: targetDate })}
        </Text>
      ) : null}
      {goal.effectiveStatus === 'on-track' ? (
        <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>
          {t('goals.onTrackNote')}
        </Text>
      ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(expanded ? 'goals.hideDetails' : 'goals.showDetails', { name: goal.name })}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
      >
        <Text allowFontScaling style={[styles.disclosureText, { color: palette.primary }]}>{t(expanded ? 'goals.hideDetailsLabel' : 'goals.showDetailsLabel')}</Text>
        <Text accessible={false} style={[styles.disclosureMark, { color: palette.primary }]}>{expanded ? '−' : '+'}</Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.detailsPanel, { borderTopColor: palette.border }]}>
          <GoalDetail label={t('goals.assignedThisMonth')} value={assigned} palette={palette} />
          <GoalDetail label={t('goals.spent')} value={spent} palette={palette} />
          <View style={styles.linkedGroup}>
            <Text allowFontScaling style={[styles.valueLabel, { color: palette.mutedForeground }]}>{t('goals.linkedAccounts')}</Text>
            <Text allowFontScaling style={[styles.linkedValue, { color: palette.foreground }]}>
              {goal.linkedAccounts.length > 0
                ? goal.linkedAccounts.map((account) => account.name ?? t('goals.unnamedAccount')).join(', ')
                : t('goals.noLinkedAccounts')}
            </Text>
            <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>{t('goals.linkedAccountsNote')}</Text>
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('goals.viewGoalNamed', { name: goal.name })}
        onPress={onView}
        style={({ pressed }) => [styles.viewGoal, { borderTopColor: palette.border }, pressed && styles.pressed]}
      >
        <Text allowFontScaling style={[styles.disclosureText, { color: palette.primary }]}>{t('goals.viewGoal')}</Text>
        <Text accessible={false} style={[styles.viewGoalMark, { color: palette.primary }]}>›</Text>
      </Pressable>
      {onRestore ? (
        <Action
          label={restorePending ? t('goals.restoring') : t('goals.restore')}
          onPress={onRestore}
          palette={palette}
          primary
          disabled={restorePending}
        />
      ) : null}
    </View>
  )
}

function GoalDetail({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.goalDetail}>
      <Text allowFontScaling style={[styles.valueLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.detailAmount, { color: palette.foreground }]}>{value}</Text>
    </View>
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

function LoadingState({ palette, label }: { palette: Palette; label: string }) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
        {['heading', 'goal-one', 'goal-two'].map((key, index) => (
          <View
            key={key}
            style={[
              styles.skeleton,
              { width: index === 0 ? 180 : '100%', backgroundColor: palette.muted },
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  )
}

function FailureState({
  title,
  message,
  onRefresh,
  onLogout,
  palette,
}: {
  title: string
  message: string
  onRefresh: GoalsScreenProps['onRefresh']
  onLogout: GoalsScreenProps['onLogout']
  palette: Palette
}) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.centered}>
        <View style={styles.failure}>
          <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>
            {title}
          </Text>
          <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>
            {message}
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
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[4] },
  heading: { flex: 1, minWidth: 240, gap: themeTokens.spacing[2] },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  tabs: { flexDirection: 'row', gap: themeTokens.spacing[2] },
  tab: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  tabText: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  archivedRow: { opacity: 0.6 },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  list: { gap: themeTokens.spacing[4] },
  goalRow: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  goalSummary: { gap: themeTokens.spacing[3] },
  goalHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  goalName: { ...textStyles.section, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.sm, paddingHorizontal: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[1] },
  statusMarker: { width: 6, height: 6, borderRadius: themeTokens.radius.pill },
  statusText: { ...textStyles.meta, fontWeight: '500' as const },
  comparison: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: themeTokens.spacing[2] },
  comparisonGroup: { gap: themeTokens.spacing[1] },
  valueLabel: { ...textStyles.meta },
  amount: { ...textStyles.amount },
  comparisonText: { ...textStyles.body },
  progressGroup: { gap: themeTokens.spacing[2] },
  progressTrack: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: themeTokens.radius.pill },
  progressText: { ...textStyles.meta },
  detail: { ...textStyles.body },
  note: { ...textStyles.label },
  disclosure: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  disclosureText: { ...textStyles.action },
  disclosureMark: { ...textStyles.title, fontWeight: '400' as const },
  detailsPanel: { borderTopWidth: 1, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[3] },
  viewGoal: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], borderTopWidth: 1, paddingTop: themeTokens.spacing[2] },
  viewGoalMark: { ...textStyles.title, fontWeight: '400' as const },
  goalDetail: { gap: themeTokens.spacing[1] },
  detailAmount: { ...textStyles.amount },
  linkedGroup: { gap: themeTokens.spacing[1] },
  linkedValue: { ...textStyles.body },
   empty: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.layout.sectionGap }, emptyTitle: { ...textStyles.section }, emptyMessage: { ...textStyles.body }, goalPreview: { gap: themeTokens.layout.sectionGap }, previewHeading: { flexDirection: 'row', justifyContent: 'space-between' }, previewGoal: { gap: themeTokens.spacing[2] }, previewGoalTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, previewAmounts: { alignItems: 'flex-end', gap: themeTokens.spacing[1] }, previewValue: { ...textStyles.amount },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { height: 72, maxWidth: '100%', borderRadius: themeTokens.radius.lg },
  centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  failure: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: themeTokens.spacing[4] },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})
