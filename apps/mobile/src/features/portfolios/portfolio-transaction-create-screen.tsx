import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { DateField } from '@/components/ui/date-field'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormRow, FormRowNote, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'
import type { TickerSearchResultDto } from '@/features/markets/markets-contract'
import { useTickerSearch } from '@/features/markets/use-ticker-search'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { PortfolioCurrencyDto, PortfolioTransactionTypeDto } from './portfolios-contract'
import type { PortfolioPalette } from './portfolio-form-parts'
import type { CreatePortfolioTransactionFailure } from './use-create-portfolio-transaction'

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

type TransactionField = 'type' | 'asset' | 'quantity' | 'unitPrice' | 'date' | 'currency'

const QUANTITY_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function invalidFields(draft: {
  assetSymbol: string
  financialTransactionTypeId: number | null
  settlementCurrencyId: number | null
  quantity: string
  unitPrice: string
  transactionDate: string
}): ReadonlySet<TransactionField> {
  const fields = new Set<TransactionField>()
  if (draft.financialTransactionTypeId === null) fields.add('type')
  if (draft.assetSymbol.trim().length === 0) fields.add('asset')
  if (!(QUANTITY_PATTERN.test(draft.quantity.trim()) && Number(draft.quantity.trim()) > 0)) fields.add('quantity')
  if (!(QUANTITY_PATTERN.test(draft.unitPrice.trim()) && Number(draft.unitPrice.trim()) > 0)) fields.add('unitPrice')
  if (!DATE_PATTERN.test(draft.transactionDate.trim())) fields.add('date')
  if (draft.settlementCurrencyId === null) fields.add('currency')
  return fields
}

export type PortfolioTransactionCreateDraftState = Readonly<{
  assetSymbol: string
  financialTransactionTypeId: number | null
  settlementCurrencyId: number | null
  quantity: string
  unitPrice: string
  transactionDate: string
  notes: string
}>

export type PortfolioTransactionCreateScreenProps = Readonly<{
  transactionTypes: readonly PortfolioTransactionTypeDto[]
  currencies: readonly PortfolioCurrencyDto[]
  defaultCurrencyId: number | null
  loading: boolean
  metadataError: boolean
  pending: boolean
  outcome: CreatePortfolioTransactionFailure | null
  palette: PortfolioPalette
  onBack: () => void
  onCreate: (draft: PortfolioTransactionCreateDraftState) => Promise<void>
}>

const SEGMENT_TYPES = new Set(['BUY', 'SELL'])

/**
 * Manual BUY/SELL transaction entry, as a calm-structure flow: the form bar
 * (close, save), the unit price big and centred, Buy | Sell, then one group
 * of rows. Mirrors web's PortfolioTransactionAddModal field set minus
 * broker/fee/original-currency (mobile-scoped, same rationale as the edit
 * form), and never offers DIVIDEND as a type: the route passes the
 * already-filtered transactionTypes list.
 */
export function PortfolioTransactionCreateScreen({ transactionTypes, currencies, defaultCurrencyId, loading, metadataError, pending, outcome, palette, onBack, onCreate }: PortfolioTransactionCreateScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [assetSymbol, setAssetSymbol] = useState('')
  // Buy is chosen up front, as Expense is on Add transaction. The types can
  // arrive after the first render, so the default is derived (BUY by name,
  // else the first type) until the person picks one.
  const [chosenTypeId, setFinancialTransactionTypeId] = useState<number | null>(null)
  const defaultType = transactionTypes.find((type) => type.name.toUpperCase() === 'BUY') ?? transactionTypes[0]
  const financialTransactionTypeId = chosenTypeId ?? defaultType?.financialTransactionTypeKey ?? null
  const [settlementCurrencyId, setSettlementCurrencyId] = useState<number | null>(defaultCurrencyId)
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [transactionDate, setTransactionDate] = useState(localToday)
  const [notes, setNotes] = useState('')
  const locked = pending

  if (loading) return <StatePage palette={palette} title={t('portfolioTransactionCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('portfolioTransactionCreate.metadataError')} onBack={onBack} />

  // Re-derived on every render. A field not filled yet only keeps the ✓
  // disabled; an error shows under a row for what was entered and is wrong.
  // Numbers are read in the app's language ("1.234,56" in pt and es) and kept as dot decimals.
  const decimal = (value: string) => toWireDecimalInput(value, locale)
  const draft = { assetSymbol, financialTransactionTypeId, settlementCurrencyId, quantity: decimal(quantity), unitPrice: decimal(unitPrice), transactionDate }
  const invalid = invalidFields(draft)
  const ready = invalid.size === 0
  const quantityError = quantity.trim() !== '' && invalid.has('quantity') ? t('portfolioTransactionCreate.fieldErrors.quantity') : null
  const unitPriceError = unitPrice.trim() !== '' && invalid.has('unitPrice') ? t('portfolioTransactionCreate.fieldErrors.unitPrice') : null
  const dateError = transactionDate.trim() !== '' && invalid.has('date') ? t('portfolioTransactionCreate.fieldErrors.date') : undefined
  const currency = currencies.find((item) => item.currencyKey === settlementCurrencyId) ?? null
  const typeLabel = (type: PortfolioTransactionTypeDto) => t(`portfolioTransactionCreate.types.${type.name.toUpperCase()}`, { defaultValue: formatCategoryName(type.name) })

  // Buy | Sell are the segmented control; any other type (deposit, withdrawal,
  // offer…) is chosen from a Type row, so no segment label ever has to break.
  const segmentTypes = transactionTypes.filter((type) => SEGMENT_TYPES.has(type.name.toUpperCase()))
  const showTypeRow = transactionTypes.length > 1 && segmentTypes.length < transactionTypes.length

  const submit = () => {
    if (!ready || locked) return
    void onCreate({ ...draft, notes })
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={submit}
        saveDisabled={!ready || locked}
        saveLabel={pending ? t('portfolioTransactionCreate.saving') : t('portfolioTransactionCreate.save')}
        saving={pending}
        title={t('portfolioTransactionCreate.title')}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          <AmountEntry
            accessibilityLabel={t('portfolioTransactionCreate.unitPrice')}
            caption={t('portfolioTransactionCreate.unitPrice')}
            currency={currency?.code ?? null}
            editable={!locked}
            error={unitPriceError}
            locale={locale}
            onChangeText={setUnitPrice}
            value={unitPrice}
          />
          {segmentTypes.length > 1 ? (
            <SegmentedControl
              accessibilityLabel={t('portfolioTransactionCreate.type')}
              fill
              onChange={(value) => { if (!locked) setFinancialTransactionTypeId(Number(value)) }}
              options={segmentTypes.map((type) => ({ value: String(type.financialTransactionTypeKey), label: typeLabel(type) }))}
              value={String(financialTransactionTypeId)}
            />
          ) : null}
          <FormGroup>
            {showTypeRow ? (
              <FormSelectRow
                key="type"
                accessibilityLabel={t('portfolioTransactionCreate.type')}
                disabled={locked}
                label={t('transactionCreate.typeShort')}
                onChange={setFinancialTransactionTypeId}
                options={transactionTypes.map((type) => ({ value: type.financialTransactionTypeKey, label: typeLabel(type) }))}
                placeholder={t('transactionCreate.choose')}
                sheetTitle={t('portfolioTransactionCreate.type')}
                value={financialTransactionTypeId}
              />
            ) : null}
            <AssetRow key="asset" disabled={locked} label={t('portfolioTransactionCreate.asset')} onChange={setAssetSymbol} symbol={assetSymbol} />
            <FormTextRow key="quantity" editable={!locked} error={quantityError} keyboardType="decimal-pad" label={t('portfolioTransactionCreate.quantity')} maxLength={20} onChangeText={setQuantity} placeholder="0" value={quantity} />
            <FormSelectRow
              key="currency"
              disabled={locked}
              label={t('portfolioTransactionCreate.currency')}
              onChange={setSettlementCurrencyId}
              options={currencies.map((item) => ({ value: item.currencyKey, label: `${item.code} · ${item.description}` }))}
              placeholder={t('transactionCreate.choose')}
              value={settlementCurrencyId}
            />
            <DateField key="date" appearance="row" disabled={locked} error={dateError} label={t('portfolioTransactionCreate.transactionDate')} maximumDate={localToday()} onChange={(value) => setTransactionDate(value ?? '')} value={transactionDate || null} />
            <FormTextRow key="notes" accessibilityLabel={t('portfolioTransactionCreate.notesOptional')} editable={!locked} label={t('transactionCreate.note')} maxLength={1000} multiline onChangeText={setNotes} placeholder={t('transactionCreate.optional')} value={notes} />
          </FormGroup>
          {outcome ? <Notice message={t(`portfolioTransactionCreate.failures.${outcome}`)} tone="destructive" /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The asset as a row: a search the person types into, its matches listed
 * under it, and once one is picked, a row showing it (tap to change).
 */
function AssetRow({ label, symbol, onChange, disabled }: { label: string; symbol: string; onChange: (symbol: string) => void; disabled: boolean }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const search = useTickerSearch(symbol ? '' : query)
  const trimmed = query.trim()
  const results = search.data?.results ?? []

  if (symbol) {
    return (
      <FormRow
        disabled={disabled}
        hint={t('portfolioTransactionCreate.changeAsset')}
        label={label}
        onPress={() => onChange('')}
        value={symbol}
        valueLeading={<EntityMark {...assetMark(symbol, null)} size="sm" />}
      />
    )
  }
  return (
    <View>
      <FormTextRow
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!disabled}
        label={label}
        onChangeText={setQuery}
        placeholder={t('portfolioTickerSearch.placeholder')}
        value={query}
      />
      {trimmed.length > 0 && search.isFetching ? <Text accessibilityLabel={t('portfolioTickerSearch.searching')} accessibilityRole="progressbar" style={styles.note} tone="muted" variant="meta">{t('portfolioTickerSearch.searching')}</Text> : null}
      {trimmed.length > 0 && !search.isFetching && results.length === 0 ? <FormRowNote>{t('portfolioTickerSearch.noResults')}</FormRowNote> : null}
      {results.map((result: TickerSearchResultDto) => (
        <AssetResult key={`${result.symbol}-${result.exchange ?? ''}`} disabled={disabled} onPress={() => { setQuery(''); onChange(result.symbol) }} result={result} />
      ))}
    </View>
  )
}

function AssetResult({ result, onPress, disabled }: { result: TickerSearchResultDto; onPress: () => void; disabled: boolean }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={[result.name, result.symbol, result.exchange].filter(Boolean).join(', ')}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.result, pressed && { backgroundColor: palette.muted }, focused && [styles.focused, { borderColor: palette.ring }], disabled && styles.disabled]}
    >
      <EntityMark {...assetMark(result.symbol, null)} size="sm" />
      <View style={styles.resultText}>
        <Text numberOfLines={1} variant="bodyStrong">{result.symbol}{result.exchange ? ` · ${result.exchange}` : ''}</Text>
        {result.name ? <Text numberOfLines={1} tone="muted" variant="meta">{result.name}</Text> : null}
      </View>
    </Pressable>
  )
}

function StatePage({ palette, title, onBack, progress = false }: { palette: PortfolioPalette; title: string; onBack: () => void; progress?: boolean }) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('portfolioTransactionCreate.title')} />
      <View style={styles.state}>
        <Text accessibilityRole={progress ? 'progressbar' : 'alert'} tone={progress ? 'muted' : 'default'} variant="meta">{title}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  note: { paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3] },
  result: { minHeight: themeTokens.touchTarget.minimum + themeTokens.spacing[2], flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] },
  resultText: { flex: 1, minWidth: 0 },
  // Focus draws inside the row so the group's hairlines don't move.
  focused: { borderWidth: 2, borderRadius: themeTokens.radius.xl },
  disabled: { opacity: 0.5 },
  state: { flex: 1, alignItems: 'flex-start', padding: themeTokens.layout.screenPadding },
})
