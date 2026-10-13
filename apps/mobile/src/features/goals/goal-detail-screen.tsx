import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/errors'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { GoalActivityViewModel, GoalDetailViewModel } from './goal-detail-view-model'
import { buildGoalMetadataChanges } from './goal-detail-view-model'
import { goalMetadataWriteSchema, parseLocalizedGoalMoney, type GoalMetadataWrite } from './goals-contract'
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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const { state, onBack, onRefresh, onLogout } = props

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState palette={palette} label={t('goalDetail.loading')} onBack={onBack} />
  if (state.status === 'error' || state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'invalid-response') {
    return <FailureState state={state.status} palette={palette} onBack={onBack} onRetry={onRefresh} onLogout={onLogout} />
  }

  return <LoadedGoalDetail {...props} state={state} locale={locale} palette={palette} />
}

function LoadedGoalDetail({ state, locale, palette, onBack, onRefresh, onLoadMore, accountContext, mutationPending, goalWriteUnknown, isGoalWriteBlocked, onSaveMetadata, onLinkAccount, onUnlinkAccount, onAssign, onMoveOut, onArchive }: GoalDetailScreenProps & { state: Extract<GoalDetailViewState, { status: 'loaded' | 'refresh-error' }>; locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const { goal } = state.data
  const mutationDisabled = mutationPending || goalWriteUnknown
  const [metadataDirty, setMetadataDirty] = useState(false)
  const requestBack = () => {
    if (!metadataDirty) { onBack(); return }
    Alert.alert(t('goalDetail.editor.discardTitle'), t('goalDetail.editor.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('goalDetail.editor.discard'), style: 'destructive', onPress: onBack },
    ])
  }
  const money = (value: number) => formatCurrency(value, { locale, currency: goal.currencyCode })
  const progress = goal.progressAvailable
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(goal.progressPercentage / 100)
    : t('goals.progressUnavailable')
  const date = goal.targetDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(goal.targetDate))
    : t('goalDetail.noTargetDate')

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
           <BackControl fallback="/goals" label={t('goalDetail.back')} onPress={requestBack} disabled={mutationPending} />
          {state.status === 'refresh-error' ? <Banner text={t('goalDetail.stale')} palette={palette} /> : null}
          {goalWriteUnknown ? <Banner text={t('goalDetail.reserve.unknown')} palette={palette} /> : null}

          <View style={styles.heading}>
            <View style={styles.titleLine}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>{goal.name}</Text>
              <View style={[styles.status, { borderColor: palette.border }]}>
                <View style={[styles.statusMarker, { backgroundColor: palette.mutedForeground }]} />
                <Text allowFontScaling style={[styles.statusText, { color: palette.mutedForeground }]}>{t(`goals.status.${goal.status}`)}</Text>
              </View>
            </View>
            <Text allowFontScaling style={[styles.date, { color: palette.mutedForeground }]}>{t('goalDetail.targetDate', { date })}</Text>
          </View>

          <View style={[styles.hero, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('goals.available')}</Text>
            <Text allowFontScaling style={[styles.heroAmount, { color: palette.foreground }]}>{money(goal.availableAmount)}</Text>
            <Text allowFontScaling style={[styles.target, { color: palette.mutedForeground }]}>{t('goals.ofTarget', { target: money(goal.targetAmount) })}</Text>
            <View style={[styles.progressTrack, { backgroundColor: palette.card }]}>
              <View testID="goal-detail-progress-fill" style={[styles.progressFill, { width: `${goal.meterPercentage}%`, backgroundColor: palette.chart1 }]} />
            </View>
            <Text allowFontScaling style={[styles.progressText, { color: palette.mutedForeground }]}>
              {goal.progressAvailable ? t('goals.progressValue', { value: progress }) : progress}{goal.overTarget ? ` · ${t('goals.overTarget')}` : ''}
            </Text>
          </View>

          <View style={styles.metrics}>
            <Metric label={t('goals.remaining')} value={money(goal.remainingToTarget)} palette={palette} />
            <Metric label={t('goals.assignedThisMonth')} value={money(goal.assignedThisMonth)} palette={palette} />
            <Metric label={t('goalDetail.requiredContribution')} value={goal.requiredMonthlyContribution === null ? t('goalDetail.notCalculated') : money(goal.requiredMonthlyContribution)} palette={palette} />
            <Metric label={t('goalDetail.shortfall')} value={goal.monthlyShortfall === null ? t('goalDetail.notCalculated') : money(goal.monthlyShortfall)} palette={palette} />
            <Metric label={t('goals.spent')} value={money(goal.spentAmount)} palette={palette} />
          </View>

          {goal.editable ? <ReserveEditor goal={goal} locale={locale} pending={mutationPending} disabled={mutationDisabled} isGoalWriteBlocked={isGoalWriteBlocked} onAssign={onAssign} onMoveOut={onMoveOut} palette={palette} /> : null}
          {goal.editable ? <MetadataEditor goal={goal} pending={mutationPending} disabled={mutationDisabled} onSave={onSaveMetadata} onDirtyChange={setMetadataDirty} palette={palette} /> : null}

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goals.linkedAccounts')}</Text>
            <Text allowFontScaling style={[styles.body, { color: palette.foreground }]}>
              {goal.linkedAccounts.length > 0
                ? goal.linkedAccounts.map(({ name }) => name ?? t('goals.unnamedAccount')).join(', ')
                : t('goals.noLinkedAccounts')}
            </Text>
            <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.accountsContext')}</Text>
            {goal.editable ? <AccountContextEditor goal={goal} state={accountContext} pending={mutationPending} disabled={mutationDisabled} isGoalWriteBlocked={isGoalWriteBlocked} onLink={onLinkAccount} onUnlink={onUnlinkAccount} palette={palette} /> : null}
          </View>

          {goal.editable ? <ArchiveSection goal={goal} pending={mutationPending} disabled={mutationDisabled} isGoalWriteBlocked={isGoalWriteBlocked} onArchive={onArchive} palette={palette} /> : null}

          <ActivitySection state={state} locale={locale} palette={palette} onLoadMore={onLoadMore} onRetry={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type ReserveAction = 'assign' | 'move-out'
type ReserveFailure = GoalWriteFailure | 'validation' | 'insufficient-reserve'

function classifyReserveFailure(error: unknown, action: ReserveAction): ReserveFailure {
  if (error instanceof ApiError && error.code === 'http' && error.status === 400) {
    return action === 'move-out' ? 'insufficient-reserve' : 'validation'
  }
  return classifyGoalWriteFailure(error)
}

function ReserveEditor({ goal, locale, pending, disabled, isGoalWriteBlocked, onAssign, onMoveOut, palette }: {
  goal: GoalDetailViewModel
  locale: string
  pending: boolean
  disabled: boolean
  isGoalWriteBlocked: GoalDetailScreenProps['isGoalWriteBlocked']
  onAssign: GoalDetailScreenProps['onAssign']
  onMoveOut: GoalDetailScreenProps['onMoveOut']
  palette: Palette
}) {
  const { t } = useTranslation()
  const [amountInput, setAmountInput] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ReserveFailure | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const requestConfirmation = (action: ReserveAction) => {
    if (disabled || confirming) return
    const amount = parseLocalizedGoalMoney(amountInput, locale)
    if (amount === null) { setFailure('validation'); return }
    if (action === 'move-out' && amount > goal.availableAmount) { setFailure('insufficient-reserve'); return }
    const frozen = { action, amount }
    const formattedAmount = formatCurrency(frozen.amount, { locale, currency: goal.currencyCode })
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
            setAnnouncement(t(`goalDetail.reserve.success.${frozen.action}`, { amount: formattedAmount, goal: goal.name }))
          }).catch((error) => setFailure(classifyReserveFailure(error, frozen.action))).finally(() => setConfirming(false))
        } },
      ],
      { cancelable: true, onDismiss: () => setConfirming(false) },
    )
  }

  return <View style={[styles.editor, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalDetail.reserve.title')}</Text>
    <Text style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.reserve.helper')}</Text>
    {failure ? <Text accessibilityRole="alert" style={[styles.notice, { borderColor: palette.destructive, color: palette.foreground }]}>{t(`goalDetail.reserve.failures.${failure}`)}</Text> : null}
    <Field label={t('goalDetail.reserve.amount')} hint={t('goalDetail.reserve.amountHint', { currency: goal.currencyCode })} value={amountInput} onChange={(value) => { setAmountInput(value); setFailure(null); setAnnouncement('') }} editable={!disabled && !confirming} money palette={palette} />
    <View style={styles.inlineActions}>
      <Button
        disabled={disabled || confirming || amountInput.trim() === ''}
        label={pending ? t('goalDetail.reserve.working') : t('goalDetail.reserve.assign')}
        onPress={() => requestConfirmation('assign')}
        palette={palette}
        variant="primary"
      />
      <Button
        disabled={disabled || confirming || amountInput.trim() === ''}
        label={t('goalDetail.reserve.move-out')}
        onPress={() => requestConfirmation('move-out')}
        palette={palette}
        variant="secondary"
      />
    </View>
    {announcement ? <Text accessibilityLiveRegion="polite" style={[styles.note, { color: palette.foreground }]}>{announcement}</Text> : null}
  </View>
}

function MetadataEditor({ goal, pending, disabled, onSave, onDirtyChange, palette }: { goal: GoalDetailViewModel; pending: boolean; disabled: boolean; onSave: GoalDetailScreenProps['onSaveMetadata']; onDirtyChange: (dirty: boolean) => void; palette: Palette }) {
  const { t } = useTranslation()
  const [name, setName] = useState(goal.name)
  const [target, setTarget] = useState(String(goal.targetAmount))
  const [monthly, setMonthly] = useState(goal.monthlyContributionTarget === null ? '' : String(goal.monthlyContributionTarget))
  const [failure, setFailure] = useState<GoalWriteFailure | 'validation' | null>(null)
  const authoritativeSignature = `${goal.name}\u0000${goal.targetAmount}\u0000${goal.monthlyContributionTarget ?? ''}`
  const previousAuthoritativeSignature = useRef(authoritativeSignature)
  const canonicalTarget = String(goal.targetAmount)
  const canonicalMonthly = goal.monthlyContributionTarget === null ? '' : String(goal.monthlyContributionTarget)
  const trimmedName = name.trim()
  const candidateTarget = parseMoneyInput(target)
  const candidateMonthly = monthly.trim() === '' ? null : parseMoneyInput(monthly)
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
    setTarget(String(goal.targetAmount))
    setMonthly(goal.monthlyContributionTarget === null ? '' : String(goal.monthlyContributionTarget))
    setFailure(null)
  }, [authoritativeSignature, goal.monthlyContributionTarget, goal.name, goal.targetAmount])

  const discard = useCallback(() => {
    setName(goal.name); setTarget(String(goal.targetAmount)); setMonthly(goal.monthlyContributionTarget === null ? '' : String(goal.monthlyContributionTarget)); setFailure(null)
  }, [goal.monthlyContributionTarget, goal.name, goal.targetAmount])
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty || disabled) return false
      Alert.alert(t('goalDetail.editor.discardTitle'), t('goalDetail.editor.discardMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('goalDetail.editor.discard'), style: 'destructive', onPress: discard },
      ])
      return true
    })
    return () => subscription.remove()
  }, [dirty, discard, disabled, t])

  const save = async () => {
    if (disabled || !rawChanged) return
    if (invalid) { setFailure('validation'); return }
    if (!changes) return
    if (!goalMetadataWriteSchema.safeParse(changes).success) { setFailure('validation'); return }
    setFailure(null)
    try { await onSave(changes) } catch (error) { setFailure(classifyGoalWriteFailure(error)) }
  }

  return <View style={[styles.editor, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalDetail.editor.title')}</Text>
    <Text style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.editor.helper')}</Text>
    {failure ? <Text accessibilityRole="alert" style={[styles.notice, { borderColor: palette.destructive, color: palette.foreground }]}>{t(`goalDetail.writeFailures.${failure}`)}</Text> : null}
    <Field label={t('goalDetail.editor.name')} value={name} onChange={(value) => { setName(value); setFailure(null) }} editable={!disabled} maxLength={100} palette={palette} />
    <Field label={t('goalDetail.editor.target')} value={target} onChange={(value) => { setTarget(value); setFailure(null) }} editable={!disabled} money palette={palette} />
    <Field label={t('goalDetail.editor.monthly')} hint={t('goalDetail.editor.monthlyHint')} value={monthly} onChange={(value) => { setMonthly(value); setFailure(null) }} editable={!disabled} money palette={palette} />
    <View style={styles.inlineActions}><Action label={pending ? t('goalDetail.editor.saving') : t('goalDetail.editor.save')} onPress={save} palette={palette} primary disabled={!saveEnabled} /><Action label={t('goalDetail.editor.discard')} onPress={discard} palette={palette} disabled={!dirty || disabled} /></View>
  </View>
}

function Field({ label, hint, value, onChange, editable, money = false, maxLength, palette }: { label: string; hint?: string; value: string; onChange: (value: string) => void; editable: boolean; money?: boolean; maxLength?: number; palette: Palette }) {
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} accessibilityHint={hint} editable={editable} keyboardType={money ? 'decimal-pad' : 'default'} maxLength={maxLength} value={value} onChangeText={onChange} style={[styles.input, money && styles.moneyInput, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />{hint ? <Text style={[styles.note, { color: palette.mutedForeground }]}>{hint}</Text> : null}</View>
}

function AccountContextEditor({ goal, state, pending, disabled, isGoalWriteBlocked, onLink, onUnlink, palette }: { goal: GoalDetailViewModel; state: GoalAccountContextState; pending: boolean; disabled: boolean; isGoalWriteBlocked: GoalDetailScreenProps['isGoalWriteBlocked']; onLink: GoalDetailScreenProps['onLinkAccount']; onUnlink: GoalDetailScreenProps['onUnlinkAccount']; palette: Palette }) {
  const { t } = useTranslation()
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

  return <View style={[styles.accountEditor, { borderColor: palette.border }]}>
    {failure ? <Text accessibilityRole="alert" style={[styles.notice, { borderColor: palette.destructive, color: palette.foreground }]}>{t(`goalDetail.writeFailures.${failure}`)}</Text> : null}
    {goal.linkedAccounts.map((account) => <View key={account.accountId} style={styles.accountRow}><Text style={[styles.body, { color: palette.foreground }]}>{account.name ?? t('goals.unnamedAccount')}</Text><Action label={t('goalDetail.accounts.unlinkNamed', { account: account.name ?? t('goals.unnamedAccount') })} onPress={() => confirmUnlink(account)} palette={palette} disabled={disabled} /></View>)}
    {state.status === 'loading' ? <Text accessibilityRole="progressbar" style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.accounts.loading')}</Text> : null}
    {state.status === 'error' || state.status === 'invalid-response' ? <Text accessibilityRole="alert" style={[styles.note, { color: palette.mutedForeground }]}>{t(`goalDetail.accounts.${state.status}`)}</Text> : null}
    {state.status === 'loaded' && available.length === 0 ? <Text style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.accounts.noneAvailable')}</Text> : null}
    {available.map((account) => <Pressable key={account.accountId} accessible accessibilityRole="radio" accessibilityLabel={account.name ?? t('goals.unnamedAccount')} accessibilityState={{ selected: selected === account.accountId, disabled }} disabled={disabled} onPress={() => setSelected(account.accountId)} style={[styles.accountChoice, { borderColor: selected === account.accountId ? palette.primary : palette.border, backgroundColor: selected === account.accountId ? palette.primarySoft : palette.background }]}><Text style={[styles.body, { color: palette.foreground }]}>{account.name ?? t('goals.unnamedAccount')}</Text></Pressable>)}
    {available.length > 0 ? <Action label={pending ? t('goalDetail.accounts.linking') : t('goalDetail.accounts.link')} onPress={link} palette={palette} primary disabled={selected === null || disabled} /> : null}
  </View>
}

function ArchiveSection({ goal, pending, disabled, isGoalWriteBlocked, onArchive, palette }: { goal: GoalDetailViewModel; pending: boolean; disabled: boolean; isGoalWriteBlocked: GoalDetailScreenProps['isGoalWriteBlocked']; onArchive: GoalDetailScreenProps['onArchive']; palette: Palette }) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<GoalWriteFailure | null>(null)
  const hasBalance = goal.availableAmount > 0

  const archive = () => {
    if (disabled || isGoalWriteBlocked()) return
    if (hasBalance) {
      Alert.alert(t('goalDetail.archive.balanceTitle'), t('goalDetail.archive.balanceMessage'))
      return
    }
    Alert.alert(t('goalDetail.archive.confirmTitle'), t('goalDetail.archive.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('goalDetail.archive.confirm'),
        style: 'destructive',
        onPress: () => {
          setFailure(null)
          void onArchive().catch((error) => setFailure(classifyGoalWriteFailure(error)))
        },
      },
    ])
  }

  return (
    <View style={[styles.section, styles.archiveSection, { borderColor: palette.destructive }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalDetail.archive.title')}</Text>
      <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>{t('goalDetail.archive.helper')}</Text>
      {failure ? <Text accessibilityRole="alert" style={[styles.notice, { borderColor: palette.destructive, color: palette.foreground }]}>{t(`goalDetail.writeFailures.${failure}`)}</Text> : null}
      <Action label={pending ? t('goalDetail.archive.archiving') : t('goalDetail.archive.action')} onPress={archive} palette={palette} disabled={disabled} />
    </View>
  )
}

function ActivitySection({ state, locale, palette, onLoadMore, onRetry }: {
  state: LoadedState
  locale: string
  palette: Palette
  onLoadMore: GoalDetailScreenProps['onLoadMore']
  onRetry: GoalDetailScreenProps['onRefresh']
}) {
  const { t } = useTranslation()
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalDetail.activity')}</Text>
        {state.activityStatus === 'loaded' ? <Text allowFontScaling style={[styles.count, { color: palette.mutedForeground }]}>{t('goalDetail.activityCount', { loaded: state.data.activities.length, total: state.data.totalActivities })}</Text> : null}
      </View>
      {state.activityStatus === 'loading' ? <Text accessibilityRole="progressbar" accessibilityLabel={t('goalDetail.activityLoading')} allowFontScaling style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('goalDetail.activityLoading')}</Text> : null}
      {state.activityStatus === 'error' ? (
        <View style={[styles.empty, { borderColor: palette.border }]}>
          <Text accessibilityRole="alert" allowFontScaling style={[styles.body, { color: palette.foreground }]}>{t('goalDetail.activityError')}</Text>
          <Action label={t('common.retry')} onPress={onRetry} palette={palette} />
        </View>
      ) : null}
      {state.activityStatus === 'loaded' && state.data.activities.length === 0 ? <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('goalDetail.activityEmpty')}</Text> : null}
      {state.activityStatus === 'loaded' && state.data.activities.length > 0 ? (
        <View style={[styles.activityList, { borderColor: palette.border }]}>
          {state.data.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} locale={locale} palette={palette} />)}
        </View>
      ) : null}
      {state.loadMoreError ? <Text accessibilityRole="alert" allowFontScaling style={[styles.note, { color: palette.destructive }]}>{t('goalDetail.loadMoreError')}</Text> : null}
      {state.hasMore ? <Action label={state.loadingMore ? t('goalDetail.loadingMore') : t('goalDetail.loadMore')} onPress={onLoadMore} palette={palette} disabled={state.loadingMore} /> : null}
    </View>
  )
}

function ActivityRow({ activity, locale, palette }: { activity: GoalActivityViewModel; locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.occurredAt))
  const amount = activity.amount === null ? null : formatCurrency(activity.amount, { locale, currency: activity.currencyCode })
  return (
    <View testID="goal-activity-row" accessible accessibilityLabel={[t(`goalDetail.activityType.${activity.type}`), date, amount, activity.note].filter(Boolean).join(', ')} style={[styles.activityRow, { borderBottomColor: palette.border }]}>
      <View style={styles.activityIdentity}>
        <Text allowFontScaling style={[styles.activityType, { color: palette.foreground }]}>{t(`goalDetail.activityType.${activity.type}`)}</Text>
        <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>{date}</Text>
        {activity.note ? <Text allowFontScaling style={[styles.note, { color: palette.mutedForeground }]}>{activity.note}</Text> : null}
      </View>
      {amount ? <Text allowFontScaling style={[styles.activityAmount, { color: palette.foreground }]}>{amount}</Text> : null}
    </View>
  )
}

function Metric({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.metric, { borderColor: palette.border, backgroundColor: palette.card }]}><Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.metricValue, { color: palette.foreground }]}>{value}</Text></View>
}

function Banner({ text, palette }: { text: string; palette: Palette }) {
  return <Text accessibilityRole="alert" allowFontScaling style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{text}</Text>
}

function Action({ label, onPress, palette, primary = false, disabled = false }: { label: string; onPress: () => void | Promise<unknown>; palette: Palette; primary?: boolean; disabled?: boolean }) {
  const [focused, setFocused] = useState(false)
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: disabled }} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => void onPress()} style={({ pressed }) => [styles.action, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, focused && { borderWidth: 2, borderColor: palette.foreground }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.actionLabel, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable>
}

function LoadingState({ palette, label, onBack }: { palette: Palette; label: string; onBack: () => void }) {
  const { t } = useTranslation()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.loading}><BackControl fallback="/goals" label={t('goalDetail.back')} onPress={onBack} /><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingBlocks}>{[120, 240, 320].map((width) => <View key={width} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}</View></View></SafeAreaView>
}

function FailureState({ state, palette, onBack, onRetry, onLogout }: { state: 'error' | 'not-found' | 'invalid-id' | 'invalid-response'; palette: Palette; onBack: () => void; onRetry: () => void | Promise<void>; onLogout: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const key = state === 'not-found' ? 'notFound' : state === 'invalid-id' ? 'invalidId' : state === 'invalid-response' ? 'invalidResponse' : 'error'
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><ScrollView contentContainerStyle={styles.centered}><View style={styles.failure}><View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} /><Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>{t(`goalDetail.${key}.title`)}</Text><Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{t(`goalDetail.${key}.message`)}</Text><View style={styles.actions}><BackControl fallback="/goals" label={t('goalDetail.back')} onPress={onBack} />{state === 'error' || state === 'invalid-response' ? <Action label={t('common.retry')} onPress={onRetry} palette={palette} primary /> : null}<Action label={t('common.signOut')} onPress={onLogout} palette={palette} /></View></View></ScrollView></SafeAreaView>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap },
  heading: { width: '100%', gap: themeTokens.spacing[2] }, titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, title: { ...textStyles.title, flexShrink: 1 }, date: { ...textStyles.body },
  status: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.sm, paddingHorizontal: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[1] }, statusMarker: { width: 6, height: 6, borderRadius: themeTokens.radius.pill }, statusText: { ...textStyles.meta, fontWeight: '500' as const },
  hero: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, heroAmount: { ...textStyles.display }, target: { ...textStyles.body }, progressTrack: { width: '100%', height: 4, marginTop: themeTokens.spacing[2], borderRadius: themeTokens.radius.pill, overflow: 'hidden' }, progressFill: { height: '100%', borderRadius: themeTokens.radius.pill }, progressText: { ...textStyles.meta },
  metrics: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, metric: { flexGrow: 1, flexBasis: 210, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] }, label: { ...textStyles.meta }, metricValue: { ...textStyles.amount },
  section: { width: '100%', gap: themeTokens.spacing[3] }, archiveSection: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] }, sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[2] }, sectionTitle: { ...textStyles.section }, count: { ...textStyles.amountSmall }, body: { ...textStyles.body }, note: { ...textStyles.label },
  editor: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, field: { gap: themeTokens.spacing[2] }, fieldLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, moneyInput: { fontFamily: themeTokens.typography.roles.data.fontFamily }, inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, notice: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
  accountEditor: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, accountRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, accountChoice: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  activityList: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, paddingHorizontal: themeTokens.spacing[4] }, activityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: themeTokens.spacing[3] }, activityIdentity: { flex: 1, gap: themeTokens.spacing[1] }, activityType: { ...textStyles.action }, activityAmount: { ...textStyles.amount },
  empty: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, banner: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, actionLabel: { ...textStyles.action }, pressed: { opacity: 0.72 },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] }, loadingBlocks: { gap: themeTokens.spacing[4] }, skeleton: { height: 72, maxWidth: '100%', borderRadius: themeTokens.radius.lg }, centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding }, failure: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: themeTokens.spacing[4] }, errorMarker: { width: 36, height: 2 }, failureTitle: { ...textStyles.title }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})
