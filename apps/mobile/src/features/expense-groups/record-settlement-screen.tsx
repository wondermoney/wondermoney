import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { DateField, formatIsoDate } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatShortDate } from '@/features/transactions/transactions-date-range'
import { amountToUnits, formatUnitsForInput, unitsToDecimal, unitsToNumber } from '@/features/transactions/transactions-split-view-model'
import { TextField } from '@/features/transactions/form-field'
import { formatMoneyForDisplay } from '@/lib/formatters/money-display'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { type ExpenseGroupDto, SETTLEMENT_NOTES_MAX, type SettlementSuggestionDto } from './expense-groups-contract'
import { canLinkSettlement, classifyGroupFailure, readSettlementAmount } from './expense-groups-view-model'
import { useRecordSettlement, useSettlementSuggestions } from './use-expense-groups'

/** How long typing rests before a transaction search is sent. */
export const SETTLEMENT_SEARCH_DELAY_MS = 300

export type SettlementPrefill = Readonly<{ fromMemberKey: number; toMemberKey: number; amount: number; currencyCode: string }>

export type RecordSettlementScreenProps = Readonly<{
  group: ExpenseGroupDto
  locale: string
  /** A suggested payment to start from. */
  prefill?: SettlementPrefill | null
  /** The currencies the group has balances in; the group's own is always offered. */
  currencies?: readonly string[]
  onClose: () => void
}>

/**
 * "Record settlement": someone paid someone back. From, to, amount, the day and a note; between
 * someone of the household and someone outside it, optionally the transaction that moved the
 * money, which then stops counting as income or spending.
 */
export function RecordSettlementScreen({ group, locale, prefill = null, currencies = [], onClose }: RecordSettlementScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { hidden: amountsHidden } = usePrivacyMode()
  const record = useRecordSettlement()
  const [fromId, setFromId] = useState<number | null>(prefill?.fromMemberKey ?? null)
  const [toId, setToId] = useState<number | null>(prefill?.toMemberKey ?? null)
  const [amount, setAmount] = useState(prefill ? formatUnitsForInput(amountToUnits(prefill.amount), locale) : '')
  const [currencyCode, setCurrencyCode] = useState(prefill?.currencyCode ?? group.currencyCode)
  const [settledOn, setSettledOn] = useState<string | null>(() => formatIsoDate(new Date()))
  const [notes, setNotes] = useState('')
  const [linked, setLinked] = useState<SettlementSuggestionDto | null>(null)
  const [search, setSearch] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const next = search.trim()
    if (next === settledSearch) return undefined
    const timer = setTimeout(() => setSettledSearch(next), SETTLEMENT_SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, settledSearch])

  const members = useMemo(() => [...group.members].sort((a, b) => a.position - b.position), [group.members])
  const linkable = canLinkSettlement(members, fromId, toId)
  const suggestions = useSettlementSuggestions(group.expenseGroupKey, { fromMemberId: fromId, toMemberId: toId, currencyCode, search: settledSearch }, linkable)
  const capUnits = linked ? amountToUnits(linked.remainingAmount) : null
  const read = useMemo(() => readSettlementAmount(amount, locale, capUnits), [amount, capUnits, locale])
  const samePerson = fromId !== null && fromId === toId
  const canSave = fromId !== null && toId !== null && !samePerson && read.units !== null && read.error === null && settledOn !== null && !record.isPending
  const currencyOptions = [...new Set([group.currencyCode, ...currencies, currencyCode])]

  const money = (value: number, code: string | null = currencyCode) => (code ? formatMoneyForDisplay(value, { locale, currency: code }, amountsHidden) : String(value))
  const personOptions = members.map((member) => ({ value: member.expenseGroupMemberKey, label: member.isYou ? t('expenseGroups.youNamed', { name: member.name }) : member.name }))

  // Changing who pays whom or the currency changes which transactions fit.
  const choosePeople = (change: () => void) => { setError(null); setLinked(null); change() }

  const chooseLinked = (suggestion: SettlementSuggestionDto) => {
    setError(null)
    if (linked?.transactionKey === suggestion.transactionKey) { setLinked(null); return }
    setLinked(suggestion)
    const remaining = amountToUnits(suggestion.remainingAmount)
    if (read.units === null || read.units > remaining) setAmount(formatUnitsForInput(remaining, locale))
  }

  const save = async () => {
    if (!canSave || fromId === null || toId === null || read.units === null || settledOn === null) return
    setError(null)
    try {
      await record.mutateAsync({
        groupId: group.expenseGroupKey,
        settlement: {
          fromMemberId: fromId,
          toMemberId: toId,
          amount: unitsToDecimal(read.units),
          settledOn,
          currencyCode,
          notes,
          transactionId: linkable && linked ? linked.transactionKey : null,
        },
      })
      onClose()
    } catch (caught) {
      setError(t(`expenseGroups.errors.${classifyGroupFailure(caught)}`))
    }
  }

  const amountError = read.error === 'over' && capUnits !== null
    ? t('expenseGroups.settlement.amountErrors.over', { amount: money(unitsToNumber(capUnits)) })
    : read.error ? t(`expenseGroups.settlement.amountErrors.${read.error}`) : null
  const list = suggestions.data?.suggestions ?? []

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar
          closeDisabled={record.isPending}
          closeLabel={t('expenseGroups.settlement.close')}
          onClose={onClose}
          onSave={() => void save()}
          saveDisabled={!canSave}
          saveLabel={t('expenseGroups.settlement.save')}
          saving={record.isPending}
          testID="record-settlement"
          title={t('expenseGroups.settlement.title')}
        />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text tone="muted" variant="meta">{group.name}</Text>
          <FormGroup>
            <FormSelectRow
              disabled={record.isPending}
              label={t('expenseGroups.settlement.from')}
              onChange={(value) => choosePeople(() => setFromId(value))}
              options={personOptions}
              placeholder={t('expenseGroups.settlement.choose')}
              value={fromId}
            />
            <FormSelectRow
              disabled={record.isPending}
              error={samePerson ? t('expenseGroups.settlement.samePerson') : null}
              label={t('expenseGroups.settlement.to')}
              onChange={(value) => choosePeople(() => setToId(value))}
              options={personOptions}
              placeholder={t('expenseGroups.settlement.choose')}
              value={toId}
            />
            <FormTextRow
              accessibilityLabel={t('expenseGroups.settlement.amountIn', { currency: currencyCode })}
              editable={!record.isPending}
              error={amountError}
              keyboardType="decimal-pad"
              label={t('expenseGroups.settlement.amount')}
              onChangeText={(value) => { setError(null); setAmount(value) }}
              placeholder="0"
              value={amount}
            />
            {currencyOptions.length > 1 ? (
              <FormSelectRow
                disabled={record.isPending}
                label={t('expenseGroups.settlement.currency')}
                onChange={(value) => choosePeople(() => setCurrencyCode(value))}
                options={currencyOptions.map((code) => ({ value: code, label: code }))}
                placeholder={t('expenseGroups.settlement.choose')}
                value={currencyCode}
              />
            ) : null}
            <DateField
              appearance="row"
              disabled={record.isPending}
              label={t('expenseGroups.settlement.date')}
              onChange={setSettledOn}
              value={settledOn}
            />
            <FormTextRow
              editable={!record.isPending}
              label={t('expenseGroups.settlement.notes')}
              maxLength={SETTLEMENT_NOTES_MAX}
              multiline
              onChangeText={setNotes}
              placeholder={t('expenseGroups.settlement.notesPlaceholder')}
              value={notes}
            />
          </FormGroup>
          {currencyOptions.length === 1 ? <Text tone="muted" variant="label">{t('expenseGroups.settlement.currencyHint', { currency: currencyCode })}</Text> : null}

          {linkable ? (
            <View style={styles.section} testID="record-settlement-link">
              <Text accessibilityRole="header" variant="metaStrong">{t('expenseGroups.settlement.linkTitle')}</Text>
              <Text tone="muted" variant="meta">{t('expenseGroups.settlement.linkHint')}</Text>
              <TextField
                autoCapitalize="none"
                autoCorrect={false}
                editable={!record.isPending}
                label={t('expenseGroups.settlement.searchLabel')}
                onChangeText={setSearch}
                placeholder={t('expenseGroups.settlement.searchPlaceholder')}
                returnKeyType="search"
                value={search}
              />
              {suggestions.isLoading ? (
                <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('expenseGroups.settlement.loading')}</Text>
              ) : suggestions.isError && list.length === 0 ? (
                <View accessibilityRole="alert" style={styles.inline}>
                  <Text tone="muted" variant="meta">{t('expenseGroups.settlement.loadError')}</Text>
                  <Button label={t('common.retry')} onPress={() => void suggestions.refetch()} size="sm" variant="outline" />
                </View>
              ) : list.length === 0 ? (
                <Text tone="muted" variant="meta">{t('expenseGroups.settlement.empty')}</Text>
              ) : (
                <View accessibilityRole="radiogroup" style={[styles.group, { borderColor: palette.border }]}>
                  {list.map((suggestion, index) => {
                    const checked = linked?.transactionKey === suggestion.transactionKey
                    const name = suggestion.merchantName?.trim() || suggestion.description?.trim() || t('transactions.unnamed')
                    const where = [suggestion.transactionDate ? formatShortDate(suggestion.transactionDate, locale) : null, suggestion.accountName].filter(Boolean).join(' · ')
                    const left = t('expenseGroups.settlement.left', { amount: money(suggestion.remainingAmount, suggestion.currencyCode) })
                    return (
                      <Pressable
                        accessibilityLabel={[name, suggestion.settlementAmount === null ? null : money(suggestion.settlementAmount, suggestion.currencyCode), where, left].filter(Boolean).join(', ')}
                        accessibilityRole="radio"
                        accessibilityState={{ checked, disabled: record.isPending }}
                        disabled={record.isPending}
                        key={suggestion.transactionKey}
                        onPress={() => chooseLinked(suggestion)}
                        style={({ pressed }) => [styles.line, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, (pressed || checked) && { backgroundColor: palette.muted }]}
                      >
                        <View style={styles.flex}>
                          <Text numberOfLines={1} variant="metaStrong">{name}</Text>
                          {where ? <Text numberOfLines={1} tone="muted" variant="label">{where}</Text> : null}
                          <Text tone="muted" variant="label">{left}</Text>
                        </View>
                        <Amount currency={suggestion.currencyCode} locale={locale} size="amount" value={suggestion.settlementAmount} />
                        {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
              )}
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  content: { padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8], gap: themeTokens.spacing[4], width: '100%', maxWidth: 760, alignSelf: 'center' },
  section: { gap: themeTokens.spacing[3] },
  group: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  line: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  inline: { gap: themeTokens.spacing[2], alignItems: 'flex-start' },
})
