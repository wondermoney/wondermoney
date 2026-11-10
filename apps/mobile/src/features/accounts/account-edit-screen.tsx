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

import { accountUpdateWriteSchema, type AccountUpdateWrite } from './accounts-contract'
import { LoadingState } from './screen-states'
import { classifyAccountDeleteFailure, type AccountDeleteFailure } from './use-account-delete-mutation'
import { classifyAccountWriteFailure, type AccountWriteFailure } from './use-account-metadata-mutation'

export type AccountEditModel = Readonly<{
  id: number
  name: string
  isPrivate: boolean
  isOwnedByViewer: boolean
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
  onDeleteAccount: () => Promise<void>
  pending: boolean
  deletePending: boolean
}>


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

function AccountEditForm({ model, stale, onBack, onSaveAccount, onDeleteAccount, pending, deletePending, palette }: Omit<Props, 'state' | 'onRetry'> & { model: AccountEditModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [saved, setSaved] = useState(model)
  const [name, setName] = useState(model.name)
  const [isPrivate, setIsPrivate] = useState(model.isPrivate)
  const [failure, setFailure] = useState<AccountWriteFailure | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<AccountDeleteFailure | null>(null)
  const changes = createAccountMetadataChanges(saved, { name, isPrivate })
  const dirty = changes !== null
  const locked = pending || deletePending

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
    if (!changes || locked) return
    if (!accountUpdateWriteSchema.safeParse(changes).success) { setFailure('invalid'); return }
    setFailure(null)
    try {
      await onSaveAccount(changes)
      setSaved((current) => ({ ...current, name, isPrivate }))
    } catch (error) {
      setFailure(classifyAccountWriteFailure(error))
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={() => void requestExit()}
        onSave={() => void saveAccount()}
        saveDisabled={!dirty || locked}
        saveLabel={pending ? t('accountEdit.saving') : t('accountEdit.saveDetails')}
        saving={pending}
        title={t('accountEdit.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
          <View style={styles.page}>
            <UiText tone="muted" variant="meta">{t('accountEdit.helper')}</UiText>
            {stale ? <Notice message={t('accountEdit.stale')} /> : null}
            {failure ? <Notice message={t(`accountEdit.failures.${failure}`)} tone="destructive" /> : null}
            {deleteFailure ? <Notice message={t(`accountEdit.deleteFailures.${deleteFailure}`)} tone="destructive" /> : null}
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
              {model.isOwnedByViewer ? (
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
