import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

import { type ExpenseGroupDto, freezeUpdateGroup, GROUP_NAME_MAX, type UpdateGroupPayload } from './expense-groups-contract'
import { classifyGroupFailure } from './expense-groups-view-model'

type Props = Readonly<{
  visible: boolean
  group: ExpenseGroupDto
  /** Currency codes to choose from (the API's currency list). */
  currencies: readonly string[]
  /** Resolves once the API has saved the change; a refusal rejects with the API's error. */
  onSave: (payload: UpdateGroupPayload) => Promise<unknown>
  onClose: () => void
}>

/**
 * "Edit group": its name and the currency new settlements default to. Only what changed is sent,
 * and nothing when nothing did. A refusal stays in the sheet, in the API's words, with the draft.
 * Mounted only while open, so each opening starts from the group as it is now.
 */
export function ExpenseGroupEditSheet({ visible, group, currencies, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(group.name)
  const [currency, setCurrency] = useState(group.currencyCode)
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameMissing = name.trim() === ''
  const options = [...new Set([group.currencyCode, ...currencies])].map((code) => ({ value: code, label: code }))

  const close = () => { if (!pending) onClose() }
  const save = async () => {
    setTouched(true)
    if (nameMissing || pending) return
    let payload: UpdateGroupPayload | null
    try {
      payload = freezeUpdateGroup(group, { name, currencyCode: currency })
    } catch {
      setError(t('expenseGroups.errors.error'))
      return
    }
    if (!payload) {
      onClose()
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSave(payload)
    } catch (caught) {
      setPending(false)
      setError(t(`expenseGroups.errors.${classifyGroupFailure(caught)}`))
      return
    }
    setPending(false)
    onClose()
  }

  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={<Button disabled={pending} label={t('expenseGroups.edit.save')} loading={pending} onPress={() => void save()} testID="expense-group-edit-save" />}
      onClose={close}
      title={t('expenseGroups.edit.title')}
      visible={visible}
    >
      <View style={styles.stack}>
        <FormGroup>
          <FormTextRow
            editable={!pending}
            error={touched && nameMissing ? t('expenseGroups.create.nameRequired') : null}
            label={t('expenseGroups.create.name')}
            maxLength={GROUP_NAME_MAX}
            onChangeText={setName}
            value={name}
          />
          <FormSelectRow
            disabled={pending}
            hint={t('expenseGroups.edit.currencyHint')}
            label={t('expenseGroups.create.currency')}
            onChange={setCurrency}
            options={options}
            placeholder={t('expenseGroups.create.choose')}
            value={currency}
          />
        </FormGroup>
        {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  stack: { gap: themeTokens.spacing[3] },
})
