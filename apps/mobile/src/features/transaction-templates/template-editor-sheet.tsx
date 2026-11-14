import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatNumberInput, parseAmountInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'

import type { TransactionTemplateDirection, TransactionTemplateDto, TransactionTemplateInput } from './templates-contract'

/**
 * Create or edit one template. Opened by the "New template" chip or by a long press on a
 * chip. Deleting is offered only for a saved one.
 */
export function TemplateEditorSheet({
  visible,
  template,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean
  template: TransactionTemplateDto | null
  pending: boolean
  onClose: () => void
  onSave: (input: TransactionTemplateInput) => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      closeLabel={t('common.close')}
      onClose={onClose}
      title={template ? t('transactionTemplates.editTitle') : t('transactionTemplates.newTitle')}
      visible={visible}
    >
      <TemplateEditorForm
        key={`${template?.transactionTemplateKey ?? 'new'}-${visible}`}
        onDelete={onDelete}
        onSave={onSave}
        pending={pending}
        template={template}
      />
    </Sheet>
  )
}

function TemplateEditorForm({
  template,
  pending,
  onSave,
  onDelete,
}: {
  template: TransactionTemplateDto | null
  pending: boolean
  onSave: (input: TransactionTemplateInput) => void
  onDelete?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState(template?.name ?? '')
  const [direction, setDirection] = useState<TransactionTemplateDirection>(template?.direction ?? 'out')
  const [amount, setAmount] = useState(template?.amount != null ? formatNumberInput(template.amount, locale) : '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [notes, setNotes] = useState(template?.notes ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)

  const submit = () => {
    const trimmedName = name.trim()
    const parsedAmount = amount.trim() === '' ? null : parseAmountInput(amount, locale)
    const nextNameError = trimmedName ? null : t('transactionTemplates.nameRequired')
    const nextAmountError = amount.trim() !== '' && (parsedAmount === null || Number(parsedAmount) <= 0)
      ? t('transactionTemplates.amountInvalid')
      : null
    setNameError(nextNameError)
    setAmountError(nextAmountError)
    if (nextNameError || nextAmountError) return
    onSave({
      name: trimmedName,
      direction,
      amount: parsedAmount === null ? null : Number(parsedAmount),
      description: description.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <View style={styles.form}>
      <FormGroup>
        <FormTextRow
          accessibilityLabel={t('transactionTemplates.name')}
          editable={!pending}
          error={nameError}
          label={t('transactionTemplates.name')}
          maxLength={120}
          onChangeText={setName}
          placeholder={t('transactionTemplates.namePlaceholder')}
          value={name}
        />
        <FormTextRow
          accessibilityLabel={t('transactionTemplates.amount')}
          editable={!pending}
          error={amountError}
          keyboardType="decimal-pad"
          label={t('transactionTemplates.amount')}
          onChangeText={setAmount}
          placeholder={t('transactionTemplates.optional')}
          value={amount}
        />
        <FormTextRow
          accessibilityLabel={t('transactionTemplates.description')}
          editable={!pending}
          label={t('transactionTemplates.description')}
          maxLength={500}
          onChangeText={setDescription}
          placeholder={t('transactionTemplates.optional')}
          value={description}
        />
        <FormTextRow
          accessibilityLabel={t('transactionTemplates.notes')}
          editable={!pending}
          label={t('transactionTemplates.notes')}
          maxLength={1000}
          multiline
          onChangeText={setNotes}
          placeholder={t('transactionTemplates.optional')}
          value={notes}
        />
      </FormGroup>
      <View style={styles.direction}>
        <Text tone="muted" variant="meta">{t('transactionTemplates.direction')}</Text>
        <SegmentedControl
          accessibilityLabel={t('transactionTemplates.direction')}
          fill
          onChange={setDirection}
          options={[
            { value: 'out', label: t('transactionTemplates.directionOut') },
            { value: 'in', label: t('transactionTemplates.directionIn') },
          ]}
          value={direction}
        />
      </View>
      <Button
        disabled={pending}
        label={pending ? t('transactionTemplates.saving') : t('transactionTemplates.save')}
        onPress={submit}
      />
      {template && onDelete ? (
        <Button
          disabled={pending}
          label={t('transactionTemplates.delete')}
          onPress={onDelete}
          variant="secondary"
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[4] },
  direction: { gap: themeTokens.spacing[2] },
})
