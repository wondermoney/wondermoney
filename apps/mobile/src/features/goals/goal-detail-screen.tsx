import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EntityMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { Icon, type IconName } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { Notice } from '@/components/ui/notice'
import { ObjectHeader } from '@/components/ui/page-header'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Divider, Section } from '@/components/ui/section'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { ApiError } from '@/lib/api/errors'
import { formatNumberInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { GoalActivityViewModel, GoalDetailViewModel } from './goal-detail-view-model'
import { buildGoalMetadataChanges } from './goal-detail-view-model'
import { FigureStat } from './goal-ui'
import { goalMetadataWriteSchema, parseLocalizedGoalMoney, type GoalMetadataWrite } from './goals-contract'
import { formatGoalDate, goalStatusTone } from './goals-screen'
import { classifyGoalWriteFailure, type GoalWriteFailure } from './use-goal-mutations'


export type GoalDetailData = Readonly<{
  goal: GoalDetailViewModel
  activities: readonly GoalActivityViewModel[]
  totalActivities: number
}>

export type GoalAccountOption = Readonly<{ accountId: number; name: string | null }>
export type GoalAccountContextState = Readonly<{
  status: 'loading' | 'loaded' | 'error' | 'invalid-response'
  accounts: readonly GoalAccountOption[]
}>

type LoadedState = Readonly<{
  data: GoalDetailData
  refreshing?: boolean
  activityStatus: 'loading' | 'error' | 'loaded'
  hasMore: boolean
  loadingMore?: boolean
  loadMoreError?: boolean
}>

export type GoalDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | ({ status: 'loaded' | 'refresh-error' } & LoadedState)

export type GoalDetailScreenProps = Readonly<{
  state: GoalDetailViewState
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onLoadMore: () => void | Promise<unknown>
  onLogout: () => void | Promise<void>
  accountContext: GoalAccountContextState
  mutationPending: boolean
  goalWriteUnknown: boolean
  isGoalWriteBlocked: () => boolean
  onSaveMetadata: (value: GoalMetadataWrite) => Promise<void>
  onLinkAccount: (accountId: number) => Promise<void>
  onUnlinkAccount: (accountId: number) => Promise<void>
  onAssign: (amount: number) => Promise<void>
  onMoveOut: (amount: number) => Promise<void>
  onArchive: () => Promise<void>
}>

export function GoalDetailScreen(props: GoalDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const { state, onBack, onRefresh, onLogout } = props

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState label={t('goalDetail.loading')} onBack={onBack} />
  if (state.status === 'error' || state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'invalid-response') {
    return <FailureState state={state.status} onBack={onBack} onRetry={onRefresh} onLogout={onLogout} />
  }

  return <LoadedGoalDetail {...props} state={state} locale={locale} />
}

type ReserveAction = 'assign' | 'move-out'
type ReserveFailure = GoalWriteFailure | 'validation' | 'insufficient-reserve'
type OpenSheet = null | 'assign' | 'move-out' | 'edit' | 'manage'

/**
 * Web's goal detail (`goals/[goalKey]/goal-detail-client.tsx`) at phone width, in the calm
 * structure: "← Goals"; the goal's mark, name, status chip and description with "Manage goal"
 * as the title row's ⋮; Available as the headline figure with how the goal is doing as its
 * status line; Target amount, Progress and Target date over the progress bar; Assign money and
 * Move money out as the one control row; then Monthly contribution (or the payoff plan for a
 * debt), Activity, and Linked account as open sections. Web's dialogs are sheets here.
 */
function LoadedGoalDetail({ state, locale, onBack, onRefresh, onLoadMore, accountContext, mutationPending, goalWriteUnknown, isGoalWriteBlocked, onSaveMetadata, onLinkAccount, onUnlinkAccount, onAssign, onMoveOut, onArchive }: GoalDetailScreenProps & { state: Extract<GoalDetailViewState, { status: 'loaded' | 'refresh-error' }>; locale: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const { goal } = state.data
  const mutationDisabled = mutationPending || goalWriteUnknown
  const [sheet, setSheet] = useState<OpenSheet>(null)
  const [metadataDirty, setMetadataDirty] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [archiveFailure, setArchiveFailure] = useState<GoalWriteFailure | null>(null)
  const money = (value: number) => formatMoney(value, { locale, currency: goal.currencyCode })

  const requestBack = () => {
    if (!metadataDirty) { onBack(); return }
    Alert.alert(t('goalDetail.editor.discardTitle'), t('goalDetail.editor.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('goalDetail.editor.discard'), style: 'destructive', onPress: onBack },
    ])
  }

  const archive = () => {
    setSheet(null)
    if (mutationDisabled || isGoalWriteBlocked()) return
    if (goal.availableAmount > 0) {
      Alert.alert(t('goalDetail.archive.balanceTitle'), t('goalDetail.archive.balanceMessage'))
      return
    }
    Alert.alert(t('goalDetail.archive.confirmTitle'), t('goalDetail.archive.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('goalDetail.archive.confirm'),
        style: 'destructive',
        onPress: () => {
          setArchiveFailure(null)
          void onArchive().catch((error) => setArchiveFailure(classifyGoalWriteFailure(error)))
        },
      },
    ])
  }

  const progress = goal.displayProgress
  const progressLabel = progress === null ? '—' : formatPercent(progress, locale)

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/goals" label={t('goalDetail.back')} onPress={requestBack} disabled={mutationPending} />
            {state.status === 'refresh-error' ? <Notice title={t('goalDetail.stale')} /> : null}
            {goalWriteUnknown ? <Notice tone="warning" title={t('goalDetail.reserve.unknown')} /> : null}
            <ObjectHeader
              action={goal.editable ? (
                <IconButton
                  accessibilityLabel={mutationPending ? t('goalDetail.archive.archiving') : t('goalDetail.manage')}
                  disabled={mutationDisabled}
                  icon="more-vertical"
                  onPress={() => setSheet('manage')}
                  style={styles.overflow}
                />
              ) : undefined}
              badge={<Badge label={t(`goals.status.${goal.lifecycleStatus}`)} tone={goalStatusTone(goal.lifecycleStatus)} />}
              descriptor={goal.description ?? undefined}
              leading={<EntityMark glyph={goal.isDebt ? 'hand-coins' : 'target'} />}
              title={goal.name}
            />
            {announcement ? <Text accessibilityLiveRegion="polite" tone="success" variant="meta">{announcement}</Text> : null}
            {archiveFailure ? <Notice tone="destructive" title={t(`goalDetail.writeFailures.${archiveFailure}`)} /> : null}
          </View>

          <View style={styles.figureBlock}>
            <HeadlineFigure
              currency={goal.currencyCode}
              label={t('goals.available')}
              locale={locale}
              size="md"
              status={progressStatus(goal.status, t)}
              value={goal.availableAmount}
            />
            <View style={styles.figureStats}>
              <FigureStat label={t('goalDetail.targetAmount')} value={money(goal.targetAmount)} />
              <FigureStat label={t('goalDetail.progress')} value={progressLabel} />
              {goal.targetDate ? <FigureStat label={t('goalDetail.targetDateLabel')} value={formatGoalDate(goal.targetDate, locale)} /> : null}
            </View>
            <ProgressBar track="border" testID="goal-detail-progress-fill" value={progress ?? 0} />
            {goal.editable ? (
              <View style={styles.actionRow}>
                <Button disabled={mutationDisabled} label={t('goalDetail.assignMoney')} onPress={() => setSheet('assign')} style={styles.flex} />
                <Button disabled={mutationDisabled} label={t('goalDetail.moveMoneyOut')} onPress={() => setSheet('move-out')} style={styles.flex} variant="secondary" />
              </View>
            ) : null}
          </View>

          {goal.isDebt && goal.debtProjection ? (
            <DebtPayoffSection goal={goal} locale={locale} money={money} />
          ) : (
            <Section title={t('goalDetail.monthlyContribution')} variant="open">
              <View style={styles.figureStats}>
                <FigureStat label={t('goalDetail.assignedThisMonth')} value={money(goal.assignedThisMonth)} />
                <FigureStat label={t('goalDetail.neededThisMonth')} value={goal.requiredMonthlyContribution === null ? '—' : money(goal.requiredMonthlyContribution)} />
                <FigureStat label={t('goalDetail.shortBy')} value={goal.monthlyShortfall === null ? '—' : money(goal.monthlyShortfall)} />
                {/* Mobile-only figures web leaves off this page, kept after web's three. */}
                <FigureStat label={t('goals.remaining')} value={money(goal.remainingToTarget)} />
                <FigureStat label={t('goals.spent')} value={money(goal.spentAmount)} />
              </View>
              <Text tone="muted" variant="meta">{t('goalDetail.budgetExplainer')}</Text>
            </Section>
          )}

          <ActivitySection state={state} locale={locale} onLoadMore={onLoadMore} onRetry={onRefresh} />

          <Section title={t('goalDetail.linkedAccount')} variant="open">
            <Text tone="muted" variant="meta">{t('goalDetail.accountContextNote')}</Text>
            {goal.editable ? (
              <AccountContextEditor goal={goal} state={accountContext} pending={mutationPending} disabled={mutationDisabled} isGoalWriteBlocked={isGoalWriteBlocked} onLink={onLinkAccount} onUnlink={onUnlinkAccount} />
            ) : (
              <Text variant="meta">
                {goal.linkedAccounts.length > 0
                  ? goal.linkedAccounts.map(({ name }) => name ?? t('goals.unnamedAccount')).join(', ')
                  : t('goals.noLinkedAccounts')}
              </Text>
            )}
          </Section>
        </View>
      </ScrollView>

      {goal.editable ? (
        <>
          <Sheet closeLabel={t('common.cancel')} visible={sheet === 'assign' || sheet === 'move-out'} onClose={() => setSheet(null)} title={t(sheet === 'move-out' ? 'goalDetail.moveOutTitle' : 'goalDetail.assignTitle')}>
            {sheet === 'assign' || sheet === 'move-out' ? (
              <ReserveEditor
                action={sheet}
                goal={goal}
                locale={locale}
                pending={mutationPending}
                disabled={mutationDisabled}
                isGoalWriteBlocked={isGoalWriteBlocked}
                onAssign={onAssign}
                onMoveOut={onMoveOut}
                onCancel={() => setSheet(null)}
                onSuccess={(message) => { setAnnouncement(message); setSheet(null) }}
              />
            ) : null}
          </Sheet>
          <Sheet closeLabel={t('common.cancel')} visible={sheet === 'edit'} onClose={() => setSheet(null)} title={t('goalDetail.editTitle')}>
            {sheet === 'edit' ? (
              <MetadataEditor
                goal={goal}
                pending={mutationPending}
                disabled={mutationDisabled}
                onSave={async (value) => { await onSaveMetadata(value); setSheet(null) }}
                onDirtyChange={setMetadataDirty}
                onCancel={() => setSheet(null)}
              />
            ) : null}
          </Sheet>
          <Sheet closeLabel={t('common.cancel')} visible={sheet === 'manage'} onClose={() => setSheet(null)} title={t('goalDetail.manage')}>
            <View>
              <MenuItem icon="pencil" label={t('goalDetail.edit')} onPress={() => setSheet('edit')} disabled={mutationDisabled} />
              <Divider />
              <MenuItem destructive label={t('goalDetail.archive.action')} onPress={archive} disabled={mutationDisabled} />
            </View>
          </Sheet>
        </>
      ) : null}
    </SafeAreaView>
  )
}

/** How the goal is doing, as the figure's status line: only where it says more than the chip. */
function progressStatus(status: GoalDetailViewModel['status'], t: (key: string) => string): { label: string; tone: 'success' | 'warning' } | undefined {
  if (status === 'on-track' || status === 'funded') return { label: t(`goals.status.${status}`), tone: 'success' }
  if (status === 'behind') return { label: t('goals.status.behind'), tone: 'warning' }
  return undefined
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)
}

function formatMonths(months: number, t: (key: string, values?: Record<string, unknown>) => string) {
  const years = Math.floor(months / 12)
  const remaining = months % 12
  const parts: string[] = []
  if (years > 0) parts.push(t('goals.debtStrategy.years', { count: years }))
  if (remaining > 0 || years === 0) parts.push(t('goals.debtStrategy.months', { count: remaining }))
  return parts.join(' ')
}

/** Web `DebtPayoffPanel`: the payoff plan's four figures (the balance chart is web-only for now). */
function DebtPayoffSection({ goal, locale, money }: { goal: GoalDetailViewModel; locale: string; money: (value: number) => string }) {
  const { t } = useTranslation()
  const projection = goal.debtProjection!
  const apr = goal.annualInterestRateBps === null
    ? undefined
    : `${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(goal.annualInterestRateBps / 10000)} ${t('goalDetail.apr')}`
  return (
    <Section aside={apr} title={t('goalDetail.payoffPlan')} variant="open">
      {!projection.paysOff ? <Notice tone="destructive" title={t('goalDetail.neverPaysOffHint')} /> : null}
      <View style={styles.figureStats}>
        <FigureStat label={t('goalDetail.payoffDate')} value={projection.paysOff && projection.payoffDate ? formatGoalDate(projection.payoffDate, locale) : t('goalDetail.never')} />
        <FigureStat label={t('goals.debtStrategy.timeToPayoff')} value={projection.paysOff && projection.months !== null ? formatMonths(projection.months, t) : '—'} />
        <FigureStat label={t('goals.debtStrategy.totalInterest')} value={money(projection.totalInterest)} />
        <FigureStat label={t('goalDetail.monthlyPayment')} value={money(projection.monthlyPayment)} />
      </View>
    </Section>
  )
}

function classifyReserveFailure(error: unknown, action: ReserveAction): ReserveFailure {
  if (error instanceof ApiError && error.code === 'http' && error.status === 400) {
    return action === 'move-out' ? 'insufficient-reserve' : 'validation'
  }
  return classifyGoalWriteFailure(error)
}

function ReserveEditor({ action, goal, locale, pending, disabled, isGoalWriteBlocked, onAssign, onMoveOut, onCancel, onSuccess }: {
  action: ReserveAction
  goal: GoalDetailViewModel
  locale: string
  pending: boolean
  disabled: boolean
  isGoalWriteBlocked: GoalDetailScreenProps['isGoalWriteBlocked']
  onAssign: GoalDetailScreenProps['onAssign']
  onMoveOut: GoalDetailScreenProps['onMoveOut']
  onCancel: () => void
  onSuccess: (announcement: string) => void
}) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const [amountInput, setAmountInput] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ReserveFailure | null>(null)

  const requestConfirmation = () => {
    if (disabled || confirming) return
    const amount = parseLocalizedGoalMoney(amountInput, locale)
    if (amount === null) { setFailure('validation'); return }
    if (action === 'move-out' && amount > goal.availableAmount) { setFailure('insufficient-reserve'); return }
    const frozen = { action, amount }
    const formattedAmount = formatMoney(frozen.amount, { locale, currency: goal.currencyCode })
    setFailure(null)
    setConfirming(true)
    Alert.alert(
      t(`goalDetail.reserve.confirm.${frozen.action}.title`, { goal: goal.name }),
      t(`goalDetail.reserve.confirm.${frozen.action}.message`, { goal: goal.name, amount: formattedAmount }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => setConfirming(false) },
        { text: t(`goalDetail.reserve.${frozen.action}`), onPress: () => {
          if (isGoalWriteBlocked()) { setConfirming(false); return }
          const write = frozen.action === 'assign' ? onAssign : onMoveOut
          void write(frozen.amount).then(() => {
            setAmountInput('')
            setFailure(null)
            onSuccess(t(`goalDetail.reserve.success.${frozen.action}`, { amount: formattedAmount, goal: goal.name }))
          }).catch((error) => setFailure(classifyReserveFailure(error, frozen.action))).finally(() => setConfirming(false))
        } },
      ],
      { cancelable: true, onDismiss: () => setConfirming(false) },
    )
  }

  return (
    <View style={styles.form}>
      <Text tone="muted" variant="meta">{t('goalDetail.reserve.helper')}</Text>
      {action === 'move-out' ? <FigureStat label={t('goals.available')} value={formatMoney(goal.availableAmount, { locale, currency: goal.currencyCode })} /> : null}
      {failure ? <Notice tone="destructive" title={t(`goalDetail.reserve.failures.${failure}`)} /> : null}
      <Field label={t('goalDetail.reserve.amount')} hint={t('goalDetail.reserve.amountHint', { currency: goal.currencyCode })} value={amountInput} onChange={(value) => { setAmountInput(value); setFailure(null) }} editable={!disabled && !confirming} money invalid={failure === 'validation' || failure === 'insufficient-reserve'} />
      <View style={styles.formActions}>
        <Button
          block
          disabled={disabled || confirming || amountInput.trim() === ''}
          label={pending ? t('goalDetail.reserve.working') : t(`goalDetail.reserve.${action}`)}
          onPress={requestConfirmation}
        />
        <Button block label={t('common.cancel')} onPress={onCancel} variant="secondary" disabled={confirming} />
      </View>
    </View>
  )
}

function MetadataEditor({ goal, pending, disabled, onSave, onDirtyChange, onCancel }: { goal: GoalDetailViewModel; pending: boolean; disabled: boolean; onSave: GoalDetailScreenProps['onSaveMetadata']; onDirtyChange: (dirty: boolean) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const inputOf = useCallback((value: number) => formatNumberInput(value, locale), [locale])
  const [name, setName] = useState(goal.name)
  const [target, setTarget] = useState(inputOf(goal.targetAmount))
  const [monthly, setMonthly] = useState(goal.monthlyContributionTarget === null ? '' : inputOf(goal.monthlyContributionTarget))
  const [failure, setFailure] = useState<GoalWriteFailure | 'validation' | null>(null)
  const authoritativeSignature = `${goal.name}\u0000${goal.targetAmount}\u0000${goal.monthlyContributionTarget ?? ''}`
  const previousAuthoritativeSignature = useRef(authoritativeSignature)
  const canonicalTarget = inputOf(goal.targetAmount)
  const canonicalMonthly = goal.monthlyContributionTarget === null ? '' : inputOf(goal.monthlyContributionTarget)
  const trimmedName = name.trim()
  const candidateTarget = parseLocalizedGoalMoney(target, locale)
  const candidateMonthly = monthly.trim() === '' ? null : parseLocalizedGoalMoney(monthly, locale)
  const invalid = trimmedName.length < 1 || trimmedName.length > 100 || candidateTarget === null || (monthly.trim() !== '' && candidateMonthly === null)
  const candidate = invalid ? null : {
    name: trimmedName,
    targetAmount: candidateTarget!,
    monthlyContributionTarget: candidateMonthly,
  }
  const changes = candidate ? buildGoalMetadataChanges(goal, candidate) : null
  const rawChanged = name !== goal.name || target !== canonicalTarget || monthly !== canonicalMonthly
  const dirty = changes !== null || (rawChanged && invalid)
  const saveEnabled = !disabled && (changes !== null || (rawChanged && invalid))
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])

  useEffect(() => {
    if (previousAuthoritativeSignature.current === authoritativeSignature) return
    previousAuthoritativeSignature.current = authoritativeSignature
    setName(goal.name)
    setTarget(inputOf(goal.targetAmount))
    setMonthly(goal.monthlyContributionTarget === null ? '' : inputOf(goal.monthlyContributionTarget))
    setFailure(null)
  }, [authoritativeSignature, goal.monthlyContributionTarget, goal.name, goal.targetAmount, inputOf])

  const discard = useCallback(() => {
    setName(goal.name); setTarget(inputOf(goal.targetAmount)); setMonthly(goal.monthlyContributionTarget === null ? '' : inputOf(goal.monthlyContributionTarget)); setFailure(null)
  }, [goal.monthlyContributionTarget, goal.name, goal.targetAmount, inputOf])
  const confirmDiscard = useCallback((then?: () => void) => {
    Alert.alert(t('goalDetail.editor.discardTitle'), t('goalDetail.editor.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('goalDetail.editor.discard'), style: 'destructive', onPress: () => { discard(); then?.() } },
    ])
  }, [discard, t])
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty || disabled) return false
      confirmDiscard()
      return true
    })
    return () => subscription.remove()
  }, [confirmDiscard, dirty, disabled])

  const save = async () => {
    if (disabled || !rawChanged) return
    if (invalid) { setFailure('validation'); return }
    if (!changes) return
    if (!goalMetadataWriteSchema.safeParse(changes).success) { setFailure('validation'); return }
    setFailure(null)
    try { await onSave(changes) } catch (error) { setFailure(classifyGoalWriteFailure(error)) }
  }

  return (
    <View style={styles.form}>
      <Text tone="muted" variant="meta">{t('goalDetail.editor.helper')}</Text>
      {failure ? <Notice tone="destructive" title={t(`goalDetail.writeFailures.${failure}`)} /> : null}
      <Field label={t('goalDetail.editor.name')} value={name} onChange={(value) => { setName(value); setFailure(null) }} editable={!disabled} maxLength={100} />
      <Field label={t('goalDetail.editor.target')} value={target} onChange={(value) => { setTarget(value); setFailure(null) }} editable={!disabled} money invalid={failure === 'validation' && candidateTarget === null} />
      <Field label={t('goalDetail.editor.monthly')} hint={t('goalDetail.editor.monthlyHint')} value={monthly} onChange={(value) => { setMonthly(value); setFailure(null) }} editable={!disabled} money />
      <View style={styles.formActions}>
        <Button block disabled={!saveEnabled} label={pending ? t('goalDetail.editor.saving') : t('goalDetail.editor.save')} loading={pending} onPress={save} />
        <Button block label={t('common.cancel')} onPress={() => (dirty ? confirmDiscard(onCancel) : onCancel())} variant="secondary" />
      </View>
    </View>
  )
}

function Field({ label, hint, value, onChange, editable, money = false, maxLength, invalid = false }: { label: string; hint?: string; value: string; onChange: (value: string) => void; editable: boolean; money?: boolean; maxLength?: number; invalid?: boolean }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text variant="metaStrong">{label}</Text>
      <TextInput
        accessibilityHint={hint}
        accessibilityLabel={label}
        editable={editable}
        keyboardType={money ? 'decimal-pad' : 'default'}
        maxLength={maxLength}
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        placeholderTextColor={palette.mutedForeground}
        style={[
          styles.input,
          money && styles.moneyInput,
          { color: palette.foreground, borderColor: invalid ? palette.destructiveText : focused ? palette.ring : palette.input, borderWidth: focused || invalid ? 2 : 1 },
          !editable && styles.inert,
        ]}
        value={value}
      />
      {hint ? <Text tone="muted" variant="label">{hint}</Text> : null}
    </View>
  )
}

function AccountContextEditor({ goal, state, pending, disabled, isGoalWriteBlocked, onLink, onUnlink }: { goal: GoalDetailViewModel; state: GoalAccountContextState; pending: boolean; disabled: boolean; isGoalWriteBlocked: GoalDetailScreenProps['isGoalWriteBlocked']; onLink: GoalDetailScreenProps['onLinkAccount']; onUnlink: GoalDetailScreenProps['onUnlinkAccount'] }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const linkedIds = useMemo(() => new Set(goal.linkedAccounts.map(({ accountId }) => accountId)), [goal.linkedAccounts])
  const available = state.accounts.filter(({ accountId }) => accountId > 0 && !linkedIds.has(accountId))
  const [selected, setSelected] = useState<number | null>(null)
  const [failure, setFailure] = useState<GoalWriteFailure | null>(null)
  const link = async () => {
    if (selected === null || disabled) return
    setFailure(null)
    try { await onLink(selected); setSelected(null) } catch (error) { setFailure(classifyGoalWriteFailure(error)) }
  }
  const confirmUnlink = (account: GoalAccountOption) => Alert.alert(
    t('goalDetail.accounts.unlinkTitle', { account: account.name ?? t('goals.unnamedAccount') }),
    t('goalDetail.accounts.unlinkMessage', { account: account.name ?? t('goals.unnamedAccount') }),
    [{ text: t('common.cancel'), style: 'cancel' }, { text: t('goalDetail.accounts.unlink'), style: 'destructive', onPress: () => {
      if (isGoalWriteBlocked()) return
      void onUnlink(account.accountId).catch((error) => setFailure(classifyGoalWriteFailure(error)))
    } }],
  )

  return (
    <View style={styles.accounts}>
      {failure ? <Notice tone="destructive" title={t(`goalDetail.writeFailures.${failure}`)} /> : null}
      {goal.linkedAccounts.length > 0 ? (
        <Card>
          {goal.linkedAccounts.map((account, index) => (
            <View key={account.accountId}>
              {index > 0 ? <Divider style={styles.cardDivider} /> : null}
              <View style={styles.accountRow}>
                <Text style={styles.shrink} variant="meta">{account.name ?? t('goals.unnamedAccount')}</Text>
                <Button
                  accessibilityLabel={t('goalDetail.accounts.unlinkNamed', { account: account.name ?? t('goals.unnamedAccount') })}
                  disabled={disabled}
                  label={t('goalDetail.accounts.unlink')}
                  onPress={() => confirmUnlink(account)}
                  size="sm"
                  variant="ghost"
                />
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {state.status === 'loading' ? <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('goalDetail.accounts.loading')}</Text> : null}
      {state.status === 'error' || state.status === 'invalid-response' ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t(`goalDetail.accounts.${state.status}`)}</Text> : null}
      {state.status === 'loaded' && available.length === 0 && goal.linkedAccounts.length === 0 ? <Text tone="muted" variant="meta">{t('goalDetail.accounts.noneAvailable')}</Text> : null}
      {available.length > 0 ? (
        <View style={[styles.choices, { borderColor: palette.input }]}>
          {available.map((account, index) => {
            const isSelected = selected === account.accountId
            return (
              <Pressable
                key={account.accountId}
                accessible
                accessibilityLabel={account.name ?? t('goals.unnamedAccount')}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled }}
                disabled={disabled}
                onPress={() => setSelected(account.accountId)}
                style={({ pressed }) => [
                  styles.choice,
                  index > 0 && { borderTopWidth: 1, borderTopColor: palette.border },
                  isSelected && { backgroundColor: palette.primarySoft },
                  pressed && { backgroundColor: palette.muted },
                ]}
              >
                <Text style={styles.shrink} variant="meta">{account.name ?? t('goals.unnamedAccount')}</Text>
                {isSelected ? <Icon color={palette.primary} name="check" size={themeTokens.size.iconSmall} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {available.length > 0 ? (
        <Button block disabled={selected === null || disabled} icon="link" label={pending ? t('goalDetail.accounts.linking') : t('goalDetail.accounts.link')} onPress={link} />
      ) : null}
    </View>
  )
}

/** Web `GoalActivityList` on its `Timeline`: a rail, one node per event, the newest filled. */
function ActivitySection({ state, locale, onLoadMore, onRetry }: {
  state: LoadedState
  locale: string
  onLoadMore: GoalDetailScreenProps['onLoadMore']
  onRetry: GoalDetailScreenProps['onRefresh']
}) {
  const { t } = useTranslation()
  const loaded = state.activityStatus === 'loaded'
  return (
    <Section
      aside={loaded && state.data.totalActivities > 0 ? t('goalDetail.activityCount', { loaded: state.data.activities.length, total: state.data.totalActivities }) : undefined}
      title={t('goalDetail.activity')}
      variant="open"
    >
      {state.activityStatus === 'loading' ? <Text accessibilityLabel={t('goalDetail.activityLoading')} accessibilityRole="progressbar" tone="muted" variant="meta">{t('goalDetail.activityLoading')}</Text> : null}
      {state.activityStatus === 'error' ? (
        <View style={styles.activityError}>
          <Text accessibilityRole="alert" tone="muted" variant="meta">{t('goalDetail.activityError')}</Text>
          <Button label={t('common.retry')} onPress={onRetry} size="sm" variant="secondary" style={styles.hug} />
        </View>
      ) : null}
      {loaded && state.data.activities.length === 0 ? <Text tone="muted" variant="meta">{t('goalDetail.activityEmpty')}</Text> : null}
      {loaded && state.data.activities.length > 0 ? (
        <View>
          {state.data.activities.map((activity, index) => (
            <ActivityRow key={activity.id} activity={activity} emphasis={index === 0} last={index === state.data.activities.length - 1} locale={locale} />
          ))}
        </View>
      ) : null}
      {state.loadMoreError ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('goalDetail.loadMoreError')}</Text> : null}
      {state.hasMore ? <Button disabled={state.loadingMore} label={state.loadingMore ? t('goalDetail.loadingMore') : t('goalDetail.loadMore')} onPress={async () => { await onLoadMore() }} style={styles.loadMore} variant="secondary" /> : null}
    </Section>
  )
}

function ActivityRow({ activity, emphasis, last, locale }: { activity: GoalActivityViewModel; emphasis: boolean; last: boolean; locale: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const date = formatGoalDate(activity.occurredAt, locale)
  const amount = activity.amount === null ? null : formatMoney(activity.amount, { locale, currency: activity.currencyCode })
  const title = t(`goalDetail.activityType.${activity.type}`)
  // Said in words, not colour alone. There is no reversal action in the app yet, so this only warns.
  const expiredWarning = activity.transactionExpired ? t('goalDetail.transactionExpired') : null
  return (
    <View testID="goal-activity-row" accessible accessibilityLabel={[title, date, amount, activity.note, expiredWarning].filter(Boolean).join(', ')} style={[styles.timelineItem, !last && styles.timelineGap]}>
      <View style={styles.rail}>
        <View style={[styles.node, { backgroundColor: emphasis ? palette.primary : palette.border }]} />
        {!last ? <View style={[styles.railLine, { backgroundColor: palette.border }]} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <View style={styles.shrink}>
          <Text variant="metaStrong">{title}</Text>
          {activity.note ? <Text tone="muted" variant="label">{activity.note}</Text> : null}
          {expiredWarning ? (
            <View style={styles.expired}>
              <Icon color={palette.warningText} name="circle-help" size={12} />
              <Text style={styles.shrink} tone="warning" variant="label">{expiredWarning}</Text>
            </View>
          ) : null}
          <Text tone="muted" variant="label">{date}</Text>
        </View>
        {amount ? <Text variant="amount">{amount}</Text> : null}
      </View>
    </View>
  )
}

function MenuItem({ icon, label, onPress, destructive = false, disabled = false }: { icon?: IconName; label: string; onPress: () => void; destructive?: boolean; disabled?: boolean }) {
  const palette = usePalette()
  const color = destructive ? palette.destructiveText : palette.foreground
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: palette.accent }, disabled && styles.inert]}
    >
      {icon ? <Icon color={color} name={icon} size={themeTokens.size.iconSmall} /> : null}
      <Text style={{ color }} variant="meta">{label}</Text>
    </Pressable>
  )
}

function LoadingState({ label, onBack }: { label: string; onBack: () => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.loading}>
        <BackControl fallback="/goals" label={t('goalDetail.back')} onPress={onBack} />
        <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loadingBlocks}>
          {[200, 320, 320].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}
        </View>
      </View>
    </SafeAreaView>
  )
}

function FailureState({ state, onBack, onRetry, onLogout }: { state: 'error' | 'not-found' | 'invalid-id' | 'invalid-response'; onBack: () => void; onRetry: () => void | Promise<void>; onLogout: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const key = state === 'not-found' ? 'notFound' : state === 'invalid-id' ? 'invalidId' : state === 'invalid-response' ? 'invalidResponse' : 'error'
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BackControl fallback="/goals" label={t('goalDetail.back')} onPress={onBack} />
          <Card density="standalone">
            <View style={styles.form}>
              <Text accessibilityRole="header" variant="section">{t(`goalDetail.${key}.title`)}</Text>
              <Text tone="muted" variant="meta">{t(`goalDetail.${key}.message`)}</Text>
              <View style={styles.actionRow}>
                {state === 'error' || state === 'invalid-response' ? <Button label={t('common.retry')} onPress={onRetry} /> : null}
                <Button label={t('common.signOut')} onPress={onLogout} variant="secondary" />
              </View>
            </View>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  overflow: { marginRight: -11, marginVertical: -6 },
  flex: { flex: 1 },
  header: { gap: themeTokens.spacing[4] },
  hug: { alignSelf: 'flex-start' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  figureBlock: { gap: themeTokens.spacing[4] },
  figureStats: { gap: themeTokens.spacing[4] },
  shrink: { flexShrink: 1 },
  form: { gap: themeTokens.spacing[4] },
  formActions: { gap: themeTokens.spacing[2] },
  field: { gap: themeTokens.spacing[2] },
  input: { ...themeTokens.typography.scale.body, minHeight: themeTokens.size.control, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  moneyInput: { fontFamily: themeTokens.typography.scale.amount.fontFamily },
  inert: { opacity: 0.5 },
  accounts: { gap: themeTokens.spacing[3] },
  cardDivider: { marginVertical: themeTokens.spacing[2] },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  choices: { borderWidth: 1, borderRadius: themeTokens.radius.md, overflow: 'hidden' },
  choice: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[3] },
  activityError: { gap: themeTokens.spacing[3] },
  loadMore: { alignSelf: 'flex-start', minHeight: themeTokens.touchTarget.minimum },
  timelineItem: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  timelineGap: { paddingBottom: themeTokens.spacing[4] },
  rail: { width: 8, alignItems: 'center' },
  node: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  railLine: { position: 'absolute', top: 16, bottom: -themeTokens.spacing[4] + 4, width: 1 },
  timelineBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[4] },
  expired: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[1] },
  menuItem: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], paddingHorizontal: themeTokens.spacing[2], borderRadius: themeTokens.radius.sm },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  loadingBlocks: { gap: themeTokens.spacing[4] },
  skeleton: { height: 48, maxWidth: '100%', borderRadius: themeTokens.radius.lg },
})
