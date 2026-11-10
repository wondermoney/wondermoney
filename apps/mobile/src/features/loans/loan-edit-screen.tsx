import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatNumberInput, toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { basisPointsToPercent, percentToBasisPoints } from '@/lib/formatters/interest-rate'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { loanNumberErrors } from './loan-form-rows'
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
  /** The loan's currency (ISO code), shown on the principal; it can't be changed here. */
  currencyCode?: string | null
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
  const palette = usePalette()
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar closeLabel={t('common.close')} onClose={props.onBack} title={t('loanEdit.title')} />
        <View accessibilityLabel={t('loanEdit.loading')} accessibilityRole="progressbar" style={styles.center}><Text tone="muted" variant="meta">{t('loanEdit.loading')}</Text></View>
      </SafeAreaView>
    )
  }
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') return <EditFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} />
  return <LoanEditForm key={props.state.model.id} {...props} model={props.state.model} stale={props.state.status === 'refresh-error'} />
}

/**
 * Edit loan, as a calm-structure flow: the form bar (close, save details),
 * the opening principal big and centred, the details as one group of rows,
 * then the net worth switch on its own, which saves through its own
 * confirmation rather than the ✓.
 */
function LoanEditForm({ model, stale, onBack, onSaveLoan, onRefreshAuthoritative, pending, refreshRequired }: Omit<Props, 'state' | 'onRetry'> & { model: LoanEditModel; stale: boolean }) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // Read in the app's language ("1.234,56" in pt and es), then compared and sent as dot decimals.
  const decimal = (value: string) => toWireDecimalInput(value, locale)
  const [saved, setSaved] = useState<LoanEditModel>(model)
  const [name, setName] = useState(model.name)
  const [providerName, setProviderName] = useState(model.providerName ?? '')
  const [notes, setNotes] = useState(model.notes ?? '')
  const [type, setType] = useState<LoanType>(model.type)
  const [openingPrincipalBalance, setOpeningPrincipalBalance] = useState(() => formatNumberInput(model.openingPrincipalBalance, locale))
  const [openingBalanceDate, setOpeningBalanceDate] = useState(model.openingBalanceDate)
  const [regularPaymentAmount, setRegularPaymentAmount] = useState(model.regularPaymentAmount === null ? '' : formatNumberInput(model.regularPaymentAmount, locale))
  const [annualInterestRateBps, setAnnualInterestRateBps] = useState(model.annualInterestRateBps === null ? '' : formatNumberInput(basisPointsToPercent(model.annualInterestRateBps), locale))
  const [termMonths, setTermMonths] = useState(model.termMonths === null ? '' : String(model.termMonths))
  const [includeInNetWorth, setIncludeInNetWorth] = useState(model.includeInNetWorth)
  const [confirmationTarget, setConfirmationTarget] = useState<boolean | null>(null)
  const [refreshingAuthoritative, setRefreshingAuthoritative] = useState(false)
  const [failure, setFailure] = useState<LoanWriteFailure | null>(null)
  const typed = { openingPrincipalBalance: decimal(openingPrincipalBalance), regularPaymentAmount: decimal(regularPaymentAmount), annualInterestRateBps: decimal(annualInterestRateBps), termMonths }
  const changes = createLoanMetadataChanges(saved, { name, providerName, notes, type, openingBalanceDate, ...typed })
  const inclusionDirty = includeInNetWorth !== saved.includeInNetWorth
  const dirty = changes !== null || inclusionDirty
  const locked = pending || refreshingAuthoritative
  const inclusionLocked = locked || refreshRequired || stale
  const fieldsLocked = locked || refreshRequired
  const numbers = loanNumberErrors(typed)
  const nameError = name === '' ? t('loanCreate.fieldErrors.name') : null
  const dateError = openingBalanceDate.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(openingBalanceDate.trim()) ? t('loanCreate.fieldErrors.startDate') : undefined
  const valid = changes !== null && loanWriteSchema.safeParse(changes).success && !numbers.principal && !numbers.installment && !numbers.rate && !numbers.term

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
    if (!changes || !valid || locked || refreshRequired) return
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

  const refreshAction = <Button disabled={locked} label={refreshingAuthoritative ? t('loanEdit.refreshing') : t('loanEdit.refreshAuthoritative')} loading={refreshingAuthoritative} onPress={() => void refreshAuthoritative()} size="sm" variant="secondary" />

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={() => void requestExit()}
        onSave={() => void saveMetadata()}
        saveDisabled={!valid || locked || refreshRequired}
        saveLabel={pending && confirmationTarget === null ? t('loanEdit.saving') : t('loanEdit.saveDetails')}
        saving={pending && confirmationTarget === null}
        title={t('loanEdit.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
          <View style={styles.page}>
            {stale && !refreshRequired ? <Notice action={refreshAction} message={t('loanEdit.stale')} /> : null}
            {failure ? <Notice message={t(`loanEdit.failures.${failure}`)} tone="destructive" /> : null}
            {refreshRequired ? <Notice action={refreshAction} message={t('loanEdit.refreshRequired')} tone="destructive" /> : null}
            <AmountEntry
              accessibilityLabel={t('loanEdit.principal')}
              caption={t('loanEdit.principal')}
              currency={model.currencyCode ?? null}
              editable={!fieldsLocked}
              error={numbers.principal ? t('loanCreate.fieldErrors.principal') : null}
              locale={locale}
              onChangeText={setOpeningPrincipalBalance}
              value={openingPrincipalBalance}
            />
            <View style={styles.section}>
              <Text accessibilityRole="header" variant="heading">{t('loanEdit.detailsTitle')}</Text>
              <FormGroup>
                <FormTextRow key="name" accessibilityHint={t('loanEdit.nameHint')} editable={!fieldsLocked} error={nameError} label={t('loanEdit.name')} maxLength={255} onChangeText={setName} returnKeyType="next" value={name} />
                <FormTextRow key="provider" accessibilityHint={t('loanEdit.providerHint')} editable={!fieldsLocked} label={t('loanEdit.provider')} maxLength={255} onChangeText={setProviderName} placeholder={t('loanCreate.optional')} returnKeyType="next" value={providerName} />
                <FormSelectRow key="type" disabled={fieldsLocked} label={t('loanEdit.type')} onChange={setType} options={CREDIT_TYPES.map((item) => ({ value: item, label: t(`loans.type.${item}`) }))} placeholder={t('loanCreate.choose')} value={type} />
                <DateField key="date" appearance="row" disabled={fieldsLocked} error={dateError} label={t('loanEdit.startDate')} onChange={(value) => setOpeningBalanceDate(value ?? '')} value={openingBalanceDate || null} />
                <FormTextRow key="installment" accessibilityLabel={t('loanEdit.installmentOptional')} editable={!fieldsLocked} error={numbers.installment ? t('loanCreate.fieldErrors.installment') : null} keyboardType="decimal-pad" label={t('loanCreate.installment')} onChangeText={setRegularPaymentAmount} placeholder={t('loanCreate.optional')} value={regularPaymentAmount} />
                <FormTextRow key="rate" accessibilityLabel={t('loanEdit.interestRateOptional')} editable={!fieldsLocked} error={numbers.rate ? t('loanCreate.fieldErrors.interestRate') : null} keyboardType="decimal-pad" label={t('loanCreate.interestRate')} onChangeText={setAnnualInterestRateBps} placeholder={t('loanCreate.optional')} value={annualInterestRateBps} />
                <FormTextRow key="term" accessibilityLabel={t('loanEdit.termMonthsOptional')} editable={!fieldsLocked} error={numbers.term ? t('loanCreate.fieldErrors.termMonths') : null} keyboardType="number-pad" label={t('loanCreate.termMonths')} onChangeText={setTermMonths} placeholder={t('loanCreate.optional')} value={termMonths} />
                <FormTextRow key="notes" accessibilityHint={t('loanEdit.notesHint')} editable={!fieldsLocked} label={t('loanEdit.notes')} maxLength={10_000} multiline onChangeText={setNotes} placeholder={t('loanCreate.optional')} value={notes} />
              </FormGroup>
            </View>
            <View style={styles.section}>
              <Text accessibilityRole="header" variant="heading">{t('loanEdit.netWorthTitle')}</Text>
              <FormGroup>
                <FormSwitchRow
                  accessibilityHint={t('loanEdit.netWorthHint')}
                  accessibilityLabel={t('loanEdit.netWorthSwitch')}
                  disabled={inclusionLocked || confirmationTarget !== null}
                  hint={t('loanEdit.netWorthHelper')}
                  label={t('loanCreate.includeInNetWorth')}
                  onValueChange={stageInclusion}
                  value={includeInNetWorth}
                />
              </FormGroup>
              {confirmationTarget !== null ? (
                <Notice
                  action={(
                    <View style={styles.actions}>
                      <Button disabled={locked} label={t('common.cancel')} onPress={cancelInclusion} size="sm" variant="secondary" />
                      <Button disabled={inclusionLocked} label={pending ? t('loanEdit.saving') : t('loanEdit.netWorthConfirm')} loading={pending} onPress={() => void saveInclusion()} size="sm" />
                    </View>
                  )}
                  message={t(confirmationTarget ? 'loanEdit.netWorthConfirmInclude' : 'loanEdit.netWorthConfirmExclude')}
                  title={t('loanEdit.netWorthConfirmTitle')}
                />
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function EditFailure({ status, onBack, onRetry }: { status: Exclude<LoanEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const canRetry = status !== 'invalid-route'
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('loanEdit.title')} />
      <View style={styles.center}>
        <Text accessibilityRole="header" variant="heading">{t(`loanEdit.states.${status}Title`)}</Text>
        <Text tone="muted" variant="meta">{t(`loanEdit.states.${status}Message`)}</Text>
        {canRetry ? <Button label={t('common.retry')} onPress={() => void onRetry()} /> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  section: { gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[4] },
  center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
