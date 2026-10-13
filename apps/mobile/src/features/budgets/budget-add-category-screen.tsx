import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BudgetRecurrence } from './budgets-contract'
import { BudgetFailure, BudgetHeader, BudgetLoading } from './budgets-screen'
import type { AddBudgetCategoryFailure } from './use-add-budget-category'

export type LeafCategoryOption = Readonly<{ id: number; name: string }>
export type Reconciliation = 'committed' | 'absent' | 'duplicate-present' | 'duplicate-unknown' | 'refresh-failed' | null
const recurrences: BudgetRecurrence[] = ['MONTHLY', 'MONTHLY_14', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']

export type BudgetAddCategoryScreenProps = Readonly<{
  status: 'loading' | 'error' | 'ready'
  categories: readonly LeafCategoryOption[]
  currency: string
  year: number
  pending: boolean
  failure: AddBudgetCategoryFailure | null
  reconciliation: Reconciliation
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onSubmit: (value: { categoryKey: number; amountBudgeted: number; recurrency: BudgetRecurrence }) => Promise<void>
  onNewAttempt: () => void
}>

export function BudgetAddCategoryScreen(props: BudgetAddCategoryScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [recurrence, setRecurrence] = useState<BudgetRecurrence>('MONTHLY')
  const [review, setReview] = useState(false)
  const [validation, setValidation] = useState(false)
  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])
  if (props.status === 'loading') return <BudgetLoading label={t('budgetAddCategory.loading')} palette={palette} />
  if (props.status === 'error') return <BudgetFailure title={t('budgetAddCategory.errorTitle')} message={t('budgetAddCategory.errorMessage')} onRetry={props.onRefresh} onBack={props.onBack} palette={palette} />
  const category = props.categories.find((option) => option.id === categoryId)
  const parsedAmount = Number(amount)
  const valid = Boolean(category && Number.isFinite(parsedAmount) && parsedAmount > 0)
  const locked = props.reconciliation !== null
  const resolving = props.failure === 'unknown' || props.failure === 'duplicate'
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = Number.isFinite(parsedAmount) ? formatCurrency(parsedAmount, { locale, currency: props.currency }) : amount
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
    <BudgetHeader title={t('budgetAddCategory.title')} backLabel={t('budgetAddCategory.back')} onBack={props.onBack} disabled={props.pending} palette={palette} />
    {props.failure && !locked ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetAddCategory.failures.${props.failure}`)}</Text> : null}
    {locked ? <View style={styles.section}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.alert, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t(`budgetAddCategory.reconciliation.${props.reconciliation}`)}</Text>
      {props.reconciliation === 'absent' ? <Button label={t('budgetAddCategory.newAttempt')} onPress={props.onNewAttempt} palette={palette} variant="primary" /> : null}
    </View> : !review ? <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetAddCategory.choose')}</Text>
      {props.categories.length === 0 ? <Text style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('budgetAddCategory.none')}</Text> : <View accessibilityRole="radiogroup" style={styles.options}>{props.categories.map((option) => <Choice key={option.id} label={option.name} selected={categoryId === option.id} disabled={props.pending} onPress={() => setCategoryId(option.id)} palette={palette} />)}</View>}
      <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetAddCategory.amount')}</Text><TextInput accessibilityLabel={t('budgetAddCategory.amount')} accessibilityHint={t('budgetAddCategory.amountHint')} editable={!props.pending} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
      <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetAddCategory.recurrence')}</Text><View accessibilityRole="radiogroup" style={styles.options}>{recurrences.map((value) => <Choice key={value} label={t(`budgetMonth.recurrence.${value}`)} selected={recurrence === value} disabled={props.pending} onPress={() => setRecurrence(value)} palette={palette} />)}</View>
      {validation ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('budgetAddCategory.validation')}</Text> : null}
      <Button disabled={props.pending || props.categories.length === 0} label={t('budgetAddCategory.review')} onPress={() => { if (!valid) setValidation(true); else { setValidation(false); setReview(true) } }} palette={palette} variant="primary" />
    </View> : <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('budgetAddCategory.reviewTitle')}</Text>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}><Text style={[styles.cardTitle, { color: palette.foreground }]}>{category?.name}</Text><Text style={[styles.amount, { color: palette.foreground }]}>{money}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`budgetMonth.recurrence.${recurrence}`)}</Text></View>
      <Text style={[styles.scope, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('budgetAddCategory.scope', { year: props.year })}</Text>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetAddCategory.safety')}</Text>
      <View style={styles.actions}><Button disabled={props.pending || resolving} label={t('budgetAddCategory.edit')} onPress={() => setReview(false)} palette={palette} variant="secondary" /><Button disabled={props.pending || resolving} label={props.pending ? t('budgetAddCategory.adding') : t('budgetAddCategory.add')} onPress={() => props.onSubmit({ categoryKey: categoryId!, amountBudgeted: parsedAmount, recurrency: recurrence })} palette={palette} variant="primary" /></View>
    </View>}
  </View></ScrollView></SafeAreaView>
}

function Choice({ label, selected, disabled, onPress, palette }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; palette: Palette }) { return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }]}><Text style={[styles.choiceText, { color: palette.foreground }]}>{label}</Text></Pressable> }
const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap }, section: { gap: themeTokens.spacing[4] }, sectionTitle: { ...textStyles.section }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choiceText: { ...textStyles.body }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.amount, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, card: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[2] }, cardTitle: { ...textStyles.section }, amount: { ...textStyles.display }, helper: { ...textStyles.body }, scope: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, safety: { ...textStyles.body }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[3] }, alert: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, error: { ...textStyles.body }, empty: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})
