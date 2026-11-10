import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { DateField } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { buildManualAssetCreatePayload } from './asset-forms-model'
import { MANUAL_ASSET_KINDS, type ManualAssetCreateWrite, type ManualAssetKind } from './manual-assets-contract'
import { localToday } from './manual-assets-view-model'
import type { ManualAssetWriteFailure } from './use-manual-asset-writes'

export type AssetCurrencyOption = Readonly<{ currencyKey: number; code: string; description: string }>

/**
 * Add asset, as a calm-structure flow like Add loan: the form bar (close, save), the current value
 * big and centred, then one group of rows. The currency starts at the viewer's own once the list
 * has loaded, and is fixed once the asset exists. The ✓ stays disabled until the required fields
 * are valid; an error shows under a row only for what was entered and is wrong.
 */
export function AssetCreateScreen({ currencies, userCurrency, loading, metadataError, pending, outcome, onBack, onCreate }: Readonly<{
  currencies: readonly AssetCurrencyOption[]
  /** The viewer's currency code, when known: the one a new asset starts in. */
  userCurrency: string | null
  loading: boolean
  metadataError: boolean
  pending: boolean
  outcome: ManualAssetWriteFailure | null
  onBack: () => void
  onCreate: (value: ManualAssetCreateWrite) => Promise<void>
}>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ManualAssetKind | null>('property')
  const [chosenCurrencyId, setCurrencyId] = useState<number | null>(null)
  const [value, setValue] = useState('')
  const [valuationDate, setValuationDate] = useState(localToday)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [growthRatePercent, setGrowthRatePercent] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [notes, setNotes] = useState('')
  // The viewer's own currency until one is chosen; none at all until the list has loaded.
  const currencyId = chosenCurrencyId ?? currencies.find((currency) => currency.code === userCurrency)?.currencyKey ?? null

  if (loading) return <StatePage title={t('manualAssetCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage title={t('manualAssetCreate.metadataError')} onBack={onBack} />

  // Read in the app's language ("1.234,56" in pt and es), then handed on as dot decimals.
  const decimal = (input: string) => toWireDecimalInput(input, locale)
  const result = buildManualAssetCreatePayload({
    name,
    kind,
    currencyId,
    value: decimal(value),
    valuationDate,
    purchasePrice: decimal(purchasePrice),
    purchaseDate,
    growthRatePercent: decimal(growthRatePercent),
    isPrivate,
    notes,
  })
  const invalid: ReadonlySet<string> = result.success ? new Set() : result.invalidFields
  const errorFor = (field: string, entered: string, key: string) => (entered.trim() !== '' && invalid.has(field) ? t(`manualAssetCreate.fieldErrors.${key}`) : null)
  const currency = currencies.find((item) => item.currencyKey === currencyId) ?? null
  const today = localToday()

  const submit = () => {
    if (!result.success || pending) return
    void onCreate(result.payload)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={submit}
        saveDisabled={!result.success || pending}
        saveLabel={pending ? t('manualAssetCreate.saving') : t('manualAssetCreate.save')}
        saving={pending}
        title={t('manualAssetCreate.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <AmountEntry
              accessibilityLabel={t('manualAssetCreate.value')}
              caption={t('manualAssetCreate.value')}
              currency={currency?.code ?? null}
              editable={!pending}
              error={errorFor('value', value, 'value')}
              locale={locale}
              onChangeText={setValue}
              value={value}
            />
            <FormGroup>
              <FormTextRow key="name" editable={!pending} label={t('manualAssetCreate.name')} maxLength={255} onChangeText={setName} placeholder={t('manualAssetCreate.namePlaceholder')} value={name} />
              <FormSelectRow key="kind" disabled={pending} label={t('manualAssetCreate.kind')} onChange={setKind} options={MANUAL_ASSET_KINDS.map((item) => ({ value: item, label: t(`manualAssets.kinds.${item}`) }))} placeholder={t('manualAssetCreate.choose')} value={kind} />
              <FormSelectRow key="currency" disabled={pending} label={t('manualAssetCreate.currency')} onChange={setCurrencyId} options={currencies.map((item) => ({ value: item.currencyKey, label: `${item.code} · ${item.description}` }))} placeholder={t('manualAssetCreate.choose')} value={currencyId} />
              <DateField key="valued-on" appearance="row" disabled={pending} label={t('manualAssetCreate.valuationDate')} maximumDate={today} onChange={(next) => setValuationDate(next ?? today)} value={valuationDate} />
              <FormTextRow key="purchase-price" accessibilityLabel={t('manualAssetCreate.purchasePriceOptional')} editable={!pending} error={errorFor('purchasePrice', purchasePrice, 'amount')} keyboardType="decimal-pad" label={t('manualAssetCreate.purchasePrice')} onChangeText={setPurchasePrice} placeholder={t('manualAssetCreate.optional')} value={purchasePrice} />
              <DateField key="purchase-date" appearance="row" disabled={pending} helperText={t('manualAssetCreate.purchaseHint')} label={t('manualAssetCreate.purchaseDate')} maximumDate={today} onChange={(next) => setPurchaseDate(next ?? '')} optional value={purchaseDate || null} />
              <FormTextRow key="growth" accessibilityLabel={t('manualAssetCreate.growthRateOptional')} editable={!pending} error={errorFor('growthRatePercent', growthRatePercent, 'growthRate')} hint={t('manualAssetCreate.growthRateHint')} keyboardType="numbers-and-punctuation" label={t('manualAssetCreate.growthRate')} onChangeText={setGrowthRatePercent} placeholder={t('manualAssetCreate.optional')} value={growthRatePercent} />
              <FormSwitchRow key="private" disabled={pending} hint={t('manualAssetCreate.privateDescription')} label={t('manualAssetCreate.private')} onValueChange={setIsPrivate} value={isPrivate} />
              <FormTextRow key="notes" accessibilityLabel={t('manualAssetCreate.notesOptional')} editable={!pending} label={t('manualAssetCreate.notes')} maxLength={10_000} multiline onChangeText={setNotes} placeholder={t('manualAssetCreate.optional')} value={notes} />
            </FormGroup>
            {outcome ? <Notice message={t(`manualAssets.failures.${outcome}`)} tone="destructive" /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function StatePage({ title, onBack, progress = false }: { title: string; onBack: () => void; progress?: boolean }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('manualAssetCreate.title')} />
      <View style={styles.state}>
        <Text accessibilityRole={progress ? 'progressbar' : 'alert'} tone={progress ? 'muted' : 'default'} variant="meta">{title}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  state: { flex: 1, alignItems: 'flex-start', padding: themeTokens.layout.screenPadding },
})
