import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text as UiText } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { canWriteAccount } from './account-access'
import {
  buildAccountSharesWrite,
  initialShareChoices,
  shareChoicesDiffer,
  type AccountSharesWrite,
  type ShareChoice,
  type ShareChoices,
} from './account-sharing-contract'
import { AccountSharingPlaceholder, AccountSharingSection, type AccountSharingViewState } from './account-sharing-section'
import {
  accountUpdateWriteSchema,
  creditCardWriteSchema,
  type AccountAccess,
  type AccountUpdateWrite,
  type CreditCardSettingsDto,
  type CreditCardWrite,
} from './accounts-contract'
import { LoadingState } from './screen-states'
import { classifyAccountDeleteFailure, type AccountDeleteFailure } from './use-account-delete-mutation'
import { classifyAccountWriteFailure, type AccountWriteFailure } from './use-account-metadata-mutation'
import { classifyAccountSharingFailure, type AccountSharingFailure } from './use-account-shares'

export type AccountEditModel = Readonly<{
  id: number
  name: string
  isPrivate: boolean
  isOwnedByViewer: boolean
  /** The card's cycle and limit, or null when the account is not a credit card. */
  creditCard?: CreditCardSettingsDto | null
  /** The caller's access. `read`: the account's details can't change; only its sharing shows. */
  myAccess?: AccountAccess
}>

export type AccountEditViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-id' }
  | { status: 'loaded' | 'refresh-error'; model: AccountEditModel; refreshing?: boolean }

type Props = Readonly<{
  state: AccountEditViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSaveAccount: (value: AccountUpdateWrite) => Promise<void>
  onSaveCreditCard: (value: CreditCardWrite) => Promise<void>
  onDeleteAccount: () => Promise<void>
  pending: boolean
  creditCardPending: boolean
  deletePending: boolean
  /**
   * Who sees the account (#95). Omitted or `unsupported` (an API from before per-member sharing),
   * the owner keeps the private switch, saved with the name.
   */
  sharing?: AccountSharingViewState
  /** `PUT /v1/account/:id/shares`, with the body the per-member control maps to. */
  onSaveSharing?: (value: AccountSharesWrite) => Promise<void>
  onRetrySharing?: () => void
  sharingPending?: boolean
}>


export type CreditCardForm = Readonly<{
  enabled: boolean
  statementCloseDay: string
  paymentDueDay: string
  creditLimit: string
  minimumPaymentPercent: string
}>

const optionalNumber = (value: string): null | number => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/**
 * The card settings to send, or null when there is nothing to change. A card cannot be un-marked:
 * there is no endpoint that removes the cycle, so turning the switch off sends nothing.
 */
export function createCreditCardChanges(
  original: CreditCardSettingsDto | null,
  form: CreditCardForm,
): CreditCardWrite | null {
  if (!form.enabled) return null
  const next: CreditCardWrite = {
    statementCloseDay: Number(form.statementCloseDay),
    paymentDueDay: Number(form.paymentDueDay),
    creditLimit: optionalNumber(form.creditLimit),
    minimumPaymentPercent: optionalNumber(form.minimumPaymentPercent),
  }
  if (!original) return next
  const unchanged = original.statementCloseDay === next.statementCloseDay
    && original.paymentDueDay === next.paymentDueDay
    && (original.creditLimit ?? null) === (next.creditLimit ?? null)
    && (original.minimumPaymentPercent ?? null) === (next.minimumPaymentPercent ?? null)
  return unchanged ? null : next
}

export function createAccountMetadataChanges(
  original: Pick<AccountEditModel, 'name' | 'isPrivate' | 'isOwnedByViewer'>,
  current: { name: string; isPrivate: boolean },
): AccountUpdateWrite | null {
  const changes: AccountUpdateWrite = {}
  if (current.name !== original.name) changes.accountName = current.name
  if (original.isOwnedByViewer && current.isPrivate !== original.isPrivate) changes.isPrivate = current.isPrivate
  return Object.keys(changes).length > 0 ? changes : null
}

const confirmDiscard = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export function AccountEditScreen(props: Props) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') return <LoadingState label={t('accountEdit.loading')} />
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') return <EditFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} palette={palette} />
  return <AccountEditForm key={props.state.model.id} {...props} model={props.state.model} stale={props.state.status === 'refresh-error'} palette={palette} />
}

function AccountEditForm({ model, stale, onBack, onSaveAccount, onSaveCreditCard, onDeleteAccount, pending, creditCardPending, deletePending, sharing = { status: 'unsupported' }, onSaveSharing, onRetrySharing, sharingPending = false, palette }: Omit<Props, 'state' | 'onRetry'> & { model: AccountEditModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  // A member who can only view the account sees its sharing and nothing to change on it.
  const readOnly = !canWriteAccount(model)
  // An older API has no per-member sharing: the owner's private switch is saved with the name.
  const legacyPrivacy = sharing.status === 'unsupported'
  const shares = sharing.status === 'loaded' ? sharing.shares : null
  const [shareOverrides, setShareOverrides] = useState<ShareChoices>({})
  const [privateOverride, setPrivateOverride] = useState<boolean | null>(null)
  const [sharingFailure, setSharingFailure] = useState<AccountSharingFailure | null>(null)
  const initialChoices = shares ? initialShareChoices(shares) : {}
  const choices: ShareChoices = { ...initialChoices, ...shareOverrides }
  const privateToggle = privateOverride ?? shares?.isPrivate ?? false
  const sharingEditable = Boolean(shares?.canManage && onSaveSharing)
  const sharingChanges = shares && sharingEditable && (shareChoicesDiffer(shares, initialChoices, choices) || privateToggle !== shares.isPrivate)
    ? buildAccountSharesWrite(shares, choices, privateToggle)
    : null
  const [saved, setSaved] = useState(model)
  const [name, setName] = useState(model.name)
  const [isPrivate, setIsPrivate] = useState(model.isPrivate)
  const [cardEnabled, setCardEnabled] = useState(Boolean(model.creditCard))
  const [statementCloseDay, setStatementCloseDay] = useState(String(model.creditCard?.statementCloseDay ?? 1))
  const [paymentDueDay, setPaymentDueDay] = useState(String(model.creditCard?.paymentDueDay ?? 1))
  const [creditLimit, setCreditLimit] = useState(model.creditCard?.creditLimit == null ? '' : String(model.creditCard.creditLimit))
  const [minimumPaymentPercent, setMinimumPaymentPercent] = useState(model.creditCard?.minimumPaymentPercent == null ? '' : String(model.creditCard.minimumPaymentPercent))
  const [failure, setFailure] = useState<AccountWriteFailure | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<AccountDeleteFailure | null>(null)
  const changes = readOnly ? null : createAccountMetadataChanges(saved, { name, isPrivate: legacyPrivacy ? isPrivate : saved.isPrivate })
  const cardForm: CreditCardForm = { creditLimit, enabled: cardEnabled, minimumPaymentPercent, paymentDueDay, statementCloseDay }
  const cardChanges = readOnly ? null : createCreditCardChanges(saved.creditCard ?? null, cardForm)
  const dirty = changes !== null || cardChanges !== null || sharingChanges !== null
  const locked = pending || creditCardPending || deletePending || sharingPending
  const saving = pending || creditCardPending || sharingPending

  const deleteAccount = async () => {
    if (locked) return
    const confirmed = await confirmDiscard(t('accountEdit.deleteConfirmTitle'), t('accountEdit.deleteConfirmMessage'), t('common.cancel'), t('accountEdit.deleteConfirmAction'))
    if (!confirmed) return
    setDeleteFailure(null)
    try {
      await onDeleteAccount()
    } catch (error) {
      setDeleteFailure(classifyAccountDeleteFailure(error))
    }
  }

  const requestExit = async () => {
    if (locked) return
    if (!dirty || await confirmDiscard(t('accountEdit.discardTitle'), t('accountEdit.discardMessage'), t('common.cancel'), t('accountEdit.discard'))) onBack()
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void requestExit()
      return true
    })
    return () => subscription.remove()
  })

  const saveAccount = async () => {
    if (!dirty || locked) return
    if (changes && !accountUpdateWriteSchema.safeParse(changes).success) { setFailure('invalid'); return }
    if (cardChanges && !creditCardWriteSchema.safeParse(cardChanges).success) { setFailure('invalid'); return }
    setFailure(null)
    setSharingFailure(null)
    try {
      if (cardChanges) await onSaveCreditCard(cardChanges)
      if (changes) await onSaveAccount(changes)
      setSaved((current) => ({
        ...current,
        name,
        isPrivate: legacyPrivacy ? isPrivate : current.isPrivate,
        creditCard: cardChanges
          ? {
              statementCloseDay: cardChanges.statementCloseDay,
              paymentDueDay: cardChanges.paymentDueDay,
              creditLimit: cardChanges.creditLimit ?? null,
              minimumPaymentPercent: cardChanges.minimumPaymentPercent ?? null,
            }
          : current.creditCard,
      }))
    } catch (error) {
      setFailure(classifyAccountWriteFailure(error))
      return
    }
    if (!sharingChanges || !onSaveSharing) return
    try {
      await onSaveSharing(sharingChanges)
      // The answer is the new sharing, so the control starts again from it.
      setShareOverrides({})
      setPrivateOverride(null)
    } catch (error) {
      setSharingFailure(classifyAccountSharingFailure(error))
    }
  }

  const sharingSection = shares ? (
    <AccountSharingSection
      choices={choices}
      disabled={locked || !sharingEditable}
      onChange={(appuserKey: number, choice: ShareChoice) => setShareOverrides((current) => ({ ...current, [appuserKey]: choice }))}
      onPrivateToggle={setPrivateOverride}
      privateToggle={privateToggle}
      shares={shares}
    />
  ) : sharing.status === 'loading' || sharing.status === 'error'
    ? <AccountSharingPlaceholder onRetry={onRetrySharing} status={sharing.status} />
    : null
  const sharingFailureNotice = sharingFailure ? <Notice message={t(`accountEdit.sharing.failures.${sharingFailure}`)} tone="destructive" /> : null

  if (readOnly) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar
          closeDisabled={locked}
          closeLabel={t('common.close')}
          onClose={() => void requestExit()}
          onSave={sharingEditable ? () => void saveAccount() : undefined}
          saveDisabled={!dirty || locked}
          saveLabel={saving ? t('accountEdit.saving') : t('accountEdit.saveDetails')}
          saving={saving}
          title={t('accountEdit.sharing.screenTitle')}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.page}>
            <Notice message={t('common.accountReadOnly')} testID="account-edit-read-only" />
            {stale ? <Notice message={t('accountEdit.stale')} /> : null}
            {sharingFailureNotice}
            {sharingSection}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={() => void requestExit()}
        onSave={() => void saveAccount()}
        saveDisabled={!dirty || locked}
        saveLabel={saving ? t('accountEdit.saving') : t('accountEdit.saveDetails')}
        saving={saving}
        title={t('accountEdit.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
          <View style={styles.page}>
            <UiText tone="muted" variant="meta">{t('accountEdit.helper')}</UiText>
            {stale ? <Notice message={t('accountEdit.stale')} /> : null}
            {failure ? <Notice message={t(`accountEdit.failures.${failure}`)} tone="destructive" /> : null}
            {deleteFailure ? <Notice message={t(`accountEdit.deleteFailures.${deleteFailure}`)} tone="destructive" /> : null}
            {sharingFailureNotice}
            <FormGroup>
              <FormTextRow
                key="name"
                accessibilityHint={t('accountEdit.nameHint')}
                accessibilityLabel={t('accountEdit.name')}
                editable={!locked}
                hint={t('accountEdit.characterCount', { count: name.length, max: 100 })}
                label={t('accountEdit.name')}
                maxLength={100}
                onChangeText={setName}
                value={name}
              />
              {legacyPrivacy && model.isOwnedByViewer ? (
                <FormSwitchRow
                  key="privacy"
                  accessibilityLabel={t('accountEdit.privacySwitch')}
                  disabled={locked}
                  hint={t('accountEdit.privacyHelper')}
                  label={t('accountEdit.privacyTitle')}
                  onValueChange={setIsPrivate}
                  value={isPrivate}
                />
              ) : null}
            </FormGroup>
            {sharingSection}
            <FormGroup>
              <FormSwitchRow
                key="credit-card"
                accessibilityHint={t('accountEdit.creditCardHelper')}
                accessibilityLabel={t('accountEdit.creditCardTitle')}
                disabled={locked || Boolean(model.creditCard)}
                hint={t('accountEdit.creditCardHelper')}
                label={t('accountEdit.creditCardTitle')}
                onValueChange={setCardEnabled}
                value={cardEnabled}
              />
              {cardEnabled ? (
                <>
                  <FormTextRow
                    key="close-day"
                    accessibilityLabel={t('accountEdit.statementCloseDay')}
                    editable={!locked}
                    keyboardType="number-pad"
                    label={t('accountEdit.statementCloseDay')}
                    maxLength={2}
                    onChangeText={setStatementCloseDay}
                    value={statementCloseDay}
                  />
                  <FormTextRow
                    key="due-day"
                    accessibilityLabel={t('accountEdit.paymentDueDay')}
                    editable={!locked}
                    keyboardType="number-pad"
                    label={t('accountEdit.paymentDueDay')}
                    maxLength={2}
                    onChangeText={setPaymentDueDay}
                    value={paymentDueDay}
                  />
                  <FormTextRow
                    key="limit"
                    accessibilityLabel={t('accountEdit.creditLimit')}
                    editable={!locked}
                    keyboardType="decimal-pad"
                    label={t('accountEdit.creditLimit')}
                    onChangeText={setCreditLimit}
                    placeholder={t('accountEdit.optional')}
                    value={creditLimit}
                  />
                  <FormTextRow
                    key="minimum"
                    accessibilityLabel={t('accountEdit.minimumPaymentPercent')}
                    editable={!locked}
                    keyboardType="decimal-pad"
                    label={t('accountEdit.minimumPaymentPercent')}
                    onChangeText={setMinimumPaymentPercent}
                    placeholder={t('accountEdit.optional')}
                    value={minimumPaymentPercent}
                  />
                </>
              ) : null}
            </FormGroup>
            <View style={styles.danger}>
              <Button disabled={locked} icon="trash" label={deletePending ? t('accountEdit.deleting') : t('accountEdit.deleteAccount')} loading={deletePending} onPress={() => void deleteAccount()} variant="destructive-quiet" />
              <UiText tone="muted" variant="meta">{t('accountEdit.dangerHelper')}</UiText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function EditFailure({ status, onBack, onRetry, palette }: { status: Exclude<AccountEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const canRetry = status !== 'invalid-id'
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('accountEdit.back')} onClose={onBack} />
      <View style={styles.center}>
        <UiText accessibilityRole="header" variant="heading">{t(`accountEdit.states.${status}Title`)}</UiText>
        <UiText tone="muted" variant="body">{t(`accountEdit.states.${status}Message`)}</UiText>
        {canRetry ? <View style={styles.retry}><Button label={t('common.retry')} onPress={onRetry} /></View> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  retry: { alignItems: 'flex-start' },
  danger: { marginTop: themeTokens.spacing[6], gap: themeTokens.spacing[1] },
})
