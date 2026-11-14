import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'
import { splitTotalUnits, unitsToNumber } from '@/features/transactions/transactions-split-view-model'
import type { TransactionViewModel } from '@/features/transactions/transactions-view-model'
import { formatMoneyForDisplay } from '@/lib/formatters/money-display'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { type ExpenseGroupDto, SPLIT_METHODS, type SplitMethod } from './expense-groups-contract'
import {
  classifyGroupFailure,
  draftFromExpense,
  groupShareOf,
  payerOptions,
  percentToDecimal,
  previewShares,
  type ShareDraft,
  startShareDraft,
  toShareLines,
} from './expense-groups-view-model'
import { useExpenseGroups, useGroupExpense, useShareExpense, useUnshareExpense } from './use-expense-groups'

export type SplitWithGroupScreenProps = Readonly<{
  transaction: TransactionViewModel
  locale: string
  /** False for a household viewer: the shares show, nothing can be changed. */
  canWrite: boolean
  onClose: () => void
}>

/**
 * "Split with group", full screen from a transaction's detail: the group, who paid (someone of the
 * household), how it is shared (equally, by amount or by percentage) and between whom, with what
 * is left to assign worked out live by the API's own rules. A transaction already shared shows its
 * current shares first; the form edits them, and "Stop sharing" at the bottom makes it whole
 * again. A household viewer sees the shares only.
 */
export function SplitWithGroupScreen({ transaction, locale, canWrite, onClose }: SplitWithGroupScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { hidden: amountsHidden } = usePrivacyMode()
  const shared = groupShareOf(transaction)
  const groups = useExpenseGroups()
  const share = useShareExpense()
  const unshare = useUnshareExpense()
  // The group someone picked; until then a shared transaction's own, or the only one on offer.
  const [chosenGroupId, setChosenGroupId] = useState<number | null>(null)
  const existing = useGroupExpense(shared?.expenseGroupKey ?? null, transaction.id)
  const editing = canWrite
  // What the person changed; until then the draft is the existing share's, or the group's default.
  const [editedDraft, setEditedDraft] = useState<ShareDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allGroups = groups.data?.groups ?? []
  // A shared transaction stays in its group; a new share is offered only groups still in use.
  const choices = shared ? allGroups.filter((group) => group.expenseGroupKey === shared.expenseGroupKey) : allGroups.filter((group) => !group.archived)
  const groupId = shared?.expenseGroupKey ?? chosenGroupId ?? (choices.length === 1 ? choices[0]!.expenseGroupKey : null)
  const group: ExpenseGroupDto | null = allGroups.find((item) => item.expenseGroupKey === groupId) ?? null
  const startingDraft = shared
    ? (existing.data ? draftFromExpense(existing.data.expense, locale) : null)
    : (group ? startShareDraft(group) : null)
  const draft = editedDraft ?? startingDraft

  const total = splitTotalUnits(transaction)
  const currency = transaction.settlementCurrency
  const ordered = [...(group?.members ?? [])].sort((a, b) => a.position - b.position)
  const lines = draft
    ? ordered.filter((member) => draft.memberIds.includes(member.expenseGroupMemberKey)).map((member) => ({ memberId: member.expenseGroupMemberKey, value: draft.values[member.expenseGroupMemberKey] ?? '' }))
    : []
  const preview = draft ? previewShares(draft.method, total, lines, locale) : null
  const pending = share.isPending || unshare.isPending
  const canSave = editing && canWrite && group !== null && draft !== null && draft.paidByMemberId !== null && preview !== null && preview.problem === null && !pending

  const money = (units: bigint) => (currency ? formatMoneyForDisplay(unitsToNumber(units), { locale, currency }, amountsHidden) : unitsToDecimalText(units))
  const failure = (caught: unknown) => t(`expenseGroups.errors.${classifyGroupFailure(caught)}`)

  const chooseGroup = (next: number) => {
    setError(null)
    setChosenGroupId(next)
    // Another group has other people: start over from its default.
    setEditedDraft(null)
  }
  const update = (change: Partial<ShareDraft>) => {
    if (!draft) return
    setError(null)
    setEditedDraft({ ...draft, ...change })
  }
  const toggle = (memberId: number, included: boolean) => {
    if (!draft) return
    const memberIds = included ? [...draft.memberIds, memberId] : draft.memberIds.filter((id) => id !== memberId)
    update({ memberIds })
  }

  const save = async () => {
    if (!canSave || !group || !draft || !preview || draft.paidByMemberId === null) return
    setError(null)
    try {
      await share.mutateAsync({
        groupId: group.expenseGroupKey,
        share: { transactionId: transaction.id, paidByMemberId: draft.paidByMemberId, method: draft.method, shares: toShareLines(draft.method, lines, preview) },
      })
      onClose()
    } catch (caught) {
      setError(failure(caught))
    }
  }

  const confirmStop = () => {
    if (!shared) return
    Alert.alert(t('expenseGroups.split.stopTitle'), t('expenseGroups.split.stopMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('expenseGroups.split.stopSharing'),
        style: 'destructive',
        onPress: () => {
          setError(null)
          unshare.mutateAsync({ groupId: shared.expenseGroupKey, transactionId: transaction.id })
            .then(onClose)
            .catch((caught: unknown) => setError(failure(caught)))
        },
      },
    ])
  }

  const remainingCopy = (() => {
    if (!preview || !draft || draft.method === 'equal') return null
    // Nothing typed yet: the whole amount is plainly unassigned, no need to say so.
    if (preview.lines.every((line) => line.units === null && line.percent === null)) return null
    if (draft.method === 'amounts') {
      if (preview.remaining === 0n) return t('expenseGroups.split.balanced')
      return preview.remaining > 0n
        ? t('expenseGroups.split.remaining', { amount: money(preview.remaining) })
        : t('expenseGroups.split.over', { amount: money(-preview.remaining) })
    }
    if (preview.remaining === 0n) return t('expenseGroups.split.balanced')
    return preview.remaining > 0n
      ? t('expenseGroups.split.remainingPercent', { percent: percentToDecimal(preview.remaining) })
      : t('expenseGroups.split.overPercent', { percent: percentToDecimal(-preview.remaining) })
  })()
  const problemCopy = preview?.problem === 'no-people' || preview?.problem === 'zero-share' || preview?.problem === 'no-amount'
    ? t(`expenseGroups.split.problems.${preview.problem}`)
    : null

  const payers = payerOptions(ordered)
  const methodLabels: Record<SplitMethod, string> = {
    equal: t('expenseGroups.split.methods.equal'),
    amounts: t('expenseGroups.split.methods.amounts'),
    percentages: t('expenseGroups.split.methods.percentages'),
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar
          closeDisabled={pending}
          closeLabel={t('expenseGroups.split.close')}
          onClose={onClose}
          onSave={editing && canWrite ? () => void save() : undefined}
          saveDisabled={!canSave}
          saveLabel={t('expenseGroups.split.save')}
          saving={share.isPending}
          testID="split-with-group"
          title={t('expenseGroups.split.title')}
        />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.summary}>
            <Text numberOfLines={2} variant="bodyStrong">{transaction.title ?? t('transactions.unnamed')}</Text>
            <Amount currency={currency} locale={locale} size="amountLarge" value={total === null ? null : unitsToNumber(total)} />
          </View>

          {shared ? (
            <View style={styles.section} testID="split-with-group-current">
              <Text accessibilityRole="header" variant="metaStrong">{t('expenseGroups.split.current')}</Text>
              <View style={[styles.group, { borderColor: palette.border }]}>
                {shared.shares.map((line, index) => (
                  <View key={line.memberKey} style={[styles.line, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}>
                    <View style={styles.flex}>
                      <Text variant="meta">{line.name}</Text>
                      {!line.isHouseholdMember ? <Text tone="muted" variant="label">{t('expenseGroups.outsideHousehold')}</Text> : null}
                    </View>
                    <Amount currency={currency} locale={locale} size="amount" value={line.amount} />
                  </View>
                ))}
              </View>
              {existing.data && group ? (
                <Text tone="muted" variant="meta">
                  {t('expenseGroups.split.paidByInGroup', { name: ordered.find((member) => member.expenseGroupMemberKey === existing.data.expense.paidByMemberKey)?.name ?? t('expenseGroups.someone'), group: group.name })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {editing ? (
            groups.isLoading ? (
              <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('expenseGroups.loading')}</Text>
            ) : groups.isError && !groups.data ? (
              <View accessibilityRole="alert" style={styles.inline}>
                <Text tone="muted" variant="meta">{t('expenseGroups.split.groupsError')}</Text>
                <Button label={t('common.retry')} onPress={() => void groups.refetch()} size="sm" variant="outline" />
              </View>
            ) : choices.length === 0 ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.split.noGroups')}</Text>
            ) : (
              <>
                <FormGroup>
                  <FormSelectRow
                    disabled={pending || shared !== null}
                    label={t('expenseGroups.split.group')}
                    onChange={chooseGroup}
                    options={choices.map((item) => ({ value: item.expenseGroupKey, label: item.name }))}
                    placeholder={t('expenseGroups.split.choose')}
                    value={groupId}
                  />
                  {group && draft ? (
                    <FormSelectRow
                      disabled={pending}
                      label={t('expenseGroups.split.paidBy')}
                      onChange={(value) => update({ paidByMemberId: value })}
                      options={payers.map((member) => ({ value: member.expenseGroupMemberKey, label: member.isYou ? t('expenseGroups.youNamed', { name: member.name }) : member.name }))}
                      placeholder={t('expenseGroups.split.choose')}
                      value={draft.paidByMemberId}
                    />
                  ) : null}
                </FormGroup>

                {group && draft && preview ? (
                  <View style={styles.section}>
                    <SegmentedControl
                      accessibilityLabel={t('expenseGroups.split.method')}
                      fill
                      onChange={(method) => update({ method })}
                      options={SPLIT_METHODS.map((method) => ({ value: method, label: methodLabels[method] }))}
                      value={draft.method}
                    />
                    <FormGroup testID="split-with-group-people">
                      {ordered.map((member, index) => {
                        const included = draft.memberIds.includes(member.expenseGroupMemberKey)
                        const lineIndex = lines.findIndex((line) => line.memberId === member.expenseGroupMemberKey)
                        const result = lineIndex >= 0 ? preview.lines[lineIndex] : undefined
                        const name = member.isYou ? t('expenseGroups.youNamed', { name: member.name }) : member.name
                        const shareText = result?.units != null && (draft.method !== 'amounts') ? money(result.units) : null
                        return (
                          <View key={member.expenseGroupMemberKey}>
                            <FormSwitchRow
                              accessibilityLabel={t('expenseGroups.split.include', { name: member.name })}
                              disabled={pending}
                              hint={[member.isHouseholdMember ? null : t('expenseGroups.outsideHousehold'), included ? shareText : null].filter(Boolean).join(' · ') || undefined}
                              label={name}
                              onValueChange={(value) => toggle(member.expenseGroupMemberKey, value)}
                              testID={`split-with-group-include-${index}`}
                              value={included}
                            />
                            {included && draft.method !== 'equal' ? (
                              <FormTextRow
                                accessibilityLabel={t(draft.method === 'amounts' ? 'expenseGroups.split.amountOf' : 'expenseGroups.split.percentOf', { name: member.name })}
                                editable={!pending}
                                error={result?.error ? t(`expenseGroups.split.lineErrors.${result.error}`) : null}
                                keyboardType="decimal-pad"
                                label={draft.method === 'amounts' ? t('expenseGroups.split.amount') : t('expenseGroups.split.percent')}
                                onChangeText={(value) => update({ values: { ...draft.values, [member.expenseGroupMemberKey]: value } })}
                                placeholder="0"
                                value={draft.values[member.expenseGroupMemberKey] ?? ''}
                              />
                            ) : null}
                          </View>
                        )
                      })}
                    </FormGroup>
                    {remainingCopy ? (
                      <Text accessibilityLiveRegion="polite" testID="split-with-group-remaining" tone={preview.remaining === 0n ? 'muted' : 'warning'} variant="meta">{remainingCopy}</Text>
                    ) : null}
                    {problemCopy ? <Text accessibilityRole="alert" tone="warning" variant="meta">{problemCopy}</Text> : null}
                    {ordered.some((member) => !member.isHouseholdMember && draft.memberIds.includes(member.expenseGroupMemberKey)) ? (
                      <Text tone="muted" variant="label">{t('expenseGroups.split.outsiderHint')}</Text>
                    ) : null}
                    {shared && canWrite ? (
                      <View style={styles.danger}>
                        <Button disabled={pending} icon="x" label={t('expenseGroups.split.stopSharing')} loading={unshare.isPending} onPress={confirmStop} variant="destructive-quiet" />
                        <Text tone="muted" variant="meta">{t('expenseGroups.split.stopSharingHelper')}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )
          ) : null}

          {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function unitsToDecimalText(units: bigint): string {
  return String(unitsToNumber(units))
}


const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  content: { padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8], gap: themeTokens.spacing[6], width: '100%', maxWidth: 760, alignSelf: 'center' },
  summary: { gap: themeTokens.spacing[2] },
  section: { gap: themeTokens.spacing[3] },
  group: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  line: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  inline: { gap: themeTokens.spacing[2], alignItems: 'flex-start' },
  danger: { marginTop: themeTokens.spacing[6], gap: themeTokens.spacing[1] },
})
