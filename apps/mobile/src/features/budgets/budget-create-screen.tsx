import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BudgetCreateWrite, BudgetRecurrence } from './budgets-contract'
import { createBudgetPayload, invalidHouseholdFields, invalidIncomeFields, monthlyEquivalent, monthlyEquivalentTotal, type EditableIncome, type IncomeField } from './budget-create-model'
import { Action, BudgetHeader } from './budgets-screen'
import type { CreateBudgetFailure } from './use-create-budget'

type Candidate = Readonly<{ id: number; name: string }>

export type BudgetCreateScreenProps = Readonly<{
  pending: boolean
  failure: CreateBudgetFailure | null
  candidates: readonly Candidate[] | null
  reconciliationFailed: boolean
  onBack: () => void
  onSubmit: (payload: BudgetCreateWrite) => Promise<void>
  onCreateAnother: () => void
}>

const recurrences: BudgetRecurrence[] = ['MONTHLY', 'MONTHLY_14', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']
const newIncome = (id: number): EditableIncome => ({ id: String(id), name: '', amount: '', isRecurrent: true, recurrency: 'MONTHLY' })

export function BudgetCreateScreen({ pending, failure, candidates, reconciliationFailed, onBack, onSubmit, onCreateAnother }: BudgetCreateScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [step, setStep] = useState(0)
  const [household, setHousehold] = useState(1)
  const [dependents, setDependents] = useState(0)
  const [incomes, setIncomes] = useState<EditableIncome[]>([])
  const [nextId, setNextId] = useState(1)
  const [householdSubmitted, setHouseholdSubmitted] = useState(false)
  const [incomeSubmitted, setIncomeSubmitted] = useState(false)
  useEffect(() => {
    if (!pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [pending])

  const payload = useMemo(() => createBudgetPayload(household, dependents, incomes), [dependents, household, incomes])
  // Re-derived on every render (not stored) so a field's error clears the
  // moment it's fixed, not only on the next submit attempt.
  const invalidHousehold = householdSubmitted ? invalidHouseholdFields(household, dependents) : new Set()
  const invalidIncomes = incomeSubmitted ? invalidIncomeFields(household, dependents, incomes) : new Map<string, ReadonlySet<IncomeField>>()
  const money = (value: number) => formatCurrency(value, { locale, currency: 'EUR' })
  const updateIncome = (id: string, patch: Partial<EditableIncome>) => setIncomes((current) => current.map((income) => income.id === id ? { ...income, ...patch } : income))
  const addIncome = () => { setIncomes((current) => [...current, newIncome(nextId)]); setNextId((value) => value + 1) }
  const forward = () => {
    if (step === 0) {
      setHouseholdSubmitted(true)
      if (invalidHouseholdFields(household, dependents).size > 0) return
    }
    if (step === 1) {
      setIncomeSubmitted(true)
      if (invalidIncomeFields(household, dependents, incomes).size > 0) return
    }
    setStep((value) => Math.min(2, value + 1))
  }

  if (candidates !== null || reconciliationFailed) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView contentContainerStyle={styles.content}><View style={styles.page}>
      <BudgetHeader title={t('budgetCreate.unknown.title')} backLabel={t('budgetCreate.back')} onBack={onBack} palette={palette} />
      <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{reconciliationFailed ? t('budgetCreate.unknown.refreshFailed') : t(`budgetCreate.unknown.count.${candidates?.length === 1 ? 'one' : candidates?.length ? 'many' : 'zero'}`, { count: candidates?.length ?? 0 })}</Text>
      {candidates?.map((candidate) => <View key={candidate.id} style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}><Text style={[styles.cardTitle, { color: palette.foreground }]}>{candidate.name}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.unknown.candidate', { id: candidate.id })}</Text></View>)}
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.unknown.noInference')}</Text>
      <Button label={t('budgetCreate.createAnother')} onPress={onCreateAnother} palette={palette} variant="primary" />
    </View></ScrollView></SafeAreaView>
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
    <BudgetHeader title={t('budgetCreate.title')} backLabel={t('budgetCreate.back')} onBack={onBack} disabled={pending} palette={palette} />
    {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetCreate.failures.${failure}`)}</Text> : null}
    {step === 0 ? <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetCreate.household.title')}</Text>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.household.helper')}</Text>
      <Counter label={t('budgetCreate.household.size')} value={household} minimum={1} maximum={10} disabled={pending} onChange={(value) => { setHousehold(value); if (dependents >= value) setDependents(value - 1) }} palette={palette} />
      {invalidHousehold.has('household') ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('budgetCreate.household.fieldErrors.household')}</Text> : null}
      <Counter label={t('budgetCreate.household.dependents')} value={dependents} minimum={0} maximum={household - 1} disabled={pending} onChange={setDependents} palette={palette} />
      {invalidHousehold.has('dependents') ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('budgetCreate.household.fieldErrors.dependents')}</Text> : null}
    </View> : null}
    {step === 1 ? <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetCreate.income.title')}</Text>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.income.helper')}</Text>
      {incomes.map((income, index) => <IncomeEditor key={income.id} income={income} index={index} disabled={pending} palette={palette} invalidFields={invalidIncomes.get(income.id) ?? new Set()} onChange={(patch) => updateIncome(income.id, patch)} onRemove={() => setIncomes((current) => current.filter((item) => item.id !== income.id))} />)}
      <Action label={t('budgetCreate.income.add')} onPress={addIncome} disabled={pending} palette={palette} />
    </View> : null}
    {step === 2 ? <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetCreate.review.title')}</Text>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <ReviewRow label={t('budgetCreate.review.household')} value={String(household)} palette={palette} />
        <ReviewRow label={t('budgetCreate.review.adults')} value={String(household - dependents)} palette={palette} />
        <ReviewRow label={t('budgetCreate.review.dependents')} value={String(dependents)} palette={palette} />
      </View>
      {incomes.length === 0 ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.review.noIncome')}</Text> : incomes.map((income) => <View key={income.id} style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}><Text style={[styles.cardTitle, { color: palette.foreground }]}>{income.name.trim()}</Text><Text style={[styles.amount, { color: palette.foreground }]}>{money(Number(income.amount))}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{income.isRecurrent ? t(`budgetMonth.recurrence.${income.recurrency}`) : t('budgetCreate.income.oneTime')} · {t('budgetCreate.review.monthlyEquivalent', { amount: money(monthlyEquivalent(Number(income.amount), income.isRecurrent, income.recurrency)) })}</Text></View>)}
      <View style={[styles.total, { borderColor: palette.border }]}><Text style={[styles.cardTitle, { color: palette.foreground }]}>{t('budgetCreate.review.total')}</Text><Text accessibilityLabel={t('budgetCreate.review.totalAccessible', { amount: money(monthlyEquivalentTotal(incomes)) })} style={[styles.totalAmount, { color: palette.foreground }]}>{money(monthlyEquivalentTotal(incomes))}</Text></View>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCreate.review.safety')}</Text>
    </View> : null}
  </View></ScrollView>
  {/* Pinned outside the ScrollView — content above (validation banners, added
      income rows) grows the page and previously pushed Continue/Previous off
      the bottom of the screen with nothing to signal a scroll was needed. */}
  <View style={[styles.actions, styles.stickyActions, { borderTopColor: palette.border, backgroundColor: palette.background }]}>{step > 0 ? <Button disabled={pending || failure === 'unknown'} label={t('budgetCreate.previous')} onPress={() => setStep((value) => value - 1)} palette={palette} variant="secondary" /> : null}<Button disabled={pending || failure === 'unknown'} label={step === 2 ? (pending ? t('budgetCreate.creating') : t('budgetCreate.create')) : t('budgetCreate.continue')} onPress={step === 2 ? () => onSubmit(payload) : forward} palette={palette} variant="primary" /></View>
  </SafeAreaView>
}

function Counter({ label, value, minimum, maximum, disabled, onChange, palette }: { label: string; value: number; minimum: number; maximum: number; disabled: boolean; onChange: (value: number) => void; palette: Palette }) {
  return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><View style={styles.counter}><Action label={`− ${label}`} onPress={() => onChange(Math.max(minimum, value - 1))} disabled={disabled || value <= minimum} palette={palette} /><Text accessibilityLabel={`${label}: ${value}`} style={[styles.counterValue, { color: palette.foreground }]}>{value}</Text><Action label={`+ ${label}`} onPress={() => onChange(Math.min(maximum, value + 1))} disabled={disabled || value >= maximum} palette={palette} /></View></View>
}

function IncomeEditor({ income, index, disabled, palette, invalidFields, onChange, onRemove }: { income: EditableIncome; index: number; disabled: boolean; palette: Palette; invalidFields: ReadonlySet<IncomeField>; onChange: (patch: Partial<EditableIncome>) => void; onRemove: () => void }) {
  const { t } = useTranslation()
  const nameInvalid = invalidFields.has('name')
  const amountInvalid = invalidFields.has('amount')
  return <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.foreground }]}>{t('budgetCreate.income.row', { number: index + 1 })}</Text>
    <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCreate.income.name')}</Text><TextInput accessibilityLabel={t('budgetCreate.income.name')} editable={!disabled} maxLength={100} value={income.name} onChangeText={(name) => onChange({ name })} style={[styles.input, { color: palette.foreground, borderColor: nameInvalid ? palette.destructive : palette.border, backgroundColor: palette.background }, nameInvalid && styles.inputInvalid]} />
    {nameInvalid ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructive }]}>{t('budgetCreate.income.fieldErrors.name')}</Text> : null}
    <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCreate.income.amount')}</Text><TextInput accessibilityLabel={t('budgetCreate.income.amount')} editable={!disabled} keyboardType="decimal-pad" value={income.amount} onChangeText={(amount) => onChange({ amount })} style={[styles.input, styles.amountInput, { color: palette.foreground, borderColor: amountInvalid ? palette.destructive : palette.border, backgroundColor: palette.background }, amountInvalid && styles.inputInvalid]} />
    {amountInvalid ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructive }]}>{t('budgetCreate.income.fieldErrors.amount')}</Text> : null}
    <View accessibilityRole="radiogroup" style={styles.choices}><Choice label={t('budgetCreate.income.recurrent')} selected={income.isRecurrent} disabled={disabled} onPress={() => onChange({ isRecurrent: true })} palette={palette} /><Choice label={t('budgetCreate.income.oneTime')} selected={!income.isRecurrent} disabled={disabled} onPress={() => onChange({ isRecurrent: false })} palette={palette} /></View>
    {income.isRecurrent ? <><Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCreate.income.recurrence')}</Text><View accessibilityRole="radiogroup" style={styles.choices}>{recurrences.map((value) => <Choice key={value} label={t(`budgetMonth.recurrence.${value}`)} selected={income.recurrency === value} disabled={disabled} onPress={() => onChange({ recurrency: value })} palette={palette} />)}</View></> : null}
    <Action label={t('budgetCreate.income.remove')} onPress={onRemove} disabled={disabled} palette={palette} />
  </View>
}

function Choice({ label, selected, disabled, onPress, palette }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; palette: Palette }) {
  // Unselected chips carry no border — five recurrence options each
  // individually boxed read as a wall of empty containers. Only the
  // selected chip earns a border/fill.
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, selected ? { borderColor: palette.primary, backgroundColor: palette.primarySoft } : { borderWidth: 0, backgroundColor: palette.muted }]}><Text style={[styles.choiceText, { color: palette.foreground }]}>{label}</Text></Pressable>
}
function ReviewRow({ label, value, palette }: { label: string; value: string; palette: Palette }) { return <View style={styles.reviewRow}><Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.count, { color: palette.foreground }]}>{value}</Text></View> }

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap }, section: { gap: themeTokens.spacing[4] }, sectionTitle: { ...textStyles.section }, helper: { ...textStyles.body }, field: { gap: themeTokens.spacing[2] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, counter: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[4] }, counterValue: { ...textStyles.display, minWidth: 44, textAlign: 'center' }, card: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, cardTitle: { ...textStyles.section }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, inputInvalid: { borderWidth: 2 }, fieldError: { ...textStyles.body }, amountInput: { fontFamily: themeTokens.typography.roles.data.fontFamily }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choiceText: { ...textStyles.body }, amount: { ...textStyles.amount }, actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, stickyActions: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: themeTokens.layout.screenPadding, paddingVertical: themeTokens.spacing[3] }, alert: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, error: { ...textStyles.body }, reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, count: { ...textStyles.amount }, total: { borderTopWidth: 1, paddingTop: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, totalAmount: { ...textStyles.display },
})
