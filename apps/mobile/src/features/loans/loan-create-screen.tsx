import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { buildLoanCreatePayload, type LoanCreateDraft, type LoanCreateField } from './loan-create-model'
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
}>

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function LoanCreateScreen({ currencies, loading, metadataError, pending, outcome, onBack, onCreate }: LoanCreateScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
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
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<LoanCreateField>>(new Set())
  // A validation failure on a field the form doesn't render inline errors
  // for (annualInterestRateBps, termMonths) has nowhere else to surface —
  // fall back to the old generic banner only for that case.
  const [unmappedError, setUnmappedError] = useState(false)
  const locked = pending

  if (loading) return <StatePage palette={palette} title={t('loanCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('loanCreate.metadataError')} onBack={onBack} />

  const submit = async () => {
    setInvalidFields(new Set())
    setUnmappedError(false)
    const draft: LoanCreateDraft = {
      name, type, currencyId, openingPrincipalBalance, openingBalanceDate, providerName, regularPaymentAmount, annualInterestRateBps, termMonths, includeInNetWorth, notes,
    }
    const result = buildLoanCreatePayload(draft)
    if (!result.success) {
      setInvalidFields(result.invalidFields)
      setUnmappedError(result.invalidFields.size === 0)
      return
    }
    await onCreate(result.payload)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <FormButton label={t('loanCreate.back')} onPress={onBack} palette={palette} disabled={locked} />
            <PageHeader palette={palette}
            instruction={t('loanCreate.helper')} title={t('loanCreate.title')} />

            <View style={styles.form}>
              <Field label={t('loanCreate.name')} value={name} onChangeText={setName} placeholder={t('loanCreate.namePlaceholder')} palette={palette} maxLength={255} editable={!locked} invalid={invalidFields.has('name')} errorText={invalidFields.has('name') ? t('loanCreate.fieldErrors.name') : undefined} />
              <ChoiceField label={t('loanCreate.type')} items={CREDIT_TYPES.map((item) => ({ id: item, label: t(`loans.type.${item}`) }))} value={type} onChange={setType} palette={palette} invalid={invalidFields.has('type')} errorText={invalidFields.has('type') ? t('loanCreate.fieldErrors.type') : undefined} />
              <ChoiceField label={t('loanCreate.currency')} items={currencies.map((item) => ({ id: item.currencyKey, label: `${item.code} · ${item.description}` }))} value={currencyId} onChange={setCurrencyId} palette={palette} invalid={invalidFields.has('currencyId')} errorText={invalidFields.has('currencyId') ? t('loanCreate.fieldErrors.currency') : undefined} />
              <Field label={t('loanCreate.principal')} value={openingPrincipalBalance} onChangeText={setOpeningPrincipalBalance} placeholder="0.00" palette={palette} keyboardType="decimal-pad" editable={!locked} invalid={invalidFields.has('openingPrincipalBalance')} errorText={invalidFields.has('openingPrincipalBalance') ? t('loanCreate.fieldErrors.principal') : undefined} />
              <Field label={t('loanCreate.startDate')} value={openingBalanceDate} onChangeText={setOpeningBalanceDate} placeholder={t('loanCreate.startDatePlaceholder')} palette={palette} maxLength={10} editable={!locked} invalid={invalidFields.has('openingBalanceDate')} errorText={invalidFields.has('openingBalanceDate') ? t('loanCreate.fieldErrors.startDate') : undefined} />
              <Field label={t('loanCreate.providerOptional')} value={providerName} onChangeText={setProviderName} placeholder={t('loanCreate.providerPlaceholder')} palette={palette} maxLength={255} editable={!locked} />
              <Field label={t('loanCreate.installmentOptional')} value={regularPaymentAmount} onChangeText={setRegularPaymentAmount} placeholder="0.00" palette={palette} keyboardType="decimal-pad" editable={!locked} />
              <Field label={t('loanCreate.interestRateOptional')} value={annualInterestRateBps} onChangeText={setAnnualInterestRateBps} placeholder="0.00" palette={palette} keyboardType="decimal-pad" editable={!locked} />
              <Field label={t('loanCreate.termMonthsOptional')} value={termMonths} onChangeText={setTermMonths} placeholder="360" palette={palette} keyboardType="number-pad" editable={!locked} />
              <View style={styles.switchRow}>
                <Text style={[styles.label, { color: palette.foreground }]}>{t('loanCreate.includeInNetWorth')}</Text>
                <Switch accessibilityRole="switch" accessibilityLabel={t('loanCreate.includeInNetWorth')} accessibilityState={{ disabled: locked, checked: includeInNetWorth }} disabled={locked} value={includeInNetWorth} onValueChange={setIncludeInNetWorth} trackColor={{ false: palette.muted, true: palette.primary }} />
              </View>
              <Field label={t('loanCreate.notesOptional')} value={notes} onChangeText={setNotes} placeholder={t('loanCreate.notesPlaceholder')} palette={palette} maxLength={10_000} multiline editable={!locked} />
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.background }]}>
          {unmappedError ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.destructiveText, borderColor: palette.destructiveText }]}>{t('loanCreate.validation')}</Text> : null}
          {outcome ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border }]}>{t(`loanCreate.failures.${outcome}`)}</Text> : null}
          <Button block disabled={locked} label={pending ? t('loanCreate.saving') : t('loanCreate.save')} onPress={submit} palette={palette} variant="primary" />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ label, palette, invalid = false, errorText, ...props }: { label: string; palette: Palette; invalid?: boolean; errorText?: string } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={palette.mutedForeground} style={[styles.input, { color: palette.foreground, borderColor: invalid ? palette.destructiveText : palette.border, backgroundColor: palette.card }, invalid && styles.inputInvalid]} {...props} />{errorText ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{errorText}</Text> : null}</View>
}

function ChoiceField<T extends string | number>({ label, items, value, onChange, palette, invalid = false, errorText }: { label: string; items: readonly { id: T; label: string }[]; value: T | null; onChange: (id: T) => void; palette: Palette; invalid?: boolean; errorText?: string }) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>{items.map((item) => <Choice key={item.id} label={item.label} selected={value === item.id} onPress={() => onChange(item.id)} palette={palette} />)}</View>{errorText ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{errorText}</Text> : null}</View>
}

function Choice({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) {
  // Unselected chips carry no border of their own — a dozen-plus currency
  // options each individually boxed read as a wall of empty containers, not
  // a set of choices. Only the selected chip earns a border/fill; the rest
  // are plain text with a muted background wash for a touch target.
  return <Pressable accessibilityRole="radio" hitSlop={{ top: 7, bottom: 7 }} accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, selected ? { borderColor: palette.primary, backgroundColor: palette.primarySoft } : { borderWidth: 0, backgroundColor: palette.muted }]}><Text style={[styles.choiceText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text></Pressable>
}

function FormButton({ label, accessibilityLabel, onPress, palette, primary = false, disabled = false, busy = false }: { label: string; accessibilityLabel?: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.disabled]}><Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable>
}

function StatePage({ palette, title, onBack, progress = false }: { palette: Palette; title: string; onBack: () => void; progress?: boolean }) {
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.state}><BackControl fallback="/loans" onPress={onBack} color={palette.primary} /><Text accessibilityRole={progress ? 'progressbar' : 'alert'} style={[styles.body, { color: palette.foreground }]}>{title}</Text></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth * 2, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[2] }, keyboard: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap }, body: { ...textStyles.body }, form: { gap: themeTokens.spacing[5] }, field: { gap: themeTokens.spacing[2] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.body, minHeight: 50, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] }, inputInvalid: { borderWidth: 2 }, fieldError: { ...textStyles.meta }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choiceText: { ...textStyles.meta }, switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[5] }, buttonText: { ...textStyles.action }, disabled: { opacity: 0.55 }, banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, state: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
})
