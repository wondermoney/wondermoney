import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { DateField } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { buildValuationPayload } from './asset-forms-model'
import type { ManualAssetValuationWrite } from './manual-assets-contract'
import { localToday } from './manual-assets-view-model'
import type { ManualAssetWriteFailure } from './use-manual-asset-writes'

/**
 * "Update value": what the asset is worth on a day. It records a valuation, never a transaction;
 * a value already recorded for that day is replaced.
 */
export function ValuationScreen({ assetName, currency, pending, outcome, onBack, onSave }: Readonly<{
  /** Null while the asset is loading. */
  assetName: string | null
  currency: string | null
  pending: boolean
  outcome: ManualAssetWriteFailure | null
  onBack: () => void
  onSave: (value: ManualAssetValuationWrite) => Promise<void>
}>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [value, setValue] = useState('')
  const [date, setDate] = useState(localToday)
  const [note, setNote] = useState('')
  const today = localToday()
  const result = buildValuationPayload({ value: toWireDecimalInput(value, locale), date, note })
  const valueError = value.trim() !== '' && !result.success && result.invalidFields.has('value') ? t('manualAssetCreate.fieldErrors.value') : null
  const submit = () => {
    if (!result.success || pending) return
    void onSave(result.payload)
  }
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={submit}
        saveDisabled={!result.success || pending || assetName === null}
        saveLabel={pending ? t('manualAssetValuation.saving') : t('manualAssetValuation.save')}
        saving={pending}
        title={t('manualAssetValuation.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            {assetName ? <Text tone="muted" variant="meta">{assetName}</Text> : null}
            <AmountEntry
              accessibilityLabel={t('manualAssetValuation.value')}
              caption={t('manualAssetValuation.value')}
              currency={currency}
              editable={!pending}
              error={valueError}
              locale={locale}
              onChangeText={setValue}
              value={value}
            />
            <FormGroup>
              <DateField key="date" appearance="row" disabled={pending} label={t('manualAssetValuation.date')} maximumDate={today} onChange={(next) => setDate(next ?? today)} value={date} />
              <FormTextRow key="note" accessibilityLabel={t('manualAssetValuation.noteOptional')} editable={!pending} label={t('manualAssetValuation.note')} maxLength={2000} onChangeText={setNote} placeholder={t('manualAssetValuation.notePlaceholder')} value={note} />
            </FormGroup>
            <Text tone="muted" variant="meta">{t('manualAssetValuation.description')}</Text>
            {outcome ? <Notice message={t(`manualAssets.failures.${outcome}`)} tone="destructive" /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
})
