import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button as SharedButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { BackControl } from '@/components/ui/back-control'

import { budgetMetadataWriteSchema } from './budgets-contract'
import { classifyBudgetDeleteFailure, type BudgetDeleteFailure } from './use-budget-delete-mutation'
import { classifyBudgetWriteFailure, type BudgetWriteFailure } from './use-budget-metadata-mutation'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type BudgetEditModel = Readonly<{
  id: number
  name: string
  description: string | null
}>

export type BudgetEditViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-route' }
  | { status: 'loaded' | 'refresh-error'; model: BudgetEditModel; refreshing?: boolean }

type Props = Readonly<{
  state: BudgetEditViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSaveMetadata: (value: { name: string; description: string }) => Promise<void>
  onDeleteBudget?: () => Promise<void>
  deletePending?: boolean
  pending: boolean
}>


const confirmDiscard = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export function BudgetEditScreen(props: Props) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View accessibilityRole="progressbar" accessibilityLabel={t('budgetEdit.loading')} style={styles.center}><Text style={{ color: palette.foreground }}>{t('budgetEdit.loading')}</Text></View></SafeAreaView>
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') return <EditFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} palette={palette} />
  return <BudgetEditForm key={props.state.model.id} {...props} model={props.state.model} stale={props.state.status === 'refresh-error'} palette={palette} />
}

function BudgetEditForm({ model, stale, onBack, onSaveMetadata, onDeleteBudget, deletePending = false, pending, palette }: Omit<Props, 'state' | 'onRetry'> & { model: BudgetEditModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [savedName, setSavedName] = useState(model.name)
  const [savedDescription, setSavedDescription] = useState(model.description ?? '')
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description ?? '')
  const [failure, setFailure] = useState<BudgetWriteFailure | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<BudgetDeleteFailure | null>(null)
  const dirty = name !== savedName || description !== savedDescription
  const locked = pending || deletePending

  const deleteBudget = async () => {
    if (!onDeleteBudget || locked) return
    const confirmed = await confirmDiscard(t('budgetEdit.deleteConfirmTitle'), t('budgetEdit.deleteConfirmMessage'), t('common.cancel'), t('budgetEdit.deleteConfirmAction'))
    if (!confirmed) return
    setDeleteFailure(null)
    try {
      await onDeleteBudget()
    } catch (error) {
      setDeleteFailure(classifyBudgetDeleteFailure(error))
    }
  }

  const requestExit = async () => {
    if (locked) return
    if (!dirty || await confirmDiscard(t('budgetEdit.discardTitle'), t('budgetEdit.discardMessage'), t('common.cancel'), t('budgetEdit.discard'))) onBack()
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void requestExit()
      return true
    })
    return () => subscription.remove()
  })

  const saveMetadata = async () => {
    if (!dirty || pending) return
    const candidate = { name, description }
    if (!budgetMetadataWriteSchema.safeParse(candidate).success) { setFailure('invalid'); return }
    setFailure(null)
    try {
      await onSaveMetadata(candidate)
      setSavedName(name)
      setSavedDescription(description)
    } catch (error) {
      setFailure(classifyBudgetWriteFailure(error))
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, styles.contentWithBottomInset]}>
        <View style={styles.page}>
          <BackControl fallback="/budgets" onPress={() => void requestExit()} color={palette.primary} disabled={locked} />
          <PageHeader palette={palette}
            instruction={t('budgetEdit.helper')} title={t('budgetEdit.title')} />
          {stale ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('budgetEdit.stale')}</Text> : null}
          {failure ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetEdit.failures.${failure}`)}</Text> : null}
          {deleteFailure ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetEdit.deleteFailures.${deleteFailure}`)}</Text> : null}
          <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetEdit.detailsTitle')}</Text>
            <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetEdit.name')}</Text>
            <TextInput accessibilityLabel={t('budgetEdit.name')} accessibilityHint={t('budgetEdit.nameHint')} editable={!locked} maxLength={100} value={name} onChangeText={setName} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <Text style={[styles.limit, { color: palette.mutedForeground }]}>{t('budgetEdit.characterCount', { count: name.length, max: 100 })}</Text>
            <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetEdit.description')}</Text>
            <TextInput accessibilityLabel={t('budgetEdit.description')} accessibilityHint={t('budgetEdit.descriptionHint')} editable={!locked} maxLength={500} multiline value={description} onChangeText={setDescription} style={[styles.input, styles.textarea, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
            <Text style={[styles.limit, { color: palette.mutedForeground }]}>{t('budgetEdit.characterCount', { count: description.length, max: 500 })}</Text>
            <SharedButton disabled={!dirty || locked} label={pending ? t('budgetEdit.saving') : t('budgetEdit.saveDetails')} onPress={saveMetadata} palette={palette} style={styles.saveButton} variant="primary" />
          </View>
          <SharedButton disabled={locked} label={t('common.cancel')} onPress={requestExit} palette={palette} variant="secondary" />
          {onDeleteBudget ? (
            <View style={[styles.dangerPanel, { borderColor: palette.destructive }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetEdit.dangerTitle')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetEdit.dangerHelper')}</Text>
              <Button label={deletePending ? t('budgetEdit.deleting') : t('budgetEdit.deleteBudget')} disabled={locked} busy={deletePending} onPress={deleteBudget} palette={palette} destructive />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Button({ label, disabled, busy, onPress, palette, secondary = false, destructive = false }: { label: string; disabled: boolean; busy: boolean; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; destructive?: boolean }) {
  const tint = destructive ? palette.destructive : palette.primary
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={[styles.button, { borderColor: tint, backgroundColor: secondary || destructive ? 'transparent' : tint }, disabled && styles.disabled]}><Text style={[styles.buttonText, { color: secondary || destructive ? tint : palette.background }]}>{label}</Text></Pressable>
}

function EditFailure({ status, onBack, onRetry, palette }: { status: Exclude<BudgetEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const canRetry = status !== 'invalid-route'
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.center}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(`budgetEdit.states.${status}Title`)}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`budgetEdit.states.${status}Message`)}</Text>{canRetry ? <Button label={t('common.retry')} disabled={false} busy={false} onPress={onRetry} palette={palette} /> : null}<BackControl fallback="/budgets" label={t('budgetEdit.back')} onPress={onBack} disabled={false} /></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, contentWithBottomInset: { paddingBottom: themeTokens.spacing[6] * 2 }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  back: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', alignSelf: 'flex-start' }, backText: { ...textStyles.action }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title, fontWeight: '700' as const }, helper: { ...textStyles.body },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section, fontWeight: '700' as const }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const, marginTop: themeTokens.spacing[2] }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, textarea: { minHeight: 104, paddingTop: themeTokens.spacing[3], textAlignVertical: 'top' }, limit: { ...textStyles.amountSmall, alignSelf: 'flex-end' },
  dangerPanel: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[4] },
  button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], alignItems: 'center', justifyContent: 'center', marginTop: themeTokens.spacing[2] }, buttonText: { ...textStyles.action, fontWeight: '700' as const }, disabled: { opacity: 0.45 }, notice: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, saveButton: { marginTop: themeTokens.spacing[2] },
})
