import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { usePalette } from '@/theme/use-palette'

import { budgetMetadataWriteSchema } from './budgets-contract'
import { classifyBudgetDeleteFailure, type BudgetDeleteFailure } from './use-budget-delete-mutation'
import { classifyBudgetWriteFailure, type BudgetWriteFailure } from './use-budget-metadata-mutation'
import { themeTokens, type Palette } from '@/theme/tokens'

export type BudgetEditModel = Readonly<{
  id: number
  name: string
  description: string | null
  /** Null when the server has no rollover: the setting is then not shown or sent. */
  rolloverCarriesOverspend: boolean | null
}>

export type BudgetEditViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-route' }
  | { status: 'loaded' | 'refresh-error'; model: BudgetEditModel; refreshing?: boolean }

type Props = Readonly<{
  state: BudgetEditViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSaveMetadata: (value: { name: string; description: string; rolloverCarriesOverspend?: boolean }) => Promise<void>
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
  const palette = usePalette()
  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><FormBar closeLabel={t('common.close')} onClose={props.onBack} title={t('budgetEdit.title')} /><View accessibilityRole="progressbar" accessibilityLabel={t('budgetEdit.loading')} style={styles.center}><Text tone="muted" variant="meta">{t('budgetEdit.loading')}</Text></View></SafeAreaView>
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') return <EditFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} palette={palette} />
  return <BudgetEditForm key={props.state.model.id} {...props} model={props.state.model} stale={props.state.status === 'refresh-error'} palette={palette} />
}

function BudgetEditForm({ model, stale, onBack, onSaveMetadata, onDeleteBudget, deletePending = false, pending, palette }: Omit<Props, 'state' | 'onRetry'> & { model: BudgetEditModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [savedName, setSavedName] = useState(model.name)
  const [savedDescription, setSavedDescription] = useState(model.description ?? '')
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description ?? '')
  const [savedCarryOverspend, setSavedCarryOverspend] = useState(model.rolloverCarriesOverspend)
  const [carryOverspend, setCarryOverspend] = useState(model.rolloverCarriesOverspend)
  const [failure, setFailure] = useState<BudgetWriteFailure | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<BudgetDeleteFailure | null>(null)
  const dirty = name !== savedName || description !== savedDescription || carryOverspend !== savedCarryOverspend
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
    const candidate = { name, description, ...(carryOverspend !== null && carryOverspend !== savedCarryOverspend ? { rolloverCarriesOverspend: carryOverspend } : {}) }
    if (!budgetMetadataWriteSchema.safeParse(candidate).success) { setFailure('invalid'); return }
    setFailure(null)
    try {
      await onSaveMetadata(candidate)
      setSavedName(name)
      setSavedDescription(description)
      setSavedCarryOverspend(carryOverspend)
    } catch (error) {
      setFailure(classifyBudgetWriteFailure(error))
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={() => void requestExit()}
        onSave={() => void saveMetadata()}
        saveDisabled={!dirty || locked}
        saveLabel={pending ? t('budgetEdit.saving') : t('budgetEdit.saveDetails')}
        saving={pending}
        title={t('budgetEdit.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <Text tone="muted" variant="meta">{t('budgetEdit.helper')}</Text>
          {stale ? <Notice message={t('budgetEdit.stale')} /> : null}
          {failure ? <Notice message={t(`budgetEdit.failures.${failure}`)} tone="destructive" /> : null}
          {deleteFailure ? <Notice message={t(`budgetEdit.deleteFailures.${deleteFailure}`)} tone="destructive" /> : null}
          <FormGroup>
            <FormTextRow
              key="name"
              accessibilityHint={t('budgetEdit.nameHint')}
              accessibilityLabel={t('budgetEdit.name')}
              editable={!locked}
              hint={t('budgetEdit.characterCount', { count: name.length, max: 100 })}
              label={t('budgetEdit.name')}
              maxLength={100}
              onChangeText={setName}
              value={name}
            />
            <FormTextRow
              key="description"
              accessibilityHint={t('budgetEdit.descriptionHint')}
              accessibilityLabel={t('budgetEdit.description')}
              editable={!locked}
              hint={t('budgetEdit.characterCount', { count: description.length, max: 500 })}
              label={t('budgetEdit.description')}
              maxLength={500}
              multiline
              onChangeText={setDescription}
              placeholder={t('transactionCreate.optional')}
              value={description}
            />
          </FormGroup>
          {carryOverspend !== null ? (
            <FormGroup>
              <FormSwitchRow
                key="carry-overspend"
                disabled={locked}
                hint={t('budgetEdit.carryOverspendHint')}
                label={t('budgetEdit.carryOverspend')}
                onValueChange={setCarryOverspend}
                testID="budget-carry-overspend"
                value={carryOverspend}
              />
            </FormGroup>
          ) : null}
          {onDeleteBudget ? (
            <View style={styles.danger}>
              <Button disabled={locked} icon="trash" label={deletePending ? t('budgetEdit.deleting') : t('budgetEdit.deleteBudget')} loading={deletePending} onPress={() => void deleteBudget()} variant="destructive-quiet" />
              <Text tone="muted" variant="meta">{t('budgetEdit.dangerHelper')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function EditFailure({ status, onBack, onRetry, palette }: { status: Exclude<BudgetEditViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>; onBack: () => void; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const canRetry = status !== 'invalid-route'
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('budgetEdit.back')} onClose={onBack} />
      <View style={styles.center}>
        <Text accessibilityRole="header" variant="heading">{t(`budgetEdit.states.${status}Title`)}</Text>
        <Text tone="muted" variant="body">{t(`budgetEdit.states.${status}Message`)}</Text>
        {canRetry ? <View style={styles.retry}><Button label={t('common.retry')} onPress={onRetry} /></View> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  retry: { alignItems: 'flex-start' },
  danger: { marginTop: themeTokens.spacing[6], gap: themeTokens.spacing[1] },
})
