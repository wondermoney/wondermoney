import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioCurrencyDto, PortfolioTransactionTypeDto } from './portfolios-contract'
import { PortfolioButton, PortfolioChoice, PortfolioField, type PortfolioPalette } from './portfolio-form-parts'
import { PortfolioTickerSearchField } from './portfolio-ticker-search-field'
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

/**
 * Manual BUY/SELL transaction entry. Mirrors web's PortfolioTransactionAddModal field
 * set minus broker/fee/original-currency (mobile-scoped, same rationale as the edit form), and
 * deliberately never offers DIVIDEND as a type — the screen only ever receives the already-filtered
 * transactionTypes list from its route.
 */
export function PortfolioTransactionCreateScreen({ transactionTypes, currencies, defaultCurrencyId, loading, metadataError, pending, outcome, palette, onBack, onCreate }: PortfolioTransactionCreateScreenProps) {
  const { t } = useTranslation()
  const [assetSymbol, setAssetSymbol] = useState('')
  const [financialTransactionTypeId, setFinancialTransactionTypeId] = useState<number | null>(null)
  const [settlementCurrencyId, setSettlementCurrencyId] = useState<number | null>(defaultCurrencyId)
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [transactionDate, setTransactionDate] = useState(localToday)
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const locked = pending

  if (loading) return <StatePage palette={palette} title={t('portfolioTransactionCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('portfolioTransactionCreate.metadataError')} onBack={onBack} />

  // Re-derived from current state on every render (not stored separately) so
  // a field's error clears the moment it's fixed, not only on the next
  // submit — but only once a first submit attempt has happened.
  const draftFields = { assetSymbol, financialTransactionTypeId, settlementCurrencyId, quantity, unitPrice, transactionDate }
  const shown = submitted ? invalidFields(draftFields) : new Set<TransactionField>()

  const submit = async () => {
    setSubmitted(true)
    const fields = invalidFields(draftFields)
    if (fields.size > 0) return
    await onCreate({ assetSymbol, financialTransactionTypeId, notes, quantity, settlementCurrencyId, transactionDate, unitPrice })
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          <BackControl fallback="/portfolio" label={t('portfolioTransactionCreate.back')} onPress={onBack} disabled={locked} />
          <View style={styles.heading}>
            <PageHeader palette={palette}
            instruction={t('portfolioTransactionCreate.helper')} title={t('portfolioTransactionCreate.title')} />
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.foreground }]}>{t('portfolioTransactionCreate.type')} *</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={t('portfolioTransactionCreate.type')} style={styles.options}>
                {transactionTypes.map((type) => (
                  <PortfolioChoice
                    key={type.financialTransactionTypeKey}
                    label={t(`portfolioTransactionCreate.types.${type.name.toUpperCase()}`, { defaultValue: formatCategoryName(type.name) })}
                    selected={financialTransactionTypeId === type.financialTransactionTypeKey}
                    onPress={() => setFinancialTransactionTypeId(type.financialTransactionTypeKey)}
                    palette={palette}
                    disabled={locked}
                  />
                ))}
              </View>
              {shown.has('type') ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{t('portfolioTransactionCreate.fieldErrors.type')}</Text> : null}
            </View>

            {assetSymbol ? (
              <View style={styles.field}>
                <Text style={[styles.label, { color: palette.foreground }]}>{t('portfolioTransactionCreate.asset')} *</Text>
                <View style={[styles.selectedAsset, { borderColor: palette.border, backgroundColor: palette.muted }]}>
                  <Text accessibilityLabel={`${t('portfolioTransactionCreate.asset')}: ${assetSymbol}`} style={[styles.selectedAssetText, { color: palette.foreground }]}>{assetSymbol}</Text>
                  <PortfolioButton label={t('portfolioTransactionCreate.changeAsset')} onPress={() => setAssetSymbol('')} palette={palette} secondary disabled={locked} />
                </View>
              </View>
            ) : (
              <View style={styles.field}>
                <PortfolioTickerSearchField
                  label={`${t('portfolioTransactionCreate.asset')} *`}
                  palette={palette}
                  disabled={locked}
                  onSelect={(result) => setAssetSymbol(result.symbol)}
                />
                {shown.has('asset') ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{t('portfolioTransactionCreate.fieldErrors.asset')}</Text> : null}
              </View>
            )}

            <PortfolioField label={t('portfolioTransactionCreate.quantity')} value={quantity} onChange={setQuantity} palette={palette} maxLength={20} required disabled={locked} keyboardType="decimal-pad" invalid={shown.has('quantity')} errorText={shown.has('quantity') ? t('portfolioTransactionCreate.fieldErrors.quantity') : undefined} />
            <PortfolioField label={t('portfolioTransactionCreate.unitPrice')} value={unitPrice} onChange={setUnitPrice} palette={palette} maxLength={20} required disabled={locked} keyboardType="decimal-pad" invalid={shown.has('unitPrice')} errorText={shown.has('unitPrice') ? t('portfolioTransactionCreate.fieldErrors.unitPrice') : undefined} />
            <PortfolioField label={t('portfolioTransactionCreate.transactionDate')} value={transactionDate} onChange={setTransactionDate} palette={palette} maxLength={10} required disabled={locked} invalid={shown.has('date')} errorText={shown.has('date') ? t('portfolioTransactionCreate.fieldErrors.date') : undefined} />

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.foreground }]}>{t('portfolioTransactionCreate.currency')} *</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={t('portfolioTransactionCreate.currency')} style={styles.options}>
                {currencies.map((currency) => (
                  <PortfolioChoice
                    key={currency.currencyKey}
                    compact
                    label={`${currency.code} · ${currency.description}`}
                    visibleLabel={currency.code}
                    selected={settlementCurrencyId === currency.currencyKey}
                    onPress={() => setSettlementCurrencyId(currency.currencyKey)}
                    palette={palette}
                    disabled={locked}
                  />
                ))}
              </View>
              {shown.has('currency') ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{t('portfolioTransactionCreate.fieldErrors.currency')}</Text> : null}
            </View>

            <PortfolioField label={t('portfolioTransactionCreate.notesOptional')} value={notes} onChange={setNotes} palette={palette} maxLength={1000} multiline disabled={locked} />

          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.background }]}>
        {outcome ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructiveText }]}>{t(`portfolioTransactionCreate.failures.${outcome}`)}</Text> : null}
        <PortfolioButton label={pending ? t('portfolioTransactionCreate.saving') : t('portfolioTransactionCreate.save')} onPress={submit} palette={palette} disabled={locked} busy={pending} />
      </View>
    </SafeAreaView>
  )
}

function StatePage({ palette, title, onBack, progress = false }: { palette: PortfolioPalette; title: string; onBack: () => void; progress?: boolean }) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <View style={styles.state}>
        <BackControl fallback="/portfolio" label={t('portfolioTransactionCreate.back')} onPress={onBack} />
        <Text accessibilityRole={progress ? 'progressbar' : 'alert'} style={[styles.helper, { color: palette.foreground }]}>{title}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth * 2, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[2] },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  heading: { gap: themeTokens.spacing[1] },
  helper: { ...textStyles.body },
  form: { gap: themeTokens.spacing[4] },
  field: { gap: themeTokens.spacing[2] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  selectedAsset: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
  selectedAssetText: { ...textStyles.amount },
  alert: { ...textStyles.body },
  fieldError: { ...textStyles.amountSmall },
  state: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
})
