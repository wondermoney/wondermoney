import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BackControl } from '@/components/ui/back-control'

import type { AccountSummaryViewModel } from '@/features/accounts/accounts-view-model'
import type { CategoryViewModel } from '@/features/categories/categories-view-model'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import {
  freezeManualTransaction,
  transactionDirection,
  type FrozenManualTransaction,
  type SettlementCurrencyDto,
  type TransactionMerchantDto,
  type TransactionTypeDto,
} from './manual-transaction-contract'
import type { ManualTransactionFailure } from './use-create-manual-transaction'
import { formatManualTransactionType } from './manual-transaction-types'


export type ManualTransactionScreenProps = Readonly<{
  accounts: readonly AccountSummaryViewModel[]
  categories: readonly CategoryViewModel[]
  types: readonly TransactionTypeDto[]
  currencies: readonly SettlementCurrencyDto[]
  merchants: readonly TransactionMerchantDto[]
  merchantSearchStatus: 'loading' | 'error' | 'loaded'
  initialAccountId: number | null
  loading: boolean
  metadataError: boolean
  pending: boolean
  outcome: ManualTransactionFailure | null
  onMerchantSearch: (value: string) => void
  onBack: () => void
  onEdit: () => void
  onSubmit: (value: FrozenManualTransaction) => Promise<void>
  onInspect: (value: FrozenManualTransaction) => void
}>

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function ManualTransactionScreen({
  accounts,
  categories,
  types,
  currencies,
  merchants,
  merchantSearchStatus,
  initialAccountId,
  loading,
  metadataError,
  pending,
  outcome,
  onMerchantSearch,
  onBack,
  onEdit,
  onSubmit,
  onInspect,
}: ManualTransactionScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [accountId, setAccountId] = useState<number | null>(initialAccountId)
  const [date, setDate] = useState(localToday)
  const [typeId, setTypeId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [currencyId, setCurrencyId] = useState<number | null>(null)
  const [selectedExistingMerchant, setSelectedExistingMerchant] = useState<TransactionMerchantDto | null>(null)
  const [merchantName, setMerchantName] = useState('')
  const [createMerchantIntent, setCreateMerchantIntent] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [frozen, setFrozen] = useState<FrozenManualTransaction | null>(null)
  const [validationError, setValidationError] = useState(false)
  const allCategories = useMemo(() => categories.flatMap((category) => [category, ...category.children]), [categories])

  const selectedAccount = accounts.find((item) => item.accountId === (frozen?.accountId ?? accountId))
  const selectedType = types.find((item) => item.transactionTypeKey === Number(frozen?.payload.transactionTypeId ?? typeId))
  const selectedCurrency = currencies.find((item) => item.currencyKey === Number(frozen?.payload.settlementCurrencyId ?? currencyId))
  const selectedMerchant = frozen?.payload.transactionMerchantId
    ? selectedExistingMerchant?.transactionMerchantKey === frozen.payload.transactionMerchantId
      ? selectedExistingMerchant
      : merchants.find((item) => item.transactionMerchantKey === frozen.payload.transactionMerchantId)
    : selectedExistingMerchant
  const selectedCategory = allCategories.find((item) => item.id === Number(frozen?.payload.categoryId ?? categoryId))
  const trimmedMerchantName = merchantName.trim()
  const conclusiveNoMatch = merchantSearchStatus === 'loaded' && trimmedMerchantName.length > 0 && merchants.length === 0
  const canUseNewMerchant = trimmedMerchantName.length > 0 && (createMerchantIntent || conclusiveNoMatch)
  const merchantIntentMissing = selectedExistingMerchant === null && !canUseNewMerchant
  const locked = pending || outcome === 'unknown' || merchantIntentMissing
  const merchantChoices = selectedExistingMerchant && !merchants.some((item) => item.transactionMerchantKey === selectedExistingMerchant.transactionMerchantKey)
    ? [selectedExistingMerchant, ...merchants]
    : merchants

  const review = () => {
    setValidationError(false)
    try {
      setFrozen(freezeManualTransaction({
        accountId: accountId as number,
        transactionDate: date,
        transactionTypeId: typeId as number,
        settlementAmount: amount,
        settlementCurrencyId: currencyId as number,
        existingMerchantId: selectedExistingMerchant?.transactionMerchantKey,
        newMerchantName: canUseNewMerchant ? merchantName : '',
        categoryId,
        description,
      }))
    } catch {
      setValidationError(true)
    }
  }

  if (loading) return <StatePage palette={palette} title={t('transactionCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('transactionCreate.metadataError')} onBack={onBack} />

  const direction = selectedType ? transactionDirection(selectedType.name) : null
  const localizedType = selectedType ? formatManualTransactionType(t, selectedType.name) : ''
  const merchantLabel = selectedMerchant?.name ?? frozen?.payload.transactionMerchantName ?? merchantName.trim()
  const formattedAmount = frozen && selectedCurrency
    ? formatCurrency(Number(frozen.payload.settlementAmount), { locale, currency: selectedCurrency.code })
    : null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          <BackControl fallback="/accounts" label={t('transactionCreate.back')} onPress={onBack} disabled={pending} />
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('transactionCreate.title')}</Text>
            <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('transactionCreate.helper')}</Text>
          </View>

          {frozen ? (
            <View style={[styles.review, { borderColor: outcome === 'unknown' ? palette.destructive : palette.primary, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t(outcome === 'unknown' ? 'transactionCreate.unknown.title' : 'transactionCreate.reviewTitle')}</Text>
              {outcome === 'unknown' ? <Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t('transactionCreate.unknown.message')}</Text> : <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('transactionCreate.reviewHelper')}</Text>}
              <ReviewRow label={t('transactionCreate.account')} value={selectedAccount?.accountName ?? t('accounts.unnamed')} palette={palette} />
              <ReviewRow label={t('transactionCreate.date')} value={new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(frozen.payload.transactionDate))} palette={palette} />
              <ReviewRow label={t('transactionCreate.type')} value={selectedType ? t('transactionCreate.typeValue', { type: localizedType, direction: t(`transactions.${direction}`) }) : ''} palette={palette} />
              <ReviewRow label={t('transactionCreate.merchant')} value={merchantLabel} palette={palette} />
              <ReviewRow label={t('transactionCreate.amount')} value={formattedAmount ?? ''} palette={palette} data />
              <Text style={[styles.effect, { color: direction === 'credit' ? palette.successText : palette.destructiveText }]}>{t(`transactionCreate.effect.${direction}`, { amount: formattedAmount })}</Text>
              {selectedCategory ? <ReviewRow label={t('transactionCreate.category')} value={selectedCategory.name} palette={palette} /> : null}
              {frozen.payload.description ? <ReviewRow label={t('transactionCreate.description')} value={frozen.payload.description} palette={palette} /> : null}
              {outcome && outcome !== 'unknown' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border }]}>{t(`transactionCreate.result.${outcome}`)}</Text> : null}
              <View style={styles.actions}>
                {outcome === 'unknown'
                  ? <Button label={t('transactionCreate.unknown.inspect')} onPress={() => onInspect(frozen)} palette={palette} primary />
                  : <><Button label={t('transactionCreate.edit')} onPress={() => { setFrozen(null); onEdit() }} palette={palette} disabled={pending} /><Button label={pending ? t('transactionCreate.submitting') : t('transactionCreate.confirm')} onPress={() => onSubmit(frozen)} palette={palette} primary disabled={pending || (outcome !== null && outcome !== 'cancelled')} busy={pending} /></>}
              </View>
            </View>
          ) : (
            <View style={styles.form}>
              <ChoiceField label={t('transactionCreate.account')} items={accounts.map((item) => ({ id: item.accountId, label: item.accountName ?? t('accounts.unnamed') }))} value={accountId} onChange={setAccountId} palette={palette} />
              <Field label={t('transactionCreate.date')} value={date} onChangeText={setDate} placeholder={t('transactionCreate.datePlaceholder')} palette={palette} maxLength={10} />
              <ChoiceField label={t('transactionCreate.type')} items={types.map((item) => ({ id: item.transactionTypeKey, label: formatManualTransactionType(t, item.name) }))} value={typeId} onChange={setTypeId} palette={palette} />
              <Field label={t('transactionCreate.amount')} value={amount} onChangeText={setAmount} placeholder="0.00" palette={palette} keyboardType="decimal-pad" />
              <ChoiceField label={t('transactionCreate.currency')} items={currencies.map((item) => ({ id: item.currencyKey, label: `${item.code}${item.description ? ` · ${item.description}` : ''}` }))} value={currencyId} onChange={setCurrencyId} palette={palette} />
              <Field label={t('transactionCreate.merchantSearch')} value={merchantName} onChangeText={(value) => { setMerchantName(value); onMerchantSearch(value) }} placeholder={t('transactionCreate.merchantPlaceholder')} palette={palette} maxLength={200} />
              {merchantSearchStatus === 'loading' ? <Text accessibilityRole="progressbar" style={[styles.body, { color: palette.mutedForeground }]}>{t('transactionCreate.merchantSearching')}</Text> : null}
              {merchantSearchStatus === 'error' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border }]}>{t('transactionCreate.merchantSearchUnavailable')}</Text> : null}
              {conclusiveNoMatch ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('transactionCreate.merchantNoMatches')}</Text> : null}
              <ChoiceField label={t('transactionCreate.existingMerchant')} items={merchantChoices.map((item) => ({ id: item.transactionMerchantKey, label: item.name }))} value={selectedExistingMerchant?.transactionMerchantKey ?? null} onChange={(id) => { const merchant = merchantChoices.find((item) => item.transactionMerchantKey === id) ?? null; setSelectedExistingMerchant(merchant); if (merchant) setCreateMerchantIntent(false) }} palette={palette} />
              {selectedExistingMerchant ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('transactionCreate.selectedMerchant', { merchant: selectedExistingMerchant.name })}</Text> : null}
              <Button label={t('transactionCreate.createNewMerchant')} onPress={() => { setSelectedExistingMerchant(null); setCreateMerchantIntent(true) }} palette={palette} disabled={trimmedMerchantName.length === 0} selected={createMerchantIntent} />
              <ChoiceField label={t('transactionCreate.categoryOptional')} items={allCategories.map((item) => ({ id: item.id, label: item.name }))} value={categoryId} onChange={setCategoryId} palette={palette} clearLabel={t('transactionCreate.noCategory')} />
              <Field label={t('transactionCreate.descriptionOptional')} value={description} onChangeText={setDescription} placeholder={t('transactionCreate.descriptionPlaceholder')} palette={palette} maxLength={500} multiline />
              {validationError ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.destructive, borderColor: palette.destructive }]}>{t('transactionCreate.validation')}</Text> : null}
              <Button label={t('transactionCreate.review')} onPress={review} palette={palette} primary disabled={locked} />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Field({ label, palette, ...props }: { label: string; palette: Palette } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={palette.mutedForeground} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} {...props} /></View>
}

function ChoiceField({ label, items, value, onChange, palette, clearLabel }: { label: string; items: readonly { id: number; label: string }[]; value: number | null; onChange: (id: number | null) => void; palette: Palette; clearLabel?: string }) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>{clearLabel ? <Choice label={clearLabel} selected={value === null} onPress={() => onChange(null)} palette={palette} /> : null}{items.map((item) => <Choice key={item.id} label={item.label} selected={value === item.id} onPress={() => onChange(item.id)} palette={palette} />)}</View></View>
}

function Choice({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) {
  return <Pressable accessibilityRole="radio" hitSlop={{ top: 7, bottom: 7 }} accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }]}><Text style={[styles.choiceText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text></Pressable>
}

function ReviewRow({ label, value, palette, data = false }: { label: string; value: string; palette: Palette; data?: boolean }) {
  return <View style={styles.reviewRow}><Text style={[styles.caption, { color: palette.mutedForeground }]}>{label}</Text><Text style={[data ? styles.data : styles.body, { color: palette.foreground }]}>{value}</Text></View>
}

function Button({ label, accessibilityLabel, onPress, palette, primary = false, disabled = false, busy = false, selected = false }: { label: string; accessibilityLabel?: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean; busy?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled, busy, selected }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: palette.primary, backgroundColor: primary || selected ? palette.primary : 'transparent' }, (pressed || disabled) && styles.disabled]}><Text style={[styles.buttonText, { color: primary || selected ? palette.background : palette.primary }]}>{label}</Text></Pressable>
}

function StatePage({ palette, title, onBack, progress = false }: { palette: Palette; title: string; onBack: () => void; progress?: boolean }) {
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.state}><BackControl fallback="/accounts" onPress={onBack} color={palette.primary} /><Text accessibilityRole={progress ? 'progressbar' : 'alert'} style={[styles.body, { color: palette.foreground }]}>{title}</Text></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, sectionTitle: { ...textStyles.section }, body: { ...textStyles.body }, form: { gap: themeTokens.spacing[5] }, field: { gap: themeTokens.spacing[2] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.body, minHeight: 50, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choiceText: { ...textStyles.meta }, review: { borderWidth: 2, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, reviewRow: { gap: themeTokens.spacing[1] }, caption: { ...textStyles.label }, data: { ...textStyles.amount }, effect: { ...textStyles.action }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[5] }, buttonText: { ...textStyles.action }, disabled: { opacity: 0.55 }, banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, state: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
})
