import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { parseNumberInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BudgetRecurrence } from './budgets-contract'
import { BudgetFailure, BudgetLoading } from './budgets-screen'
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
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [recurrence, setRecurrence] = useState<BudgetRecurrence>('MONTHLY')
  const [review, setReview] = useState(false)
  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])
  if (props.status === 'loading') return <BudgetLoading label={t('budgetAddCategory.loading')} palette={palette} />
  if (props.status === 'error') return <BudgetFailure title={t('budgetAddCategory.errorTitle')} message={t('budgetAddCategory.errorMessage')} onRetry={props.onRefresh} onBack={props.onBack} palette={palette} />
  const category = props.categories.find((option) => option.id === categoryId)
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // Read in the app's language ("1.234,56" in pt and es).
  const typedAmount = parseNumberInput(amount, locale)
  const parsedAmount = typedAmount ?? Number.NaN
  const amountValid = typedAmount !== null && typedAmount > 0
  const valid = Boolean(category && amountValid)
  const amountError = amount.trim() !== '' && !amountValid ? t('budgetAddCategory.amountHint') : null
  const locked = props.reconciliation !== null
  const resolving = props.failure === 'unknown' || props.failure === 'duplicate'
  const money = Number.isFinite(parsedAmount) ? formatMoney(parsedAmount, { locale, currency: props.currency }) : amount
  const recurrenceLabel = (value: BudgetRecurrence) => t(`budgetMonth.recurrence.${value}`)
  const save = locked ? undefined : review
    ? () => void props.onSubmit({ categoryKey: categoryId!, amountBudgeted: parsedAmount, recurrency: recurrence })
    : () => setReview(true)
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <FormBar
      closeDisabled={props.pending}
      closeLabel={t('common.close')}
      onClose={props.onBack}
      onSave={save}
      saveDisabled={review ? props.pending || resolving : !valid || props.pending}
      saveLabel={review ? (props.pending ? t('budgetAddCategory.adding') : t('budgetAddCategory.add')) : t('budgetAddCategory.review')}
      saving={review && props.pending}
      title={t('budgetAddCategory.title')}
    />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
      {props.failure && !locked ? <FormNotice tone="destructive">{t(`budgetAddCategory.failures.${props.failure}`)}</FormNotice> : null}
      {locked ? <View style={styles.section}>
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.notice, { borderColor: palette.border }]} variant="body">{t(`budgetAddCategory.reconciliation.${props.reconciliation}`)}</Text>
        {props.reconciliation === 'absent' ? <View style={styles.actions}><Button label={t('budgetAddCategory.newAttempt')} onPress={props.onNewAttempt} variant="primary" /></View> : null}
      </View> : !review ? <View style={styles.section}>
        <AmountEntry
          accessibilityLabel={t('budgetAddCategory.amount')}
          caption={t('budgetAddCategory.amount')}
          currency={props.currency}
          editable={!props.pending}
          error={amountError}
          locale={locale}
          onChangeText={setAmount}
          value={amount}
        />
        {props.categories.length === 0 ? <Text tone="muted" variant="body">{t('budgetAddCategory.none')}</Text> : null}
        <FormGroup>
          <FormSelectRow
            key="category"
            disabled={props.pending || props.categories.length === 0}
            hint={t('budgetAddCategory.helper')}
            label={t('transactionCreate.category')}
            onChange={setCategoryId}
            options={props.categories.map((option) => ({ value: option.id, label: option.name }))}
            placeholder={t('transactionCreate.choose')}
            value={categoryId}
          />
          <FormSelectRow
            key="recurrence"
            disabled={props.pending}
            label={t('budgetAddCategory.recurrence')}
            onChange={setRecurrence}
            options={recurrences.map((value) => ({ value, label: recurrenceLabel(value) }))}
            placeholder={t('transactionCreate.choose')}
            value={recurrence}
          />
        </FormGroup>
      </View> : <View style={styles.section}>
        <Text accessibilityRole="header" variant="heading">{t('budgetAddCategory.reviewTitle')}</Text>
        <View style={[styles.review, { borderColor: palette.border }]}>
          <ReviewRow label={t('transactionCreate.category')} value={category?.name ?? ''} first />
          <ReviewRow label={t('budgetAddCategory.amount')} value={money} data />
          <ReviewRow label={t('budgetAddCategory.recurrence')} value={recurrenceLabel(recurrence)} />
        </View>
        <Text variant="body">{t('budgetAddCategory.scope', { year: props.year })}</Text>
        <Text tone="muted" variant="meta">{t('budgetAddCategory.safety')}</Text>
        <View style={styles.actions}><Button disabled={props.pending || resolving} label={t('budgetAddCategory.edit')} onPress={() => setReview(false)} variant="secondary" /></View>
      </View>}
    </View></ScrollView>
  </SafeAreaView>
}

function ReviewRow({ label, value, data = false, first = false }: { label: string; value: string; data?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View style={[styles.reviewRow, !first && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text style={styles.reviewLabel} variant="body">{label}</Text>
      <Text style={styles.reviewValue} variant={data ? 'amountBase' : 'body'}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] },
  section: { gap: themeTokens.spacing[4] },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  review: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0 },
  reviewValue: { flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
