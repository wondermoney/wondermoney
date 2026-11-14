import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { budgetCategoryWriteSchema, type BudgetCategoryWrite, type BudgetRecurrence, type BudgetSuggestionDto } from './budgets-contract'
import type { BudgetCategoryChildViewModel } from './budgets-view-model'
import { classifyBudgetCategoryWriteFailure, type BudgetCategoryWriteFailure } from './use-budget-category-mutation'
import { FormSwitchRow } from '@/components/ui/form-row'
import { parseNumberInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type BudgetCategoryScope = 'month' | 'following-months'

const recurrences: readonly BudgetRecurrence[] = ['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']

/** The typed amount, read in the app's language; `null` unless it is positive. */
export function parseRawBudgetAmount(value: string, locale: string): number | null {
  const amount = parseNumberInput(value, locale)
  return amount !== null && amount > 0 ? amount : null
}

const confirmForwardScope = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export function BudgetCategoryEditor({ child, currency, year, month, locale, pending, palette, suggestion, onSave, onCancel }: { child: BudgetCategoryChildViewModel; currency: string; year: number; month: number; locale: string; pending: boolean; palette: Palette; suggestion?: BudgetSuggestionDto | null; onSave: (value: BudgetCategoryWrite) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const initialAmount = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(child.rawAmount)
  const [amountInput, setAmountInput] = useState(initialAmount)
  const [recurrence, setRecurrence] = useState<BudgetRecurrence | null>(child.recurrence)
  const [scope, setScope] = useState<BudgetCategoryScope>('month')
  const [rolloverEnabled, setRolloverEnabled] = useState(child.rolloverEnabled)
  const [failure, setFailure] = useState<BudgetCategoryWriteFailure | null>(null)
  const amount = parseRawBudgetAmount(amountInput, locale)
  const value = amount === null || recurrence === null ? null : {
    amount,
    recurrency: recurrence,
    applyToFollowingMonths: scope === 'following-months',
    // Only a change is sent: an unchanged switch leaves each month's own setting alone.
    ...(rolloverEnabled !== child.rolloverEnabled ? { rolloverEnabled } : {}),
  }
  const valid = value !== null && budgetCategoryWriteSchema.safeParse(value).success

  const save = async () => {
    if (pending || !valid || !value) { setFailure('invalid'); return }
    if (scope === 'following-months') {
      const formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const start = formatter.format(new Date(Date.UTC(year, month - 1, 15)))
      const confirmed = await confirmForwardScope(
        t('budgetCategory.confirmTitle'),
        t('budgetCategory.confirmMessage', { start }),
        t('common.cancel'),
        t('budgetCategory.confirmAction'),
      )
      if (!confirmed) return
    }
    setFailure(null)
    try {
      await onSave(value)
      onCancel()
    } catch (error) {
      setFailure(classifyBudgetCategoryWriteFailure(error))
    }
  }

  return <View accessibilityLabel={t('budgetCategory.editorLabel', { name: child.name })} style={[styles.editor, { borderColor: palette.border, backgroundColor: palette.muted }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('budgetCategory.title', { name: child.name })}</Text>
    <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCategory.rawHelper')}</Text>
    {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetCategory.failures.${failure}`)}</Text> : null}
    <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCategory.amount')}</Text>
    <TextInput accessibilityLabel={t('budgetCategory.amount')} accessibilityHint={t('budgetCategory.amountHint')} editable={!pending} keyboardType="decimal-pad" value={amountInput} onChangeText={setAmountInput} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]} />
    {suggestion?.hasEnoughData && suggestion.suggested !== null ? (
      <View style={[styles.suggestion, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCategory.suggestionLabel', { amount: formatMoney(suggestion.suggested, { currency, locale }) })}</Text>
        <EditorButton label={t('budgetCategory.suggestionApply')} disabled={pending} busy={false} onPress={() => setAmountInput(new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(suggestion.suggested!))} palette={palette} />
      </View>
    ) : suggestion ? (
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('budgetCategory.suggestionNotEnoughData')}</Text>
    ) : null}
    <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCategory.recurrence')}</Text>
    {child.recurrence === null ? <Text accessibilityRole="alert" style={[styles.legacy, { color: palette.mutedForeground }]}>{t('budgetCategory.legacyRecurrence')}</Text> : null}
    <View accessibilityRole="radiogroup" style={styles.choices}>{recurrences.map((option) => <Choice key={option} label={t(`budgetMonth.recurrence.${option}`)} selected={recurrence === option} disabled={pending} onPress={() => setRecurrence(option)} palette={palette} />)}</View>
    <View style={[styles.switch, { borderColor: palette.border, backgroundColor: palette.background }]}>
      <FormSwitchRow
        disabled={pending}
        hint={t('budgetCategory.rolloverHint')}
        label={t('budgetCategory.rollover')}
        onValueChange={setRolloverEnabled}
        testID="budget-category-rollover"
        value={rolloverEnabled}
      />
    </View>
    <Text style={[styles.label, { color: palette.foreground }]}>{t('budgetCategory.scope')}</Text>
    <View accessibilityRole="radiogroup" style={styles.choices}>
      <Choice label={t('budgetCategory.scopeMonth')} selected={scope === 'month'} disabled={pending} onPress={() => setScope('month')} palette={palette} />
      <Choice label={t('budgetCategory.scopeForward')} selected={scope === 'following-months'} disabled={pending} onPress={() => setScope('following-months')} palette={palette} />
    </View>
    <Text style={[styles.scopeNote, { color: palette.mutedForeground }]}>{t('budgetCategory.scopeNote')}</Text>
    <View style={styles.actions}>
      <EditorButton label={pending ? t('budgetCategory.saving') : t('budgetCategory.save')} disabled={!valid || pending} busy={pending} onPress={save} primary palette={palette} />
      <EditorButton label={t('common.cancel')} disabled={pending} busy={false} onPress={onCancel} palette={palette} />
    </View>
  </View>
}

function Choice({ label, selected, disabled, onPress, palette }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; palette: Palette }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.background }]}><View style={[styles.radio, { borderColor: selected ? palette.primary : palette.mutedForeground }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}</View><Text style={[styles.choiceLabel, { color: palette.foreground }]}>{label}</Text></Pressable>
}

function EditorButton({ label, disabled, busy, onPress, primary = false, palette }: { label: string; disabled: boolean; busy: boolean; onPress: () => void | Promise<void>; primary?: boolean; palette: Palette }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={[styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, disabled && styles.disabled]}><Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  editor: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, title: { ...textStyles.section, fontWeight: '700' as const }, helper: { ...textStyles.meta }, label: { ...textStyles.bodyStrong, fontWeight: '700' as const, marginTop: themeTokens.spacing[1] }, input: { ...textStyles.amount, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choices: { gap: themeTokens.spacing[2] }, choice: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 10, height: 10, borderRadius: 5 }, choiceLabel: { ...textStyles.body, flex: 1 }, legacy: { ...textStyles.meta }, scopeNote: { ...textStyles.label }, switch: { borderWidth: 1, borderRadius: themeTokens.radius.md, overflow: 'hidden' }, suggestion: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], gap: themeTokens.spacing[2] }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, justifyContent: 'center', alignItems: 'center', paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.bodyStrong, fontWeight: '700' as const }, disabled: { opacity: 0.45 }, alert: { ...textStyles.meta, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
})
