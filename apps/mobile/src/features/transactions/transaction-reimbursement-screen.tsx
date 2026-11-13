import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatMoneyForDisplay } from '@/lib/formatters/money-display'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { TextField } from './form-field'
import type { LinkedTransactionDto, ReimbursementLinkDto, ReimbursementSuggestionDto } from './reimbursements-contract'
import {
  classifyReimbursementFailure,
  defaultLinkAmountUnits,
  linkedSide,
  linkedTitle,
  readLinkAmount,
} from './reimbursements-view-model'
import { formatShortDate } from './transactions-date-range'
import { amountToUnits, formatUnitsForInput, unitsToDecimal, unitsToNumber } from './transactions-split-view-model'
import type { TransactionViewModel } from './transactions-view-model'
import {
  useLinkReimbursement,
  useReimbursementSuggestions,
  useTransactionReimbursements,
  useUnlinkReimbursement,
} from './use-transaction-reimbursements'

/** How long typing rests before the search is sent. */
export const SUGGESTION_SEARCH_DELAY_MS = 300

export type TransactionReimbursementScreenProps = Readonly<{
  /** The reimbursement: money in, not a transfer (`canMarkAsReimbursement`). */
  transaction: TransactionViewModel
  locale: string
  onClose: () => void
}>

/**
 * "Mark as reimbursement", full screen, opened from an incoming transaction's detail: the expenses
 * it could pay back (by merchant or amount, or by a search), the amount to link, and the links it
 * already has, each with Unlink. Linking takes that amount off the expense's category spending and
 * off income; balances do not change. In this version only an expense in the same settlement
 * currency can be linked, which the screen says before anyone tries.
 */
export function TransactionReimbursementScreen({ transaction, locale, onClose }: TransactionReimbursementScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { hidden: amountsHidden } = usePrivacyMode()
  const links = useTransactionReimbursements(transaction.id)
  const [search, setSearch] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  useEffect(() => {
    const next = search.trim()
    if (next === settledSearch) return undefined
    const timer = setTimeout(() => setSettledSearch(next), SUGGESTION_SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, settledSearch])
  const suggestions = useReimbursementSuggestions(transaction.id, settledSearch)
  const link = useLinkReimbursement()
  const unlink = useUnlinkReimbursement()
  const [chosen, setChosen] = useState<ReimbursementSuggestionDto | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const currency = links.data?.currencyCode ?? transaction.settlementCurrency
  const existing: readonly ReimbursementLinkDto[] = links.data?.links ?? transaction.reimbursements
  // What is left of this refund to link: the server's figure once it is in, else the row's own.
  const remaining = links.data?.remainingAmount
    ?? Math.max(0, (transaction.settlementAmount ?? 0) - existing.reduce((sum, item) => sum + item.amount, 0))
  const capUnits = chosen ? defaultLinkAmountUnits(remaining, chosen.remainingAmount) : 0n
  const read = useMemo(() => readLinkAmount(amount, capUnits, locale), [amount, capUnits, locale])
  const fullyLinked = links.data !== undefined && amountToUnits(remaining) === 0n
  const pending = link.isPending || unlink.isPending
  const canSave = chosen !== null && read.units !== null && read.error === null && !pending && !fullyLinked

  const money = (value: number) => (currency ? formatMoneyForDisplay(value, { locale, currency }, amountsHidden) : String(value))
  const failureMessage = (caught: unknown) => t(`transactions.reimbursement.errors.${classifyReimbursementFailure(caught)}`)

  const choose = (suggestion: ReimbursementSuggestionDto) => {
    setError(null)
    if (chosen?.transactionKey === suggestion.transactionKey) {
      setChosen(null)
      setAmount('')
      return
    }
    setChosen(suggestion)
    setAmount(formatUnitsForInput(defaultLinkAmountUnits(remaining, suggestion.remainingAmount), locale))
  }

  const save = async () => {
    if (!canSave || !chosen || read.units === null) return
    setError(null)
    try {
      await link.mutateAsync({ transactionId: transaction.id, expenseTransactionId: chosen.transactionKey, amount: unitsToDecimal(read.units) })
      onClose()
    } catch (caught) {
      setError(failureMessage(caught))
    }
  }

  const confirmUnlink = (item: ReimbursementLinkDto) => {
    const other = linkedSide(item, transaction.id)
    const name = linkedTitle(other) ?? t('transactions.unnamed')
    Alert.alert(
      t('transactions.reimbursement.unlinkTitle'),
      t('transactions.reimbursement.unlinkDescription', { amount: formatMoneyForDisplay(item.amount, { locale, currency: item.currencyCode }, amountsHidden), name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('transactions.reimbursement.unlink'),
          style: 'destructive',
          onPress: () => {
            setError(null)
            unlink.mutateAsync({ transactionId: transaction.id, transactionReimbursementKey: item.transactionReimbursementKey })
              .catch((caught: unknown) => setError(failureMessage(caught)))
          },
        },
      ],
    )
  }

  const amountError = read.error === 'over'
    ? t('transactions.reimbursement.amountErrors.over', { amount: money(unitsToNumber(capUnits)) })
    : read.error ? t(`transactions.reimbursement.amountErrors.${read.error}`) : null
  const list = suggestions.data?.suggestions ?? []

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar
          closeDisabled={pending}
          closeLabel={t('transactions.reimbursement.close')}
          onClose={onClose}
          onSave={() => void save()}
          saveDisabled={!canSave}
          saveLabel={t('transactions.reimbursement.save')}
          saving={link.isPending}
          testID="transaction-reimbursement"
          title={t('transactions.reimbursement.title')}
        />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.summary}>
            <Text numberOfLines={2} variant="bodyStrong">{transaction.title ?? t('transactions.unnamed')}</Text>
            <View style={styles.figureRow}>
              <Text tone="muted" variant="meta">{t('transactions.reimbursement.amountIn')}</Text>
              <Amount currency={currency} locale={locale} size="amountLarge" value={transaction.settlementAmount} />
            </View>
            <View style={styles.figureRow} testID="transaction-reimbursement-remaining">
              <Text tone="muted" variant="meta">{t('transactions.reimbursement.left')}</Text>
              <Amount currency={currency} locale={locale} size="amount" value={remaining} />
            </View>
            {currency ? <Text tone="muted" variant="label">{t('transactions.reimbursement.currencyHint', { currency })}</Text> : null}
          </View>

          {existing.length > 0 ? (
            <View style={styles.section}>
              <Text accessibilityRole="header" variant="metaStrong">{t('transactions.reimbursement.reimburses')}</Text>
              <View style={[styles.group, { borderColor: palette.border }]}>
                {existing.map((item, index) => (
                  <LinkLine
                    first={index === 0}
                    item={item}
                    key={item.transactionReimbursementKey}
                    locale={locale}
                    onUnlink={() => confirmUnlink(item)}
                    other={linkedSide(item, transaction.id)}
                    pending={pending}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {fullyLinked ? (
            <Text tone="muted" variant="meta">{t('transactions.reimbursement.fullyLinked')}</Text>
          ) : (
            <View style={styles.section}>
              <TextField
                autoCapitalize="none"
                autoCorrect={false}
                editable={!pending}
                label={t('transactions.reimbursement.searchLabel')}
                onChangeText={setSearch}
                placeholder={t('transactions.reimbursement.searchPlaceholder')}
                returnKeyType="search"
                value={search}
              />
              <Text accessibilityRole="header" variant="metaStrong">
                {settledSearch ? t('transactions.reimbursement.results') : t('transactions.reimbursement.suggested')}
              </Text>
              {suggestions.isLoading ? (
                <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('transactions.reimbursement.loading')}</Text>
              ) : suggestions.isError && list.length === 0 ? (
                <View accessibilityRole="alert" style={styles.inline}>
                  <Text tone="muted" variant="meta">{t('transactions.reimbursement.loadError')}</Text>
                  <Button label={t('common.retry')} onPress={() => void suggestions.refetch()} size="sm" variant="outline" />
                </View>
              ) : list.length === 0 ? (
                <Text tone="muted" variant="meta">
                  {settledSearch
                    ? t('transactions.reimbursement.emptySearch', { search: settledSearch })
                    : t('transactions.reimbursement.empty')}
                </Text>
              ) : (
                <View accessibilityRole="radiogroup" style={[styles.group, { borderColor: palette.border }]}>
                  {list.map((suggestion, index) => (
                    <SuggestionLine
                      checked={chosen?.transactionKey === suggestion.transactionKey}
                      disabled={pending}
                      first={index === 0}
                      key={suggestion.transactionKey}
                      locale={locale}
                      onPress={() => choose(suggestion)}
                      suggestion={suggestion}
                    />
                  ))}
                </View>
              )}

              {chosen ? (
                <FormGroup>
                  <FormTextRow
                    accessibilityLabel={t('transactions.reimbursement.amountLabel')}
                    editable={!pending}
                    error={amountError}
                    hint={t('transactions.reimbursement.amountHint', { amount: money(unitsToNumber(capUnits)) })}
                    keyboardType="decimal-pad"
                    label={t('transactions.reimbursement.amount')}
                    onChangeText={(value) => { setError(null); setAmount(value) }}
                    placeholder="0"
                    value={amount}
                  />
                </FormGroup>
              ) : list.length > 0 ? (
                <Text tone="muted" variant="meta">{t('transactions.reimbursement.chooseFirst')}</Text>
              ) : null}
            </View>
          )}

          {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

/** "Card purchase · Jul 18 · Daily account": the other side's when and where. */
function describeWhere(transaction: LinkedTransactionDto, locale: string): string {
  return [transaction.transactionDate ? formatShortDate(transaction.transactionDate, locale) : null, transaction.accountName]
    .filter(Boolean)
    .join(' · ')
}

function SuggestionLine({ suggestion, checked, disabled, first, locale, onPress }: Readonly<{
  suggestion: ReimbursementSuggestionDto
  checked: boolean
  disabled: boolean
  first: boolean
  locale: string
  onPress: () => void
}>) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { hidden: amountsHidden } = usePrivacyMode()
  const name = linkedTitle(suggestion) ?? t('transactions.unnamed')
  const where = describeWhere(suggestion, locale)
  const total = suggestion.settlementAmount === null ? null : Math.abs(suggestion.settlementAmount)
  const partly = total !== null && amountToUnits(suggestion.remainingAmount) < amountToUnits(total)
  const format = (value: number) => (suggestion.currencyCode ? formatMoneyForDisplay(value, { locale, currency: suggestion.currencyCode }, amountsHidden) : String(value))
  const remainingText = format(suggestion.remainingAmount)
  return (
    <Pressable
      accessibilityLabel={[
        name,
        suggestion.settlementAmount === null ? null : format(suggestion.settlementAmount),
        where,
        suggestion.reason === 'merchant' ? t('transactions.reimbursement.sameMerchant') : null,
        partly ? t('transactions.reimbursement.notYetReimbursed', { amount: remainingText }) : null,
      ].filter(Boolean).join(', ')}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.line,
        !first && { borderTopWidth: 1, borderTopColor: palette.border },
        (pressed || checked) && { backgroundColor: palette.muted },
      ]}
    >
      <View style={styles.flex}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.shrink} variant="metaStrong">{name}</Text>
          {suggestion.reason === 'merchant' ? <Badge label={t('transactions.reimbursement.sameMerchant')} tone="outline" /> : null}
        </View>
        {where ? <Text numberOfLines={1} tone="muted" variant="label">{where}</Text> : null}
        {partly ? <Text tone="muted" variant="label">{t('transactions.reimbursement.notYetReimbursed', { amount: remainingText })}</Text> : null}
      </View>
      <Amount currency={suggestion.currencyCode} locale={locale} size="amount" value={suggestion.settlementAmount} />
      {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
    </Pressable>
  )
}

function LinkLine({ item, other, first, locale, pending, onUnlink }: Readonly<{
  item: ReimbursementLinkDto
  other: LinkedTransactionDto
  first: boolean
  locale: string
  pending: boolean
  onUnlink: () => void
}>) {
  const { t } = useTranslation()
  const palette = usePalette()
  const name = linkedTitle(other) ?? t('transactions.unnamed')
  const where = describeWhere(other, locale)
  return (
    <View style={[styles.line, !first && { borderTopWidth: 1, borderTopColor: palette.border }]} testID={`reimbursement-link-${item.transactionReimbursementKey}`}>
      <View style={styles.flex}>
        <Text numberOfLines={1} variant="metaStrong">{name}</Text>
        {where ? <Text numberOfLines={1} tone="muted" variant="label">{where}</Text> : null}
      </View>
      <Amount currency={item.currencyCode} locale={locale} size="amount" value={item.amount} />
      <Button
        accessibilityLabel={t('transactions.reimbursement.unlinkNamed', { name })}
        disabled={pending}
        label={t('transactions.reimbursement.unlink')}
        onPress={onUnlink}
        size="sm"
        variant="ghost"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  shrink: { flexShrink: 1 },
  content: { padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8], gap: themeTokens.spacing[6], width: '100%', maxWidth: 760, alignSelf: 'center' },
  summary: { gap: themeTokens.spacing[2] },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  section: { gap: themeTokens.spacing[3] },
  group: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  line: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  inline: { gap: themeTokens.spacing[2], alignItems: 'flex-start' },
})
