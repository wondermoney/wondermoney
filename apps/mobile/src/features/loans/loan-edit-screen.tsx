import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { basisPointsToPercent, percentToBasisPoints } from '@/lib/formatters/interest-rate'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { BackControl } from '@/components/ui/back-control'

import { loanWriteSchema, type LoanType, type LoanWrite } from './loans-contract'
import { classifyLoanWriteFailure, type LoanWriteFailure } from './use-loan-metadata-mutation'

const CREDIT_TYPES: readonly LoanType[] = ['MORTGAGE', 'AUTO_LOAN', 'PERSONAL_LOAN', 'STUDENT_LOAN', 'OTHER']

export type LoanEditModel = Readonly<{
  id: number
  name: string
  providerName: string | null
  notes: string | null
  includeInNetWorth: boolean
  type: LoanType
  openingPrincipalBalance: number
  openingBalanceDate: string
  regularPaymentAmount: number | null
  annualInterestRateBps: number | null
  termMonths: number | null
}>

export type LoanEditViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-route' }
  | { status: 'loaded' | 'refresh-error'; model: LoanEditModel; refreshing?: boolean }

type Props = Readonly<{
  state: LoanEditViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSaveLoan: (value: LoanWrite) => Promise<void>
  onRefreshAuthoritative: () => Promise<LoanEditModel | null>
  pending: boolean
  refreshRequired: boolean
}>


export function createLoanMetadataChanges(
  original: Pick<LoanEditModel, 'name' | 'providerName' | 'notes' | 'type' | 'openingPrincipalBalance' | 'openingBalanceDate' | 'regularPaymentAmount' | 'annualInterestRateBps' | 'termMonths'>,
  current: { name: string; providerName: string; notes: string; type: LoanType; openingPrincipalBalance: string; openingBalanceDate: string; regularPaymentAmount: string; annualInterestRateBps: string; termMonths: string },
): LoanWrite | null {
  const changes: LoanWrite = {}
  if (current.name !== original.name) changes.name = current.name
  if (current.providerName !== (original.providerName ?? '')) changes.providerName = current.providerName
  if (current.notes !== (original.notes ?? '')) changes.notes = current.notes
  if (current.type !== original.type) changes.type = current.type
  // Optional numeric fields can't be cleared via PATCH (baseLoanSchema keeps them optional, not
  // nullable) — blanking one back to empty is treated as a no-op rather than an unsendable "clear".
  if (current.openingPrincipalBalance.trim() !== '' && current.openingPrincipalBalance !== String(original.openingPrincipalBalance)) {
    changes.openingPrincipalBalance = Number(current.openingPrincipalBalance)
  }
  if (current.openingBalanceDate.trim() !== '' && current.openingBalanceDate !== original.openingBalanceDate) {
    changes.openingBalanceDate = current.openingBalanceDate
  }
  const originalRegular = original.regularPaymentAmount === null ? '' : String(original.regularPaymentAmount)
  if (current.regularPaymentAmount.trim() !== '' && current.regularPaymentAmount !== originalRegular) {
    changes.regularPaymentAmount = Number(current.regularPaymentAmount)
  }
  // The stored value is basis points; the field shows a percentage, so the
  // comparison has to happen in the same unit or every save looks like a change.
  const originalRate = original.annualInterestRateBps === null ? '' : String(basisPointsToPercent(original.annualInterestRateBps))
  if (current.annualInterestRateBps.trim() !== '' && current.annualInterestRateBps !== originalRate) {
    changes.annualInterestRateBps = percentToBasisPoints(Number(current.annualInterestRateBps))
  }
  const originalTerm = original.termMonths === null ? '' : String(original.termMonths)
  if (current.termMonths.trim() !== '' && current.termMonths !== originalTerm) {
    changes.termMonths = Number(current.termMonths)
  }
  return Object.keys(changes).length > 0 ? changes : null
}

const confirmDiscard = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export function LoanEditScreen(props: Props) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View accessibilityRole="progressbar" accessibilityLabel={t('loanEdit.loading')} style={styles.center}><Text style={{ color: palette.foreground }}>{t('loanEdit.loading')}</Text></View></SafeAreaView>
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') return <EditFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} palette={palette} />
  return <LoanEditForm key={props.state.model.id} {...props} model={props.state.model} stale={props.state.status === 'refresh-error'} palette={palette} />
}

function LoanEditForm({ model, stale, onBack, onSaveLoan, onRefreshAuthoritative, pending, refreshRequired, palette }: Omit<Props, 'state' | 'onRetry'> & { model: LoanEditModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<LoanEditModel>(model)
  const [name, setName] = useState(model.name)
  const [providerName, setProviderName] = useState(model.providerName ?? '')
  const [notes, setNotes] = useState(model.notes ?? '')
  const [type, setType] = useState<LoanType>(model.type)
  const [openingPrincipalBalance, setOpeningPrincipalBalance] = useState(String(model.openingPrincipalBalance))
  const [openingBalanceDate, setOpeningBalanceDate] = useState(model.openingBalanceDate)
  const [regularPaymentAmount, setRegularPaymentAmount] = useState(model.regularPaymentAmount === null ? '' : String(model.regularPaymentAmount))
  const [annualInterestRateBps, setAnnualInterestRateBps] = useState(model.annualInterestRateBps === null ? '' : String(basisPointsToPercent(model.annualInterestRateBps)))
  const [termMonths, setTermMonths] = useState(model.termMonths === null ? '' : String(model.termMonths))
  const [includeInNetWorth, setIncludeInNetWorth] = useState(model.includeInNetWorth)
  const [confirmationTarget, setConfirmationTarget] = useState<boolean | null>(null)
  const [refreshingAuthoritative, setRefreshingAuthoritative] = useState(false)
  const [failure, setFailure] = useState<LoanWriteFailure | null>(null)
  const changes = createLoanMetadataChanges(saved, { name, providerName, notes, type, openingPrincipalBalance, openingBalanceDate, regularPaymentAmount, annualInterestRateBps, termMonths })
  const inclusionDirty = includeInNetWorth !== saved.includeInNetWorth
  const dirty = changes !== null || inclusionDirty
  const locked = pending || refreshingAuthoritative
  const inclusionLocked = locked || refreshRequired || stale

  const requestExit = async () => {
    if (locked) return
    if (!dirty || await confirmDiscard(t('loanEdit.discardTitle'), t('loanEdit.discardMessage'), t('common.cancel'), t('loanEdit.discard'))) onBack()
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void requestExit()
      return true
    })
    return () => subscription.remove()
  })

  const saveMetadata = async () => {
    if (!changes || locked || refreshRequired) return
    if (!loanWriteSchema.safeParse(changes).success) { setFailure('invalid'); return }
    setFailure(null)
    try {
      await onSaveLoan(changes)
      setSaved((current) => ({ ...current, ...changes }))
    } catch (error) {
      setFailure(classifyLoanWriteFailure(error))
    }
  }

  const stageInclusion = (target: boolean) => {
    if (inclusionLocked || confirmationTarget !== null || target === saved.includeInNetWorth) return
    setFailure(null)
    setIncludeInNetWorth(target)
    setConfirmationTarget(target)
  }

  const cancelInclusion = () => {
    if (locked) return
    setIncludeInNetWorth(saved.includeInNetWorth)
    setConfirmationTarget(null)
  }

  const saveInclusion = async () => {
    if (confirmationTarget === null || inclusionLocked) return
    const frozenTarget = confirmationTarget
    const value: LoanWrite = { includeInNetWorth: frozenTarget }
    if (!loanWriteSchema.safeParse(value).success) { setFailure('invalid'); return }
    setFailure(null)
    try {
      await onSaveLoan(value)
      setSaved((current) => ({ ...current, includeInNetWorth: frozenTarget }))
      setIncludeInNetWorth(frozenTarget)
      setConfirmationTarget(null)
    } catch (error) {
      setFailure(classifyLoanWriteFailure(error))
    }
  }

  const refreshAuthoritative = async () => {
    if (locked) return
    const preserveInclusionIntent = confirmationTarget !== null || inclusionDirty
    setRefreshingAuthoritative(true)
    try {
      const authoritative = await onRefreshAuthoritative()
      if (!authoritative) return
      setSaved(authoritative)
      setFailure(null)
      if (!preserveInclusionIntent) {
        setIncludeInNetWorth(authoritative.includeInNetWorth)
        setConfirmationTarget(null)
      } else if (includeInNetWorth === authoritative.includeInNetWorth) {
        setConfirmationTarget(null)
      }
    } finally {
      setRefreshingAuthoritative(false)
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BackControl fallback="/loans" onPress={() => void requestExit()} color={palette.primary} disabled={locked} />
          <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('loanEdit.title')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('loanEdit.helper')}</Text></View>
          {stale && !refreshRequired ? <View style={[styles.noticeBox, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.helper, { color: palette.foreground }]}>{t('loanEdit.stale')}</Text><Button label={refreshingAuthoritative ? t('loanEdit.refreshing') : t('loanEdit.refreshAuthoritative')} disabled={locked} busy={refreshingAuthoritative} onPress={refreshAuthoritative} palette={palette} secondary /></View> : null}
          {failure ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`loanEdit.failures.${failure}`)}</Text> : null}
          {refreshRequired ? <View style={[styles.noticeBox, { borderColor: palette.destructive, backgroundColor: palette.card }]}><Text accessibilityRole="alert" style={[styles.helper, { color: palette.foreground }]}>{t('loanEdit.refreshRequired')}</Text><Button label={refreshingAuthoritative ? t('loanEdit.refreshing') : t('loanEdit.refreshAuthoritative')} disabled={locked} busy={refreshingAuthoritative} onPress={refreshAuthoritative} palette={palette} secondary /></View> : null}
          <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('loanEdit.detailsTitle')}</Text>
            <FieldLabel text={t('loanEdit.name')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.name')} accessibilityHint={t('loanEdit.nameHint')} editable={!locked && !refreshRequired} maxLength={255} value={name} onChangeText={setName} returnKeyType="next" style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <CharacterCount count={name.length} max={255} palette={palette} />
            <FieldLabel text={t('loanEdit.provider')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.provider')} accessibilityHint={t('loanEdit.providerHint')} editable={!locked && !refreshRequired} maxLength={255} value={providerName} onChangeText={setProviderName} returnKeyType="next" style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <CharacterCount count={providerName.length} max={255} palette={palette} />
            <FieldLabel text={t('loanEdit.type')} palette={palette} />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('loanEdit.type')} style={styles.choices}>
              {CREDIT_TYPES.map((item) => <TypeChoice key={item} label={t(`loans.type.${item}`)} selected={type === item} disabled={locked || refreshRequired} onPress={() => setType(item)} palette={palette} />)}
            </View>
            <FieldLabel text={t('loanEdit.principal')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.principal')} editable={!locked && !refreshRequired} keyboardType="decimal-pad" value={openingPrincipalBalance} onChangeText={setOpeningPrincipalBalance} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <FieldLabel text={t('loanEdit.startDate')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.startDate')} accessibilityHint={t('loanEdit.startDatePlaceholder')} editable={!locked && !refreshRequired} maxLength={10} value={openingBalanceDate} onChangeText={setOpeningBalanceDate} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <FieldLabel text={t('loanEdit.installmentOptional')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.installmentOptional')} editable={!locked && !refreshRequired} keyboardType="decimal-pad" value={regularPaymentAmount} onChangeText={setRegularPaymentAmount} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <FieldLabel text={t('loanEdit.interestRateOptional')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.interestRateOptional')} editable={!locked && !refreshRequired} keyboardType="decimal-pad" value={annualInterestRateBps} onChangeText={setAnnualInterestRateBps} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <FieldLabel text={t('loanEdit.termMonthsOptional')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.termMonthsOptional')} editable={!locked && !refreshRequired} keyboardType="number-pad" value={termMonths} onChangeText={setTermMonths} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <FieldLabel text={t('loanEdit.notes')} palette={palette} />
            <TextInput accessibilityLabel={t('loanEdit.notes')} accessibilityHint={t('loanEdit.notesHint')} editable={!locked && !refreshRequired} maxLength={10_000} multiline value={notes} onChangeText={setNotes} style={[styles.input, styles.textarea, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <CharacterCount count={notes.length} max={10_000} palette={palette} />
            <Button label={pending ? t('loanEdit.saving') : t('loanEdit.saveDetails')} disabled={!changes || locked || refreshRequired} busy={pending} onPress={saveMetadata} palette={palette} />
          </View>
          <View style={[styles.panel, styles.netWorthPanel, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.switchCopy}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('loanEdit.netWorthTitle')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('loanEdit.netWorthHelper')}</Text></View>
            <Switch accessibilityRole="switch" accessibilityLabel={t('loanEdit.netWorthSwitch')} accessibilityHint={t('loanEdit.netWorthHint')} accessibilityState={{ disabled: inclusionLocked || confirmationTarget !== null, checked: includeInNetWorth }} disabled={inclusionLocked || confirmationTarget !== null} value={includeInNetWorth} onValueChange={stageInclusion} trackColor={{ false: palette.muted, true: palette.primary }} />
            {confirmationTarget !== null ? <View style={[styles.confirmation, { borderColor: palette.primary, backgroundColor: palette.background }]}><Text accessibilityRole="header" style={[styles.label, { color: palette.foreground }]}>{t('loanEdit.netWorthConfirmTitle')}</Text><Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t(confirmationTarget ? 'loanEdit.netWorthConfirmInclude' : 'loanEdit.netWorthConfirmExclude')}</Text><View style={styles.confirmActions}><Button label={t('common.cancel')} disabled={locked} busy={false} onPress={cancelInclusion} palette={palette} secondary /><Button label={pending ? t('loanEdit.saving') : t('loanEdit.netWorthConfirm')} disabled={inclusionLocked} busy={pending} onPress={saveInclusion} palette={palette} /></View></View> : null}
          </View>
          <Button label={t('common.cancel')} disabled={locked} busy={false} onPress={requestExit} palette={palette} secondary />
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function FieldLabel({ text, palette }: { text: string; palette: Palette }) {
  return <Text style={[styles.label, { color: palette.foreground }]}>{text}</Text>
}

function TypeChoice({ label, selected, disabled, onPress, palette }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; palette: Palette }) {
  return <Pressable accessibilityRole="radio" hitSlop={{ top: 7, bottom: 7 }} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }, disabled && styles.disabled]}><Text style={[styles.choiceText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text></Pressable>
}

function CharacterCount({ count, max, palette }: { count: number; max: number; palette: Palette }) {
  const { t } = useTranslation()
  return <Text style={[styles.limit, { color: palette.mutedForeground }]}>{t('loanEdit.characterCount', { count, max })}</Text>
}

function Button({ label, disabled, busy, onPress, palette, secondary = false }: { label: string; disabled: boolean; busy: boolean; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={[styles.button, { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary }, disabled && styles.disabled]}><Text style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{label}</Text></Pressable>
}

function EditFailure({ status, onBack, onRetry, palette }: { status: Exclude<LoanEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const canRetry = status !== 'invalid-route'
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.center}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(`loanEdit.states.${status}Title`)}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`loanEdit.states.${status}Message`)}</Text>{canRetry ? <Button label={t('common.retry')} disabled={false} busy={false} onPress={onRetry} palette={palette} /> : null}<BackControl fallback="/loans" label={t('loanEdit.back')} onPress={onBack} disabled={false} /></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, keyboard: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  back: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', alignSelf: 'flex-start' }, backText: { ...textStyles.action }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title, fontWeight: '700' as const }, helper: { ...textStyles.body },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, netWorthPanel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }, switchCopy: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1], paddingRight: themeTokens.spacing[4] }, confirmation: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, confirmActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[2] }, sectionTitle: { ...textStyles.section, fontWeight: '700' as const }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const, marginTop: themeTokens.spacing[2] }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, textarea: { minHeight: 132, paddingTop: themeTokens.spacing[3], textAlignVertical: 'top' }, limit: { ...textStyles.amountSmall, alignSelf: 'flex-end' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choiceText: { ...textStyles.meta },
  button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], alignItems: 'center', justifyContent: 'center', marginTop: themeTokens.spacing[2] }, buttonText: { ...textStyles.action, fontWeight: '700' as const }, disabled: { opacity: 0.45 }, notice: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, noticeBox: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
})
