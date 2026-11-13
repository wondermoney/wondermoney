import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Icon } from '@/components/ui/icon'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text as UiText } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BudgetCreateWrite, BudgetRecurrence, BudgetVisibility } from './budgets-contract'
import { createBudgetPayload, invalidHouseholdFields, invalidIncomeFields, monthlyEquivalent, monthlyEquivalentTotal, type EditableIncome, type IncomeField } from './budget-create-model'
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
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // Web's wizard steps: household, dependents, income, then the review before creating.
  const [step, setStep] = useState(0)
  const [household, setHousehold] = useState(1)
  const [dependents, setDependents] = useState(0)
  const [incomes, setIncomes] = useState<EditableIncome[]>([])
  const [nextId, setNextId] = useState(1)
  const [visibility, setVisibility] = useState<BudgetVisibility>('household')
  useEffect(() => {
    if (!pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [pending])

  // Typed amounts are read in the app's language ("1.234,56" in pt and es); the model reads dot decimals.
  const wireIncomes = useMemo(() => incomes.map((income) => ({ ...income, amount: toWireDecimalInput(income.amount, locale) })), [incomes, locale])
  const payload = useMemo(() => createBudgetPayload(household, dependents, wireIncomes, visibility), [dependents, household, visibility, wireIncomes])
  // Re-derived on every render (not stored) so a field's error clears the
  // moment it's fixed.
  const invalidHousehold = invalidHouseholdFields(household, dependents)
  const invalidIncomes = invalidIncomeFields(household, dependents, wireIncomes)
  const money = (value: number) => formatMoney(value, { locale, currency: 'EUR' })
  const updateIncome = (id: string, patch: Partial<EditableIncome>) => setIncomes((current) => current.map((income) => income.id === id ? { ...income, ...patch } : income))
  const addIncome = () => { setIncomes((current) => [...current, newIncome(nextId)]); setNextId((value) => value + 1) }
  const stepValid = step <= 1 ? invalidHousehold.size === 0 : invalidIncomes.size === 0
  const forward = () => { if (stepValid) setStep((value) => Math.min(LAST_STEP, value + 1)) }
  // Web's "← Back" goes to the previous step; ✕ leaves the flow from any step.
  const previous = () => setStep((value) => Math.max(0, value - 1))

  if (candidates !== null || reconciliationFailed) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('budgetCreate.unknown.title')} />
      <ScrollView contentContainerStyle={styles.content}><View style={styles.page}>
        <FormNotice>{reconciliationFailed ? t('budgetCreate.unknown.refreshFailed') : t(`budgetCreate.unknown.count.${candidates?.length === 1 ? 'one' : candidates?.length ? 'many' : 'zero'}`, { count: candidates?.length ?? 0 })}</FormNotice>
        {candidates && candidates.length > 0 ? <View style={[styles.group, { borderColor: palette.border }]}>{candidates.map((candidate, index) => <View key={candidate.id} style={[styles.candidate, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}><UiText variant="bodyStrong">{candidate.name}</UiText><UiText tone="muted" variant="meta">{t('budgetCreate.unknown.candidate', { id: candidate.id })}</UiText></View>)}</View> : null}
        <UiText tone="muted" variant="meta">{t('budgetCreate.unknown.noInference')}</UiText>
        <View style={styles.actions}><Button label={t('budgetCreate.createAnother')} onPress={onCreateAnother} variant="primary" /></View>
      </View></ScrollView>
    </SafeAreaView>
  }

  const locked = pending || failure === 'unknown'
  const last = step === LAST_STEP
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <FormBar
      closeDisabled={pending}
      closeLabel={t('common.close')}
      onClose={onBack}
      onSave={last ? () => void onSubmit(payload) : forward}
      saveDisabled={locked || !stepValid}
      saveLabel={last ? (pending ? t('budgetCreate.creating') : t('budgetCreate.create')) : t('budgetCreate.continue')}
      saving={last && pending}
      title={t('budgetCreate.title')}
    />
    {/* The wizard's progress through its steps, under the bar. */}
    <View accessibilityLabel={t('budgetCreate.progress', { current: step + 1, total: LAST_STEP + 1 })} accessibilityRole="progressbar" accessible style={styles.progressBar}>
      <View style={[styles.progressTrack, { backgroundColor: palette.muted }]}><View style={[styles.progressFill, { width: `${((step + 1) / (LAST_STEP + 1)) * 100}%`, backgroundColor: palette.primary }]} /></View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
    {failure ? <FormNotice tone="destructive">{t(`budgetCreate.failures.${failure}`)}</FormNotice> : null}
    {step === 0 ? <View style={styles.step}>
      <StepHeading title={t('budgetCreate.household.question')} description={t('budgetCreate.household.description')} />
      <Counter label={t('budgetCreate.household.size')} value={household} minimum={1} maximum={10} disabled={pending} onChange={(value) => { setHousehold(value); if (dependents >= value) setDependents(value - 1) }} />
      {invalidHousehold.has('household') ? <UiText accessibilityRole="alert" align="center" tone="destructive" variant="meta">{t('budgetCreate.household.fieldErrors.household')}</UiText> : null}
    </View> : null}
    {step === 1 ? <View style={styles.step}>
      <StepHeading title={t('budgetCreate.dependents.question')} description={t('budgetCreate.dependents.description')} />
      <Counter label={t('budgetCreate.household.dependents')} value={dependents} minimum={0} maximum={household - 1} disabled={pending} onChange={setDependents} />
      {invalidHousehold.has('dependents') ? <UiText accessibilityRole="alert" align="center" tone="destructive" variant="meta">{t('budgetCreate.household.fieldErrors.dependents')}</UiText> : null}
    </View> : null}
    {step === 2 ? <View style={styles.step}>
      <StepHeading title={t('budgetCreate.incomeStep.question')} description={t('budgetCreate.incomeStep.description')} />
      <UiText tone="muted" variant="meta">{t('budgetCreate.income.helper')}</UiText>
      {incomes.map((income, index) => <IncomeEditor key={income.id} income={income} index={index} disabled={pending} invalidFields={invalidIncomes.get(income.id) ?? new Set()} onChange={(patch) => updateIncome(income.id, patch)} onRemove={() => setIncomes((current) => current.filter((item) => item.id !== income.id))} />)}
      <View style={styles.actions}><Button disabled={pending} icon="plus" label={t('budgetCreate.income.add')} onPress={addIncome} variant="outline" /></View>
    </View> : null}
    {step === 3 ? <View style={styles.step}>
      <StepHeading title={t('budgetCreate.review.title')} />
      <VisibilityChoice disabled={locked} value={visibility} onChange={setVisibility} />
      <View style={[styles.group, { borderColor: palette.border }]}>
        <ReviewRow label={t('budgetCreate.review.household')} value={String(household)} palette={palette} />
        <ReviewRow label={t('budgetCreate.review.adults')} value={String(household - dependents)} palette={palette} separated />
        <ReviewRow label={t('budgetCreate.review.dependents')} value={String(dependents)} palette={palette} separated />
      </View>
      {wireIncomes.length === 0 ? <UiText tone="muted" variant="meta">{t('budgetCreate.review.noIncome')}</UiText> : <View style={[styles.group, { borderColor: palette.border }]}>{wireIncomes.map((income, index) => <View key={income.id} style={[styles.reviewIncome, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}><View style={styles.reviewIncomeHead}><UiText style={styles.shrink} variant="bodyStrong">{income.name.trim()}</UiText><UiText variant="amountBase">{money(Number(income.amount))}</UiText></View><UiText tone="muted" variant="meta">{`${income.isRecurrent ? t(`budgetMonth.recurrence.${income.recurrency}`) : t('budgetCreate.income.oneTime')} · ${t('budgetCreate.review.monthlyEquivalent', { amount: money(monthlyEquivalent(Number(income.amount), income.isRecurrent, income.recurrency)) })}`}</UiText></View>)}</View>}
      <View style={styles.total}><UiText variant="bodyStrong">{t('budgetCreate.review.total')}</UiText><UiText accessibilityLabel={t('budgetCreate.review.totalAccessible', { amount: money(monthlyEquivalentTotal(wireIncomes)) })} variant="figure">{money(monthlyEquivalentTotal(wireIncomes))}</UiText></View>
      <UiText tone="muted" variant="meta">{t('budgetCreate.review.safety')}</UiText>
    </View> : null}
    {step > 0 ? <View style={styles.actions}><Button disabled={locked} icon="arrow-left" label={t('budgetCreate.previous')} onPress={previous} variant="ghost" /></View> : null}
  </View></ScrollView>
  </SafeAreaView>
}

const LAST_STEP = 3

/** Web's wizard step head: a large centred question and a muted centred line under it. */
function StepHeading({ title, description }: { title: string; description?: string }) {
  return <View style={styles.stepHeading}>
    <UiText accessibilityRole="header" align="center" variant="title">{title}</UiText>
    {description ? <UiText align="center" tone="muted" variant="meta">{description}</UiText> : null}
  </View>
}

/**
 * Who sees the budget, chosen once here: the API takes it only at creation. Household is the
 * default; the line under the control says what the selected choice means.
 */
function VisibilityChoice({ value, disabled, onChange }: { value: BudgetVisibility; disabled: boolean; onChange: (value: BudgetVisibility) => void }) {
  const { t } = useTranslation()
  return <View style={styles.visibility}>
    <UiText accessibilityRole="header" variant="bodyStrong">{t('budgetCreate.visibility.label')}</UiText>
    <SegmentedControl<BudgetVisibility>
      accessibilityLabel={t('budgetCreate.visibility.label')}
      fill
      onChange={(next) => { if (!disabled) onChange(next) }}
      options={[{ value: 'household', label: t('budgetCreate.visibility.household') }, { value: 'personal', label: t('budgetCreate.visibility.personal') }]}
      value={value}
    />
    <UiText tone="muted" variant="meta">{t(value === 'personal' ? 'budgetCreate.visibility.personalDescription' : 'budgetCreate.visibility.householdDescription')}</UiText>
  </View>
}

/** The count, large and centred, between round − / + controls (web draws a 1–10 slider). */
function Counter({ label, value, minimum, maximum, disabled, onChange }: { label: string; value: number; minimum: number; maximum: number; disabled: boolean; onChange: (value: number) => void }) {
  return <View style={styles.counter}>
    <CounterButton disabled={disabled || value <= minimum} glyph="minus" label={`− ${label}`} onPress={() => onChange(Math.max(minimum, value - 1))} />
    <UiText accessibilityLabel={`${label}: ${value}`} align="center" style={styles.counterValue} variant="display">{value}</UiText>
    <CounterButton disabled={disabled || value >= maximum} glyph="plus" label={`+ ${label}`} onPress={() => onChange(Math.min(maximum, value + 1))} />
  </View>
}

function CounterButton({ glyph, label, disabled, onPress }: { glyph: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.counterButton, { borderColor: focused ? palette.ring : palette.primary }, focused && styles.focused, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Icon color={palette.primary} name={glyph} size={themeTokens.size.icon} />
    </Pressable>
  )
}

/** One-time or a recurrence, as one choice: the API's `isRecurrent` plus `recurrency`. */
const ONE_TIME = 'ONE_TIME'
type IncomeCadence = BudgetRecurrence | typeof ONE_TIME

function IncomeEditor({ income, index, disabled, invalidFields, onChange, onRemove }: { income: EditableIncome; index: number; disabled: boolean; invalidFields: ReadonlySet<IncomeField>; onChange: (patch: Partial<EditableIncome>) => void; onRemove: () => void }) {
  const { t } = useTranslation()
  // A row nobody has typed into only keeps ✓ disabled; once it has content,
  // whatever is still wrong in it says so under its field.
  const touched = income.name !== '' || income.amount !== ''
  const nameError = touched && invalidFields.has('name') ? t('budgetCreate.income.fieldErrors.name') : null
  const amountError = touched && invalidFields.has('amount') ? t('budgetCreate.income.fieldErrors.amount') : null
  const cadence: IncomeCadence = income.isRecurrent ? income.recurrency : ONE_TIME
  return <View style={styles.income}>
    <UiText accessibilityRole="header" variant="bodyStrong">{t('budgetCreate.income.row', { number: index + 1 })}</UiText>
    <FormGroup>
      <FormTextRow key="name" accessibilityLabel={t('budgetCreate.income.name')} editable={!disabled} error={nameError} label={t('budgetCreate.income.name')} maxLength={100} onChangeText={(name) => onChange({ name })} value={income.name} />
      <FormTextRow key="amount" accessibilityLabel={t('budgetCreate.income.amount')} editable={!disabled} error={amountError} keyboardType="decimal-pad" label={t('budgetCreate.income.amount')} onChangeText={(amount) => onChange({ amount })} placeholder="0.00" value={income.amount} />
      <FormSelectRow<IncomeCadence>
        key="recurrence"
        disabled={disabled}
        label={t('budgetCreate.income.recurrence')}
        onChange={(value) => onChange(value === ONE_TIME ? { isRecurrent: false } : { isRecurrent: true, recurrency: value })}
        options={[...recurrences.map((value) => ({ value, label: t(`budgetMonth.recurrence.${value}`) })), { value: ONE_TIME, label: t('budgetCreate.income.oneTime') }]}
        placeholder={t('transactionCreate.choose')}
        value={cadence}
      />
    </FormGroup>
    <View style={styles.actions}><Button disabled={disabled} icon="trash" label={t('budgetCreate.income.remove')} onPress={onRemove} size="sm" variant="ghost" /></View>
  </View>
}

function ReviewRow({ label, value, palette, separated = false }: { label: string; value: string; palette: Palette; separated?: boolean }) { return <View style={[styles.reviewRow, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}><UiText variant="body">{label}</UiText><UiText variant="amountBase">{value}</UiText></View> }

const styles = StyleSheet.create({
  safe: { flex: 1 },
  progressBar: { alignItems: 'flex-end', paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[3] },
  progressTrack: { width: 160, height: 8, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: themeTokens.radius.pill },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 672, alignSelf: 'center', gap: themeTokens.spacing[6] },
  step: { gap: themeTokens.spacing[6] },
  stepHeading: { gap: themeTokens.spacing[2] },
  shrink: { flexShrink: 1 },
  counter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: themeTokens.spacing[6], paddingVertical: themeTokens.spacing[4] },
  counterButton: { width: 48, height: 48, borderRadius: themeTokens.radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  counterValue: { minWidth: 64 },
  focused: { borderWidth: 2 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  income: { gap: themeTokens.spacing[2] },
  visibility: { gap: themeTokens.spacing[2] },
  group: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  candidate: { gap: themeTokens.spacing[1], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  reviewRow: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewIncome: { paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[1] },
  reviewIncomeHead: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  total: { paddingTop: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
})
