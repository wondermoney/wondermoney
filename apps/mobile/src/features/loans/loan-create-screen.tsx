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

import { buildLoanCreatePayload, type LoanCreateDraft } from './loan-create-model'
import { loanNumberErrors } from './loan-form-rows'
import { NO_SECURED_ASSET, type SecuredAssetOption } from './loan-secured-asset'
import type { LoanCreateWrite, LoanType } from './loans-contract'
import type { LoanCreateFailure } from './use-create-loan'

const CREDIT_TYPES: readonly LoanType[] = ['MORTGAGE', 'AUTO_LOAN', 'PERSONAL_LOAN', 'STUDENT_LOAN', 'OTHER']


export type LoanCurrencyOption = Readonly<{ currencyKey: number; code: string; description: string }>

export type LoanCreateScreenProps = Readonly<{
  currencies: readonly LoanCurrencyOption[]
  loading: boolean
  metadataError: boolean
  pending: boolean
  outcome: LoanCreateFailure | null
  onBack: () => void
  onCreate: (value: LoanCreateWrite) => Promise<void>
  /** The assets "Secured against" offers (`securedAssetOptions`); the row hides when there are none. */
  securedAssets?: readonly SecuredAssetOption[]
}>

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Add loan, as a calm-structure flow: the form bar (close, save), the opening
 * principal big and centred, then one group of rows. The ✓ stays disabled
 * until the required fields are valid; an error shows under a row only for
 * what was entered and is wrong.
 */
export function LoanCreateScreen({ currencies, loading, metadataError, pending, outcome, onBack, onCreate, securedAssets = [] }: LoanCreateScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState('')
  const [type, setType] = useState<LoanType | null>(null)
  const [currencyId, setCurrencyId] = useState<number | null>(null)
  const [openingPrincipalBalance, setOpeningPrincipalBalance] = useState('')
  const [openingBalanceDate, setOpeningBalanceDate] = useState(localToday)
  const [providerName, setProviderName] = useState('')
  const [regularPaymentAmount, setRegularPaymentAmount] = useState('')
  const [annualInterestRateBps, setAnnualInterestRateBps] = useState('')
  const [termMonths, setTermMonths] = useState('')
  const [includeInNetWorth, setIncludeInNetWorth] = useState(true)
  const [notes, setNotes] = useState('')
  const [securedAssetKey, setSecuredAssetKey] = useState<number | null>(null)
  const locked = pending

  if (loading) return <StatePage palette={palette} title={t('loanCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('loanCreate.metadataError')} onBack={onBack} />

  // Read in the app's language ("1.234,56" in pt and es), then handed on as dot decimals.
  const decimal = (value: string) => toWireDecimalInput(value, locale)
  const draft: LoanCreateDraft = {
    name,
    type,
    currencyId,
    openingPrincipalBalance: decimal(openingPrincipalBalance),
    openingBalanceDate,
    providerName,
    regularPaymentAmount: decimal(regularPaymentAmount),
    annualInterestRateBps: decimal(annualInterestRateBps),
    termMonths,
    includeInNetWorth,
    notes,
    securedAssetKey,
  }
  const result = buildLoanCreatePayload(draft)
  const invalid = result.success ? new Set<string>() : result.invalidFields
  const numbers = loanNumberErrors(draft as Required<LoanCreateDraft>)
  const nameError = name.length > 0 && invalid.has('name') ? t('loanCreate.fieldErrors.name') : null
  const principalError = numbers.principal ? t('loanCreate.fieldErrors.principal') : null
  const dateError = openingBalanceDate.trim() !== '' && invalid.has('openingBalanceDate') ? t('loanCreate.fieldErrors.startDate') : undefined
  const currency = currencies.find((item) => item.currencyKey === currencyId) ?? null

  const submit = () => {
    if (!result.success || locked) return
    void onCreate(result.payload)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={locked}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={submit}
        saveDisabled={!result.success || locked}
        saveLabel={pending ? t('loanCreate.saving') : t('loanCreate.save')}
        saving={pending}
        title={t('loanCreate.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <AmountEntry
              accessibilityLabel={t('loanCreate.principal')}
              caption={t('loanCreate.principal')}
              currency={currency?.code ?? null}
              editable={!locked}
              error={principalError}
              locale={locale}
              onChangeText={setOpeningPrincipalBalance}
              value={openingPrincipalBalance}
            />
            <FormGroup>
              <FormTextRow key="name" editable={!locked} error={nameError} label={t('loanCreate.name')} maxLength={255} onChangeText={setName} placeholder={t('loanCreate.namePlaceholder')} value={name} />
              <FormSelectRow key="type" disabled={locked} label={t('loanCreate.type')} onChange={setType} options={CREDIT_TYPES.map((item) => ({ value: item, label: t(`loans.type.${item}`) }))} placeholder={t('loanCreate.choose')} value={type} />
              <FormSelectRow key="currency" disabled={locked} label={t('loanCreate.currency')} onChange={setCurrencyId} options={currencies.map((item) => ({ value: item.currencyKey, label: `${item.code} · ${item.description}` }))} placeholder={t('loanCreate.choose')} value={currencyId} />
              <DateField key="date" appearance="row" disabled={locked} error={dateError} label={t('loanCreate.startDate')} onChange={(value) => setOpeningBalanceDate(value ?? '')} value={openingBalanceDate || null} />
              <FormTextRow key="provider" accessibilityLabel={t('loanCreate.providerOptional')} editable={!locked} label={t('loanCreate.provider')} maxLength={255} onChangeText={setProviderName} placeholder={t('loanCreate.optional')} value={providerName} />
              <FormTextRow key="installment" accessibilityLabel={t('loanCreate.installmentOptional')} editable={!locked} error={numbers.installment ? t('loanCreate.fieldErrors.installment') : null} keyboardType="decimal-pad" label={t('loanCreate.installment')} onChangeText={setRegularPaymentAmount} placeholder={t('loanCreate.optional')} value={regularPaymentAmount} />
              <FormTextRow key="rate" accessibilityLabel={t('loanCreate.interestRateOptional')} editable={!locked} error={numbers.rate ? t('loanCreate.fieldErrors.interestRate') : null} keyboardType="decimal-pad" label={t('loanCreate.interestRate')} onChangeText={setAnnualInterestRateBps} placeholder={t('loanCreate.optional')} value={annualInterestRateBps} />
              <FormTextRow key="term" accessibilityLabel={t('loanCreate.termMonthsOptional')} editable={!locked} error={numbers.term ? t('loanCreate.fieldErrors.termMonths') : null} keyboardType="number-pad" label={t('loanCreate.termMonths')} onChangeText={setTermMonths} placeholder={t('loanCreate.optional')} value={termMonths} />
              {securedAssets.length > 0 ? (
                <FormSelectRow
                  key="secured-asset"
                  disabled={locked}
                  hint={t('loanForm.securedAssetHint')}
                  label={t('loanForm.securedAsset')}
                  onChange={(value) => setSecuredAssetKey(value === NO_SECURED_ASSET ? null : value)}
                  options={[{ value: NO_SECURED_ASSET, label: t('loanForm.securedAssetNone') }, ...securedAssets.map((asset) => ({ value: asset.key, label: asset.name }))]}
                  placeholder={t('loanForm.securedAssetNone')}
                  value={securedAssetKey ?? NO_SECURED_ASSET}
                />
              ) : null}
              <FormSwitchRow key="net-worth" disabled={locked} label={t('loanCreate.includeInNetWorth')} onValueChange={setIncludeInNetWorth} value={includeInNetWorth} />
              <FormTextRow key="notes" accessibilityLabel={t('loanCreate.notesOptional')} editable={!locked} label={t('loanCreate.notes')} maxLength={10_000} multiline onChangeText={setNotes} placeholder={t('loanCreate.notesPlaceholder')} value={notes} />
            </FormGroup>
            {outcome ? <Notice message={t(`loanCreate.failures.${outcome}`)} tone="destructive" /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function StatePage({ palette, title, onBack, progress = false }: { palette: ReturnType<typeof usePalette>; title: string; onBack: () => void; progress?: boolean }) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('loanCreate.title')} />
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
