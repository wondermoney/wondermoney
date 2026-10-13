import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { BackControl } from '@/components/ui/back-control'

import { accountUpdateWriteSchema, type AccountUpdateWrite } from './accounts-contract'
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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View accessibilityRole="progressbar" accessibilityLabel={t('accountEdit.loading')} style={styles.center}><Text style={{ color: palette.foreground }}>{t('accountEdit.loading')}</Text></View></SafeAreaView>
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={[styles.content, styles.contentWithBottomInset]}>
          <View style={styles.page}>
            <BackControl fallback="/accounts" onPress={() => void requestExit()} color={palette.primary} disabled={locked} />
            <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('accountEdit.title')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('accountEdit.helper')}</Text></View>
            {stale ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('accountEdit.stale')}</Text> : null}
            {failure ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`accountEdit.failures.${failure}`)}</Text> : null}
            {deleteFailure ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`accountEdit.deleteFailures.${deleteFailure}`)}</Text> : null}
            <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('accountEdit.detailsTitle')}</Text>
              <Text style={[styles.label, { color: palette.foreground }]}>{t('accountEdit.name')}</Text>
              <TextInput accessibilityLabel={t('accountEdit.name')} accessibilityHint={t('accountEdit.nameHint')} editable={!locked} maxLength={100} value={name} onChangeText={setName} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
              <Text style={[styles.limit, { color: palette.mutedForeground }]}>{t('accountEdit.characterCount', { count: name.length, max: 100 })}</Text>
              {model.isOwnedByViewer ? (
                <View style={styles.privacyRow}>
                  <View style={styles.switchCopy}>
                    <Text style={[styles.label, { color: palette.foreground }]}>{t('accountEdit.privacyTitle')}</Text>
                    <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('accountEdit.privacyHelper')}</Text>
                  </View>
                  <Switch accessibilityRole="switch" accessibilityLabel={t('accountEdit.privacySwitch')} accessibilityState={{ disabled: locked, checked: isPrivate }} disabled={locked} value={isPrivate} onValueChange={setIsPrivate} trackColor={{ false: palette.muted, true: palette.primary }} />
                </View>
              ) : null}
              <Button label={pending ? t('accountEdit.saving') : t('accountEdit.saveDetails')} disabled={!dirty || locked} busy={pending} onPress={saveAccount} palette={palette} />
            </View>
            <Button label={t('common.cancel')} disabled={locked} busy={false} onPress={requestExit} palette={palette} secondary />
            <View style={[styles.dangerPanel, { borderColor: palette.destructive }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('accountEdit.dangerTitle')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('accountEdit.dangerHelper')}</Text>
              <Button label={deletePending ? t('accountEdit.deleting') : t('accountEdit.deleteAccount')} disabled={locked} busy={deletePending} onPress={deleteAccount} palette={palette} destructive />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Button({ label, disabled, busy, onPress, palette, secondary = false, destructive = false }: { label: string; disabled: boolean; busy: boolean; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; destructive?: boolean }) {
  const tint = destructive ? palette.destructive : palette.primary
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={[styles.button, { borderColor: tint, backgroundColor: secondary || destructive ? 'transparent' : tint }, disabled && styles.disabled]}><Text style={[styles.buttonText, { color: secondary || destructive ? tint : palette.background }]}>{label}</Text></Pressable>
}

function EditFailure({ status, onBack, onRetry, palette }: { status: Exclude<AccountEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const canRetry = status !== 'invalid-id'
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.center}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(`accountEdit.states.${status}Title`)}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`accountEdit.states.${status}Message`)}</Text>{canRetry ? <Button label={t('common.retry')} disabled={false} busy={false} onPress={onRetry} palette={palette} /> : null}<BackControl fallback="/accounts" label={t('accountEdit.back')} onPress={onBack} disabled={false} /></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, keyboard: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, contentWithBottomInset: { paddingBottom: themeTokens.spacing[6] * 2 }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  back: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', alignSelf: 'flex-start' }, backText: { ...textStyles.action }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title, fontWeight: '700' as const }, helper: { ...textStyles.body },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section, fontWeight: '700' as const }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const, marginTop: themeTokens.spacing[2] }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, limit: { ...textStyles.amountSmall, alignSelf: 'flex-end' },
  privacyRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[3] }, switchCopy: { flex: 1, minWidth: 200, gap: themeTokens.spacing[1] },
  dangerPanel: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] },
  button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], alignItems: 'center', justifyContent: 'center', marginTop: themeTokens.spacing[2] }, buttonText: { ...textStyles.action, fontWeight: '700' as const }, disabled: { opacity: 0.45 }, notice: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})
