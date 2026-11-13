import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { DateField } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormRowNote, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatNumberInput, toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { buildManualAssetUpdatePayload, manualAssetEditDraftOf, type ManualAssetEditDraft } from './asset-forms-model'
import { isCryptoWallet, MANUAL_ASSET_KINDS, type ManualAssetDto, type ManualAssetUpdateWrite } from './manual-assets-contract'
import { localToday } from './manual-assets-view-model'
import type { ManualAssetWriteFailure } from './use-manual-asset-writes'

export type AssetEditViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-id' }
  | { status: 'loaded'; asset: ManualAssetDto }

/**
 * Edit asset: web's `ManualAssetFormDrawer` for an existing asset, as a flow like Add asset (the
 * form bar's close and save, then one group of rows). The name, kind, purchase, yearly change,
 * privacy and notes change here; the currency is fixed and the value changes through Update
 * value, which keeps the history. Privacy is the owner's alone, and the form says so to anyone
 * else. Only what changed is sent, so the ✓ waits until something has changed and is valid.
 */
export function AssetEditScreen({ state, pending, outcome, onBack, onSave }: Readonly<{
  state: AssetEditViewState
  pending: boolean
  outcome: ManualAssetWriteFailure | null
  onBack: () => void
  onSave: (value: ManualAssetUpdateWrite) => Promise<void>
}>) {
  const { t } = useTranslation()
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <StatePage title={t('manualAssetEdit.loading')} onBack={onBack} progress />
  if (state.status !== 'loaded') {
    const key = state.status === 'not-found' || state.status === 'invalid-id' ? 'notFound' : state.status === 'invalid-response' ? 'invalid' : 'error'
    return <StatePage title={t(`manualAssetEdit.${key}`)} onBack={onBack} />
  }
  // Keyed by the asset, so the form starts again from whatever asset it is given.
  return <AssetEditForm key={state.asset.manualAssetKey} asset={state.asset} pending={pending} outcome={outcome} onBack={onBack} onSave={onSave} />
}

function AssetEditForm({ asset, pending, outcome, onBack, onSave }: Readonly<{
  asset: ManualAssetDto
  pending: boolean
  outcome: ManualAssetWriteFailure | null
  onBack: () => void
  onSave: (value: ManualAssetUpdateWrite) => Promise<void>
}>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [draft, setDraft] = useState<ManualAssetEditDraft>(() => manualAssetEditDraftOf(asset, (value) => formatNumberInput(value, locale)))
  const set = (patch: Partial<ManualAssetEditDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const wallet = isCryptoWallet(asset)
  // Read in the app's language ("1.234,56" in pt and es), then handed on as dot decimals.
  const result = buildManualAssetUpdatePayload(asset, {
    ...draft,
    purchasePrice: toWireDecimalInput(draft.purchasePrice, locale),
    growthRatePercent: toWireDecimalInput(draft.growthRatePercent, locale),
  })
  const invalid: ReadonlySet<string> = result.success ? new Set() : result.invalidFields
  const errorFor = (field: string, key: string) => (invalid.has(field) ? t(key) : null)
  const canSave = result.success && result.payload !== null && !pending
  const today = localToday()

  const submit = () => {
    if (!canSave || !result.success || result.payload === null) return
    void onSave(result.payload)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={submit}
        saveDisabled={!canSave}
        saveLabel={pending ? t('manualAssetEdit.saving') : t('manualAssetEdit.save')}
        saving={pending}
        title={t('manualAssetEdit.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <FormGroup>
              <FormTextRow key="name" editable={!pending} error={errorFor('name', 'manualAssetEdit.fieldErrors.name')} label={t('manualAssetCreate.name')} maxLength={255} onChangeText={(name) => set({ name })} placeholder={t('manualAssetCreate.namePlaceholder')} value={draft.name} />
              {/* An array, not a fragment: the group draws a rule between each of its rows. */}
              {!wallet ? [
                <FormSelectRow key="kind" disabled={pending} label={t('manualAssetCreate.kind')} onChange={(kind) => set({ kind })} options={MANUAL_ASSET_KINDS.map((item) => ({ value: item, label: t(`manualAssets.kinds.${item}`) }))} placeholder={t('manualAssetCreate.choose')} value={draft.kind} />,
                <FormTextRow key="purchase-price" accessibilityLabel={t('manualAssetCreate.purchasePriceOptional')} editable={!pending} error={errorFor('purchasePrice', 'manualAssetCreate.fieldErrors.amount')} keyboardType="decimal-pad" label={t('manualAssetCreate.purchasePrice')} onChangeText={(purchasePrice) => set({ purchasePrice })} placeholder={t('manualAssetCreate.optional')} value={draft.purchasePrice} />,
                <DateField key="purchase-date" appearance="row" disabled={pending} label={t('manualAssetCreate.purchaseDate')} maximumDate={today} onChange={(next) => set({ purchaseDate: next ?? '' })} optional value={draft.purchaseDate || null} />,
                <FormTextRow key="growth" accessibilityLabel={t('manualAssetCreate.growthRateOptional')} editable={!pending} error={errorFor('growthRatePercent', 'manualAssetCreate.fieldErrors.growthRate')} hint={t('manualAssetCreate.growthRateHint')} keyboardType="numbers-and-punctuation" label={t('manualAssetCreate.growthRate')} onChangeText={(growthRatePercent) => set({ growthRatePercent })} placeholder={t('manualAssetCreate.optional')} value={draft.growthRatePercent} />,
                <DateField key="growth-start" appearance="row" disabled={pending} helperText={t('manualAssetEdit.growthStartDateHint')} label={t('manualAssetEdit.growthStartDate')} onChange={(next) => set({ growthStartDate: next ?? '' })} optional value={draft.growthStartDate || null} />,
              ] : null}
              {/* Only the owner decides whether the other member sees it. */}
              {asset.isOwner ? <FormSwitchRow key="private" disabled={pending} hint={t('manualAssetCreate.privateDescription')} label={t('manualAssetCreate.private')} onValueChange={(isPrivate) => set({ isPrivate })} value={draft.isPrivate} /> : null}
              <FormTextRow key="notes" accessibilityLabel={t('manualAssetCreate.notesOptional')} editable={!pending} label={t('manualAssetCreate.notes')} maxLength={10_000} multiline onChangeText={(notes) => set({ notes })} placeholder={t('manualAssetCreate.optional')} value={draft.notes} />
            </FormGroup>
            {!asset.isOwner ? <FormRowNote>{t('manualAssetEdit.ownerOnlyPrivacy')}</FormRowNote> : null}
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
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('manualAssetEdit.title')} />
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
