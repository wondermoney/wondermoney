import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import type { SheetOption } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import type { CategoryViewModel } from '@/features/categories/categories-view-model'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { TransactionSplitLineRequest } from './transactions-contract'
import {
  draftFromSplits,
  formatUnitsForInput,
  isSplitTransaction,
  MAX_SPLIT_LINES,
  newSplitLineId,
  sameSplitDraft,
  type SplitDraftLine,
  startSplitDraft,
  splitEvenly,
  splitTotalUnits,
  summarizeSplit,
  toSplitRequest,
  unitsToNumber,
} from './transactions-split-view-model'
import type { TransactionViewModel } from './transactions-view-model'

const UNCATEGORIZED = 0

export type TransactionSplitScreenProps = Readonly<{
  transaction: TransactionViewModel
  categories: readonly CategoryViewModel[]
  locale: string
  /** A save or remove request is running. */
  pending?: boolean
  /** A message from a failed request, shown above the actions. */
  error?: string | null
  onClose: () => void
  onSave: (lines: readonly TransactionSplitLineRequest[]) => void | Promise<void>
  /** Omitted, the editor hides "Remove split". */
  onRemove?: () => void | Promise<void>
}>

/**
 * The split editor, full screen: one line per category with an amount and a note, and the amount
 * still to assign. Save stays blocked until the lines add up to the transaction's amount, as the
 * API requires. Opened from a transaction's detail; the list keeps the row behind it.
 */
export function TransactionSplitScreen({
  transaction,
  categories,
  locale,
  pending = false,
  error = null,
  onClose,
  onSave,
  onRemove,
}: TransactionSplitScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const totalUnits = splitTotalUnits(transaction) ?? 0n
  const wasSplit = isSplitTransaction(transaction)

  // Read once, when the editor opens: the row behind it does not change while it is open.
  const [initial] = useState<SplitDraftLine[]>(() => (
    wasSplit ? draftFromSplits(transaction.splits, locale) : startSplitDraft(transaction)
  ))
  const [lines, setLines] = useState<SplitDraftLine[]>(initial)
  const summary = useMemo(() => summarizeSplit(lines, totalUnits, locale), [lines, totalUnits, locale])
  // A new split is ready to save as soon as its lines balance; an existing one only when changed.
  const changed = !wasSplit || !sameSplitDraft(lines, initial)
  const blocked = summary.problem !== null

  const categoryOptions: SheetOption<number>[] = [
    { value: UNCATEGORIZED, label: t('transactions.split.uncategorized') },
    ...categories.flatMap((category) => [category, ...category.children]).map((category) => ({ value: category.id, label: category.name })),
  ]

  const update = (index: number, change: Partial<SplitDraftLine>) => {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...change } : line)))
  }
  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, at) => at !== index))
  }
  const addLine = () => {
    setLines((current) => [...current, { id: newSplitLineId(), categoryId: null, amount: '', notes: '' }])
  }
  const evenly = () => {
    const amounts = splitEvenly(totalUnits, lines.length)
    setLines((current) => current.map((line, index) => ({ ...line, amount: formatUnitsForInput(amounts[index]!, locale) })))
  }

  const save = () => {
    if (blocked || pending) return
    void onSave(toSplitRequest(lines, summary))
  }

  const largestLine = [...transaction.splits].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
  const largestCategoryId = largestLine?.category?.categoryKey ?? null
  const largestCategory = largestCategoryId === null
    ? t('transactions.split.uncategorized')
    : categories.flatMap((category) => [category, ...category.children]).find((category) => category.id === largestCategoryId)?.name
      ?? largestLine?.category?.name
      ?? t('transactions.split.uncategorized')
  const confirmRemove = () => {
    Alert.alert(t('transactions.split.removeTitle'), t('transactions.split.removeDescription', { category: largestCategory }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('transactions.split.remove'), style: 'destructive', onPress: () => void onRemove?.() },
    ])
  }

  const remaining = summary.remainingUnits
  const over = remaining !== 0n && remaining < 0n !== totalUnits < 0n
  const problemHint = summary.problem === 'line-errors'
    ? t('transactions.split.needsAmounts')
    : blocked ? t('transactions.split.saveBlocked') : null

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar
          closeDisabled={pending}
          closeLabel={t('transactions.split.close')}
          onClose={onClose}
          onSave={save}
          saveDisabled={blocked || pending || !changed}
          saveLabel={t('transactions.split.save')}
          saving={pending}
          testID="transaction-split"
          title={t('transactions.split.title')}
        />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.totalRow}>
            <Text tone="muted" variant="meta">{t('transactions.split.total')}</Text>
            <Amount currency={transaction.settlementCurrency} locale={locale} size="amountLarge" value={unitsToNumber(totalUnits)} />
          </View>

          <View style={styles.lines}>
            {lines.map((line, index) => {
              const number = index + 1
              const lineError = summary.lines[index]?.error ?? null
              return (
                <View key={line.id} style={[styles.line, { borderColor: palette.border }]} testID={`transaction-split-line-${number}`}>
                  <View style={styles.lineHead}>
                    <Text variant="metaStrong">{t('transactions.split.line', { number })}</Text>
                    <Button
                      accessibilityLabel={t('transactions.split.removeLine', { number })}
                      disabled={pending || lines.length <= 2}
                      icon="trash"
                      label={t('transactions.split.removeLine', { number })}
                      onPress={() => removeLine(index)}
                      size="icon"
                      variant="ghost"
                    />
                  </View>
                  <FormSelectRow
                    accessibilityLabel={t('transactions.split.lineCategory', { number })}
                    disabled={pending}
                    label={t('transactions.split.category')}
                    onChange={(value) => update(index, { categoryId: value === UNCATEGORIZED ? null : value })}
                    options={categoryOptions}
                    placeholder={t('transactions.split.uncategorized')}
                    value={line.categoryId ?? UNCATEGORIZED}
                  />
                  <View style={{ borderTopWidth: 1, borderTopColor: palette.border }}>
                    <FormTextRow
                      accessibilityLabel={t('transactions.split.lineAmount', { number })}
                      editable={!pending}
                      error={lineError ? t(`transactions.split.lineErrors.${lineError}`) : null}
                      keyboardType="numbers-and-punctuation"
                      label={t('transactions.split.amount')}
                      onChangeText={(value) => update(index, { amount: value })}
                      placeholder="0"
                      value={line.amount}
                    />
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: palette.border }}>
                    <FormTextRow
                      accessibilityLabel={t('transactions.split.lineNote', { number })}
                      editable={!pending}
                      label={t('transactions.split.note')}
                      maxLength={500}
                      onChangeText={(value) => update(index, { notes: value })}
                      placeholder={t('transactions.split.notePlaceholder')}
                      value={line.notes}
                    />
                  </View>
                </View>
              )
            })}
          </View>

          <Text tone="muted" variant="label">{t('transactions.split.amountHint')}</Text>

          <View style={styles.actions}>
            <Button
              disabled={pending || lines.length >= MAX_SPLIT_LINES}
              icon="plus"
              label={t('transactions.split.addLine')}
              onPress={addLine}
              size="sm"
              variant="outline"
            />
            <Button
              disabled={pending}
              label={t('transactions.split.splitEvenly')}
              onPress={evenly}
              size="sm"
              variant="outline"
            />
          </View>

          {/* The live remainder. Words, not only colour, say which way it is off. */}
          <View
            accessibilityLiveRegion="polite"
            style={[styles.remaining, { backgroundColor: palette.muted }]}
            testID="transaction-split-remaining"
          >
            {remaining === 0n ? (
              <Text tone="success" variant="bodyStrong">{t('transactions.split.balanced')}</Text>
            ) : (
              <>
                <Text variant="bodyStrong">{over ? t('transactions.split.over') : t('transactions.split.remaining')}</Text>
                <Amount
                  currency={transaction.settlementCurrency}
                  locale={locale}
                  size="amount"
                  value={Math.abs(unitsToNumber(remaining))}
                />
              </>
            )}
          </View>

          {problemHint ? <Text tone="muted" variant="meta">{problemHint}</Text> : null}
          {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}

          {wasSplit && onRemove ? (
            <Button
              disabled={pending}
              icon="trash"
              label={t('transactions.split.remove')}
              onPress={confirmRemove}
              variant="destructive-quiet"
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8], gap: themeTokens.spacing[4], width: '100%', maxWidth: 760, alignSelf: 'center' },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  lines: { gap: themeTokens.spacing[3] },
  line: { borderWidth: 1, borderRadius: themeTokens.radius.lg, paddingVertical: themeTokens.spacing[2], overflow: 'hidden' },
  lineHead: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2], paddingHorizontal: themeTokens.spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  remaining: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
})
