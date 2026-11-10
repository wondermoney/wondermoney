import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import type { AccountSummaryViewModel } from '@/features/accounts/accounts-view-model'
import { formatNumberInput, parseDecimalInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FormNotice, TextField } from './form-field'

import type { SettlementCurrencyDto, TransactionTypeDto } from './manual-transaction-contract'
import { formatManualTransactionType } from './manual-transaction-types'
import { SelectField } from './select-field'
import type { TransactionOcrScanDto } from './transaction-ocr-contract'
import type { ConfirmTransactionOcrInput, TransactionOcrPhase } from './use-transaction-ocr'

/** Progress of a "resend verification email" request made from the unverified-email failure. */
export type VerificationResendStatus = 'idle' | 'sending' | 'sent' | 'failed'

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
  verificationResend: VerificationResendStatus
  onResendVerification: () => void | Promise<void>
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
  verificationResend,
  onResendVerification,
}: TransactionOcrScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const reviewing = state.phase === 'review' || state.phase === 'confirming'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BackControl fallback="/accounts/transactions" onPress={onBack} disabled={state.phase === 'scanning' || state.phase === 'confirming'} />
          <PageHeader title={t('transactionOcr.title')} instruction={t('transactionOcr.helper')} />

          {state.phase === 'idle' ? (
            <Button block icon="receipt-text" label={t('transactionOcr.chooseFile')} onPress={onPickFile} />
          ) : null}

          {state.phase === 'scanning' ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={t('transactionOcr.scanning')} style={styles.progress}>
              <ActivityIndicator color={palette.mutedForeground} size="small" />
              <Text tone="muted" variant="meta">{t('transactionOcr.scanning')}</Text>
            </View>
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
            />
          ) : null}

          {state.phase === 'succeeded' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" variant="bodyStrong">{t('transactionOcr.succeeded')}</Text>
              <View style={styles.actions}>
                <Button block label={t('transactionOcr.done')} onPress={onBack} />
                <Button block label={t('transactionOcr.scanAnother')} onPress={onReset} variant="outline" />
              </View>
            </View>
          ) : null}

          {state.phase === 'error' && state.reason === 'unverified' ? (
            <VerifyEmailPanel status={verificationResend} onResend={onResendVerification} onReset={onReset} />
          ) : null}

          {state.phase === 'error' && state.reason === 'allowance' ? (
            <View style={styles.form} testID="transaction-ocr-allowance">
              <Text accessibilityRole="header" variant="section">{t('transactionOcr.allowance.title')}</Text>
              <Text tone="muted" variant="meta">{t('transactionOcr.allowance.body')}</Text>
            </View>
          ) : null}

          {state.phase === 'error' && state.reason !== 'unverified' && state.reason !== 'allowance' ? (
            <View style={styles.form}>
              <FormNotice tone="destructive">{t(`transactionOcr.failures.${state.reason}`)}</FormNotice>
              <Button block label={t('transactionOcr.tryAgain')} onPress={onReset} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The API refuses receipt scanning for an email/password account whose address isn't verified
 * yet. Informational rather than an error: the user can resend the link (it opens the web app)
 * and retry once verified; leaving via Back still reaches manual entry as for any failure.
 */
function VerifyEmailPanel({ status, onResend, onReset }: { status: VerificationResendStatus; onResend: () => void | Promise<void>; onReset: () => void }) {
  const { t } = useTranslation()
  const sending = status === 'sending'
  return (
    <View style={styles.form} testID="transaction-ocr-verify-email">
      <Text accessibilityRole="header" variant="section">{t('transactionOcr.verifyEmail.title')}</Text>
      <Text tone="muted" variant="meta">{t('transactionOcr.verifyEmail.body')}</Text>
      {status === 'sent' ? <FormNotice testID="transaction-ocr-verify-email-sent">{t('transactionOcr.verifyEmail.sent')}</FormNotice> : null}
      {status === 'failed' ? <FormNotice testID="transaction-ocr-verify-email-failed" tone="destructive">{t('transactionOcr.verifyEmail.failed')}</FormNotice> : null}
      <View style={styles.actions}>
        <Button block label={sending ? t('transactionOcr.verifyEmail.sending') : t('transactionOcr.verifyEmail.resend')} onPress={onResend} loading={sending} />
        <Button block label={t('transactionOcr.tryAgain')} onPress={onReset} disabled={sending} variant="outline" />
      </View>
    </View>
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
}>

/** Keyed by scan.transactionOcrImportId in the parent so every field initializes directly from
 * the scan (no effect-driven prefill, matching this repo's key-remount convention for
 * loaded-data forms, e.g. account-edit-screen.tsx's AccountEditForm). */
function ReviewForm({ scan, busy, confirmError, accounts, types, currencies, metadataLoading, onConfirm, onReject }: ReviewFormProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [accountId, setAccountId] = useState<number | null>(null)
  const [typeId, setTypeId] = useState<number | null>(null)
  const [currencyId, setCurrencyId] = useState<number | null>(scan.transactionInfo.settlementCurrencyId ?? null)
  const [date, setDate] = useState(isoToDateOnly(scan.transactionInfo.transactionDate))
  const [amount, setAmount] = useState(() => formatNumberInput(scan.transactionInfo.settlementAmount, locale))
  const [merchantName, setMerchantName] = useState(scan.transactionInfo.transactionMerchantName)
  const [description, setDescription] = useState('')

  const merchantEdited = merchantName.trim() !== scan.transactionInfo.transactionMerchantName
  // Read in the app's language ("1.234,56" in pt and es) and sent as a dot decimal.
  const parsedAmount = parseDecimalInput(amount, locale)
  const settlementAmount = parsedAmount !== null && Number(parsedAmount) > 0 ? parsedAmount : null
  const amountError = amount.trim() !== '' && settlementAmount === null ? t('transactionCreate.errors.amount') : null
  const canConfirm = accountId !== null && typeId !== null && currencyId !== null && settlementAmount !== null && !busy

  const submit = () => {
    if (!canConfirm || accountId === null || typeId === null || currencyId === null || settlementAmount === null) return
    void onConfirm({
      accountId,
      transactionTypeId: typeId,
      transactionDate: date,
      settlementAmount,
      settlementCurrencyId: currencyId,
      ...(merchantEdited || !scan.transactionInfo.transactionMerchantId
        ? { newMerchantName: merchantName }
        : { existingMerchantId: scan.transactionInfo.transactionMerchantId }),
      ...(description.trim() ? { description } : {}),
    })
  }

  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" variant="section">{t('transactionOcr.reviewTitle')}</Text>
      {metadataLoading ? <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('transactionOcr.metadataLoading')}</Text> : null}
      <SelectField label={t('transactionOcr.account')} placeholder={t('transactionCreate.choose')} options={accounts.map((account) => ({ value: account.accountId, label: account.accountName ?? t('accounts.unnamed') }))} value={accountId} onChange={setAccountId} disabled={busy} />
      <SelectField label={t('transactionOcr.type')} placeholder={t('transactionCreate.choose')} options={types.map((type) => ({ value: type.transactionTypeKey, label: formatManualTransactionType(t, type.name) }))} value={typeId} onChange={setTypeId} disabled={busy} />
      <DateField label={t('transactionOcr.date')} value={date || null} onChange={(value) => setDate(value ?? '')} disabled={busy} testID="transaction-ocr-date" />
      <TextField label={t('transactionOcr.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!busy} invalid={amountError !== null} />
      {amountError ? <FormNotice tone="destructive">{amountError}</FormNotice> : null}
      <SelectField label={t('transactionOcr.currency')} placeholder={t('transactionCreate.choose')} options={currencies.map((currency) => ({ value: currency.currencyKey, label: currency.code }))} value={currencyId} onChange={setCurrencyId} disabled={busy} />
      <TextField label={t('transactionOcr.merchant')} value={merchantName} onChangeText={setMerchantName} maxLength={200} editable={!busy} />
      <TextField label={t('transactionOcr.descriptionOptional')} value={description} onChangeText={setDescription} maxLength={500} editable={!busy} multiline />
      {confirmError ? (
        <FormNotice tone="destructive">{t(`transactionOcr.failures.${confirmError}`)}</FormNotice>
      ) : null}
      <View style={styles.actions}>
        <Button block label={busy ? t('transactionOcr.confirming') : t('transactionOcr.confirm')} onPress={submit} disabled={!canConfirm} loading={busy} />
        <Button block label={t('transactionOcr.discard')} onPress={onReject} disabled={busy} variant="outline" />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  form: { gap: themeTokens.spacing[4] },
  actions: { gap: themeTokens.spacing[2] },
})
