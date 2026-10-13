import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import type { AccountSummaryViewModel } from '@/features/accounts/accounts-view-model'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { SettlementCurrencyDto, TransactionTypeDto } from './manual-transaction-contract'
import { formatManualTransactionType } from './manual-transaction-types'
import type { TransactionOcrScanDto } from './transaction-ocr-contract'
import type { ConfirmTransactionOcrInput, TransactionOcrPhase } from './use-transaction-ocr'


export type TransactionOcrScreenProps = Readonly<{
  state: TransactionOcrPhase
  accounts: readonly AccountSummaryViewModel[]
  types: readonly TransactionTypeDto[]
  currencies: readonly SettlementCurrencyDto[]
  metadataLoading: boolean
  onPickFile: () => void | Promise<void>
  onConfirm: (input: ConfirmTransactionOcrInput) => void | Promise<void>
  onReject: () => void | Promise<void>
  onReset: () => void
  onBack: () => void
}>

const isoToDateOnly = (value: string): string => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

export function TransactionOcrScreen({
  state,
  accounts,
  types,
  currencies,
  metadataLoading,
  onPickFile,
  onConfirm,
  onReject,
  onReset,
  onBack,
}: TransactionOcrScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const reviewing = state.phase === 'review' || state.phase === 'confirming'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/accounts" label={t('transactionOcr.back')} onPress={onBack} disabled={state.phase === 'scanning' || state.phase === 'confirming'} />
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('transactionOcr.title')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionOcr.helper')}</Text>
            </View>
          </View>

          {state.phase === 'idle' ? (
            <Button label={t('transactionOcr.chooseFile')} onPress={onPickFile} palette={palette} primary />
          ) : null}

          {state.phase === 'scanning' ? (
            <Text accessibilityRole="progressbar" accessibilityLabel={t('transactionOcr.scanning')} style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionOcr.scanning')}</Text>
          ) : null}

          {reviewing ? (
            <ReviewForm
              key={state.scan.transactionOcrImportId}
              scan={state.scan}
              busy={state.phase === 'confirming'}
              confirmError={state.phase === 'review' ? state.confirmError : undefined}
              accounts={accounts}
              types={types}
              currencies={currencies}
              metadataLoading={metadataLoading}
              onConfirm={onConfirm}
              onReject={onReject}
              palette={palette}
            />
          ) : null}

          {state.phase === 'succeeded' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.outcome, { color: palette.foreground }]}>{t('transactionOcr.succeeded')}</Text>
              <View style={styles.actions}>
                <Button label={t('transactionOcr.scanAnother')} onPress={onReset} palette={palette} />
                <Button label={t('transactionOcr.done')} onPress={onBack} palette={palette} primary />
              </View>
            </View>
          ) : null}

          {state.phase === 'error' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.outcome, { color: palette.destructive }]}>{t(`transactionOcr.failures.${state.reason}`)}</Text>
              <Button label={t('transactionOcr.tryAgain')} onPress={onReset} palette={palette} primary />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

type ReviewFormProps = Readonly<{
  scan: TransactionOcrScanDto
  busy: boolean
  confirmError?: string
  accounts: readonly AccountSummaryViewModel[]
  types: readonly TransactionTypeDto[]
  currencies: readonly SettlementCurrencyDto[]
  metadataLoading: boolean
  onConfirm: (input: ConfirmTransactionOcrInput) => void | Promise<void>
  onReject: () => void | Promise<void>
  palette: Palette
}>

/** Keyed by scan.transactionOcrImportId in the parent so every field initializes directly from
 * the scan (no effect-driven prefill, matching this repo's key-remount convention for
 * loaded-data forms, e.g. account-edit-screen.tsx's AccountEditForm). */
function ReviewForm({ scan, busy, confirmError, accounts, types, currencies, metadataLoading, onConfirm, onReject, palette }: ReviewFormProps) {
  const { t } = useTranslation()
  const [accountId, setAccountId] = useState<number | null>(null)
  const [typeId, setTypeId] = useState<number | null>(null)
  const [currencyId, setCurrencyId] = useState<number | null>(scan.transactionInfo.settlementCurrencyId ?? null)
  const [date, setDate] = useState(isoToDateOnly(scan.transactionInfo.transactionDate))
  const [amount, setAmount] = useState(String(scan.transactionInfo.settlementAmount))
  const [merchantName, setMerchantName] = useState(scan.transactionInfo.transactionMerchantName)
  const [description, setDescription] = useState('')

  const merchantEdited = merchantName.trim() !== scan.transactionInfo.transactionMerchantName
  const canConfirm = accountId !== null && typeId !== null && currencyId !== null && !busy

  const submit = () => {
    if (!canConfirm || accountId === null || typeId === null || currencyId === null) return
    void onConfirm({
      accountId,
      transactionTypeId: typeId,
      transactionDate: date,
      settlementAmount: amount,
      settlementCurrencyId: currencyId,
      ...(merchantEdited || !scan.transactionInfo.transactionMerchantId
        ? { newMerchantName: merchantName }
        : { existingMerchantId: scan.transactionInfo.transactionMerchantId }),
      ...(description.trim() ? { description } : {}),
    })
  }

  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('transactionOcr.reviewTitle')}</Text>
      {metadataLoading ? <Text accessibilityRole="progressbar" style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionOcr.metadataLoading')}</Text> : null}
      <ChoiceField label={t('transactionOcr.account')} items={accounts.map((account) => ({ id: account.accountId, label: account.accountName ?? t('accounts.unnamed') }))} value={accountId} onChange={setAccountId} palette={palette} disabled={busy} />
      <ChoiceField label={t('transactionOcr.type')} items={types.map((type) => ({ id: type.transactionTypeKey, label: formatManualTransactionType(t, type.name) }))} value={typeId} onChange={setTypeId} palette={palette} disabled={busy} />
      <Field label={t('transactionOcr.date')} value={date} onChangeText={setDate} palette={palette} maxLength={10} editable={!busy} />
      <Field label={t('transactionOcr.amount')} value={amount} onChangeText={setAmount} palette={palette} keyboardType="decimal-pad" editable={!busy} />
      <ChoiceField label={t('transactionOcr.currency')} items={currencies.map((currency) => ({ id: currency.currencyKey, label: currency.code }))} value={currencyId} onChange={setCurrencyId} palette={palette} disabled={busy} />
      <Field label={t('transactionOcr.merchant')} value={merchantName} onChangeText={setMerchantName} palette={palette} maxLength={200} editable={!busy} />
      <Field label={t('transactionOcr.descriptionOptional')} value={description} onChangeText={setDescription} palette={palette} maxLength={500} editable={!busy} multiline />
      {confirmError ? (
        <Text accessibilityRole="alert" style={[styles.banner, { color: palette.destructive, borderColor: palette.destructive }]}>{t(`transactionOcr.failures.${confirmError}`)}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button label={t('transactionOcr.discard')} onPress={onReject} palette={palette} disabled={busy} />
        <Button label={busy ? t('transactionOcr.confirming') : t('transactionOcr.confirm')} onPress={submit} palette={palette} primary disabled={!canConfirm} />
      </View>
    </View>
  )
}

function Field({ label, palette, ...props }: { label: string; palette: Palette } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={palette.mutedForeground} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} {...props} /></View>
}

function ChoiceField({ label, items, value, onChange, palette, disabled = false }: { label: string; items: readonly { id: number; label: string }[]; value: number | null; onChange: (id: number) => void; palette: Palette; disabled?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
      <View style={styles.filters}>
        {items.map((item) => (
          <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: value === item.id, disabled }} disabled={disabled} onPress={() => onChange(item.id)} style={({ pressed }) => [styles.filter, { borderColor: value === item.id ? palette.primary : palette.border, backgroundColor: value === item.id ? palette.primarySoft : 'transparent' }, (pressed || disabled) && styles.pressed]}>
            <Text style={[styles.filterText, { color: value === item.id ? palette.primary : palette.foreground }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Button({ label, onPress, palette, primary = false, disabled = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: disabled }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.pressed]}>
      <Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] },
  title: { ...textStyles.title, fontWeight: '700' as const },
  helper: { ...textStyles.body },
  sectionTitle: { ...textStyles.section },
  outcome: { ...textStyles.action },
  form: { gap: themeTokens.spacing[4] },
  field: { gap: themeTokens.spacing[2] },
  label: { ...textStyles.bodyStrong },
  input: { ...textStyles.body, minHeight: 48, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  filterText: { ...textStyles.bodyStrong },
  banner: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  buttonText: { ...textStyles.action },
  pressed: { opacity: 0.65 },
})
