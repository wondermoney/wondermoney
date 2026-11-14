import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { Failure, Loading } from '@/features/loans/loans-screen'
import { formatShortDate } from '@/features/transactions/transactions-date-range'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  type ExpenseGroupDto,
  type ExpenseGroupMemberDto,
  freezeHouseholdPerson,
  freezePerson,
  type GroupBalancesDto,
  type GroupExpenseDto,
  type GroupSettlementDto,
  MEMBER_NAME_MAX,
} from './expense-groups-contract'
import { balanceStanding, classifyGroupFailure, describePayment, memberName } from './expense-groups-view-model'
import { ExpenseGroupEditSheet } from './expense-group-edit-sheet'
import { RecordSettlementScreen, type SettlementPrefill } from './record-settlement-screen'
import { useAddGroupMember, useDeleteExpenseGroup, useDeleteSettlement, useRemoveGroupMember, useUpdateExpenseGroup } from './use-expense-groups'

export type ExpenseGroupDetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | {
    status: 'loaded'
    group: ExpenseGroupDto
    balances: GroupBalancesDto | null
    balancesFailed: boolean
    expenses: readonly GroupExpenseDto[] | null
    expensesFailed: boolean
    settlements: readonly GroupSettlementDto[] | null
    settlementsFailed: boolean
    refreshing: boolean
  }

type Props = Readonly<{
  state: ExpenseGroupDetailState
  canWrite: boolean
  /** Household members not yet in the group. */
  candidates: readonly Readonly<{ appuserKey: number; name: string }>[]
  /** Currency codes the group's currency can change to (the API's currency list). */
  currencies: readonly string[]
  onBack: () => void
  onDeleted: () => void
  onRefresh: () => void | Promise<void>
}>

/**
 * One group: where everyone stands per currency, in "X owes Y" words, with the payments that
 * would settle it; the people; the shared expenses and the settlements. Writers can record a
 * settlement (from a suggested payment or from scratch), edit the group's name and currency, add
 * and remove people, archive, and delete a group with no history. A viewer sees the same page
 * without any of those.
 */
export function ExpenseGroupDetailScreen({ state, canWrite, candidates, currencies, onBack, onDeleted, onRefresh }: Props) {
  const { t } = useTranslation()
  if (state.status === 'loading') return <Loading label={t('expenseGroups.loading')} />
  if (state.status === 'not-found' || state.status === 'error') {
    return (
      <Failure
        backLabel={t('expenseGroups.backToGroups')}
        fallback="/groups"
        message={t(state.status === 'not-found' ? 'expenseGroups.detail.notFoundMessage' : 'expenseGroups.errorMessage')}
        onBack={onBack}
        onRetry={state.status === 'error' ? onRefresh : undefined}
        title={t(state.status === 'not-found' ? 'expenseGroups.detail.notFoundTitle' : 'expenseGroups.errorTitle')}
      />
    )
  }
  return <LoadedGroup canWrite={canWrite} candidates={candidates} currencies={currencies} onBack={onBack} onDeleted={onDeleted} onRefresh={onRefresh} state={state} />
}

function LoadedGroup({ state, canWrite, candidates, currencies: currencyChoices, onBack, onDeleted, onRefresh }: Omit<Props, 'state'> & Readonly<{ state: Extract<ExpenseGroupDetailState, { status: 'loaded' }> }>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const formatMoney = useFormatMoney()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const { group } = state
  const members = [...group.members].sort((a, b) => a.position - b.position)
  const update = useUpdateExpenseGroup()
  const remove = useDeleteExpenseGroup()
  const addMember = useAddGroupMember()
  const removeMember = useRemoveGroupMember()
  const deleteSettlement = useDeleteSettlement()
  const [settling, setSettling] = useState<{ prefill: SettlementPrefill | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = update.isPending || remove.isPending || addMember.isPending || removeMember.isPending || deleteSettlement.isPending
  const someone = t('expenseGroups.someone')
  const nameOf = (memberKey: number) => {
    const member = members.find((item) => item.expenseGroupMemberKey === memberKey)
    return member?.isYou ? t('expenseGroups.you') : memberName(members, memberKey, someone)
  }
  const money = (value: number, currency: string | null) => (currency ? formatMoney(value, { locale, currency }) : String(value))
  const failure = (caught: unknown) => t(`expenseGroups.errors.${classifyGroupFailure(caught)}`)

  const run = (action: () => Promise<unknown>, onDone?: () => void) => {
    setError(null)
    action().then(() => onDone?.()).catch((caught: unknown) => setError(failure(caught)))
  }
  const setArchived = (archived: boolean) => run(() => update.mutateAsync({ groupId: group.expenseGroupKey, archived }))

  const confirmDelete = () => {
    Alert.alert(t('expenseGroups.detail.deleteTitle', { name: group.name }), t('expenseGroups.detail.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('expenseGroups.detail.delete'),
        style: 'destructive',
        onPress: () => {
          setError(null)
          remove.mutateAsync(group.expenseGroupKey).then(onDeleted).catch((caught: unknown) => {
            // A group with history cannot be deleted; archiving hides it from new expenses instead.
            if (classifyGroupFailure(caught) === 'not-empty') {
              Alert.alert(t('expenseGroups.detail.notEmptyTitle'), t('expenseGroups.detail.notEmptyMessage'), [
                { text: t('common.cancel'), style: 'cancel' },
                ...(group.archived ? [] : [{ text: t('expenseGroups.detail.archive'), onPress: () => setArchived(true) }]),
              ])
              return
            }
            setError(failure(caught))
          })
        },
      },
    ])
  }

  const confirmRemoveMember = (member: ExpenseGroupMemberDto) => {
    Alert.alert(t('expenseGroups.detail.removeTitle', { name: member.name }), t('expenseGroups.detail.removeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('expenseGroups.detail.remove'), style: 'destructive', onPress: () => run(() => removeMember.mutateAsync({ groupId: group.expenseGroupKey, memberId: member.expenseGroupMemberKey })) },
    ])
  }

  const confirmDeleteSettlement = (settlement: GroupSettlementDto) => {
    Alert.alert(t('expenseGroups.detail.deleteSettlementTitle'), t('expenseGroups.detail.deleteSettlementMessage', { from: nameOf(settlement.fromMemberKey), to: nameOf(settlement.toMemberKey), amount: money(settlement.amount, settlement.currencyCode) }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('expenseGroups.detail.deleteSettlement'), style: 'destructive', onPress: () => run(() => deleteSettlement.mutateAsync({ groupId: group.expenseGroupKey, settlementId: settlement.expenseGroupSettlementKey })) },
    ])
  }

  const currencies = state.balances?.currencies.map((entry) => entry.currencyCode) ?? []

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl onRefresh={() => void onRefresh()} refreshing={state.refreshing} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/groups" label={t('expenseGroups.backToGroups')} onPress={onBack} />
            <PageHeader
              description={[group.currencyCode, t('expenseGroups.people', { count: members.length })].join(' · ')}
              title={group.name}
            />
            {group.archived ? <Badge label={t('expenseGroups.archived')} tone="muted" /> : null}
          </View>
          {group.archived ? <Notice message={t('expenseGroups.detail.archivedNotice')} /> : null}
          {canWrite ? (
            <View style={styles.actions}>
              <Button disabled={pending || members.length < 2} icon="hand-coins" label={t('expenseGroups.detail.recordSettlement')} onPress={() => setSettling({ prefill: null })} size="sm" />
              <Button disabled={pending} icon="pencil" label={t('expenseGroups.edit.action')} onPress={() => { setError(null); setEditing(true) }} size="sm" variant="secondary" />
              <Button
                disabled={pending}
                icon="archive"
                label={group.archived ? t('expenseGroups.detail.unarchive') : t('expenseGroups.detail.archive')}
                loading={update.isPending}
                onPress={() => setArchived(!group.archived)}
                size="sm"
                variant="secondary"
              />
            </View>
          ) : null}
          {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}

          <Section title={t('expenseGroups.detail.balances')} variant="open">
            {state.balancesFailed ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.sectionError')}</Text>
            ) : !state.balances ? (
              <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('expenseGroups.loading')}</Text>
            ) : state.balances.currencies.length === 0 ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.noBalances')}</Text>
            ) : (
              <View style={styles.stack}>
                {state.balances.currencies.map((entry) => (
                  <View key={entry.currencyCode} style={styles.stack} testID={`expense-group-balances-${entry.currencyCode}`}>
                    {state.balances!.currencies.length > 1 ? <Text variant="metaStrong">{entry.currencyCode}</Text> : null}
                    <List>
                      {members.map((member, index) => {
                        const balance = entry.members.find((item) => item.memberKey === member.expenseGroupMemberKey)?.balance ?? 0
                        const standing = balanceStanding(balance)
                        const words = standing === 'settled'
                          ? t('expenseGroups.detail.settled')
                          : t(standing === 'owed' ? 'expenseGroups.detail.isOwed' : 'expenseGroups.detail.owes', { amount: money(Math.abs(balance), entry.currencyCode) })
                        return (
                          <ListRow
                            accessibilityLabel={`${nameOf(member.expenseGroupMemberKey)}, ${words}`}
                            key={member.expenseGroupMemberKey}
                            meta={[words]}
                            separated={index > 0}
                            title={nameOf(member.expenseGroupMemberKey)}
                          />
                        )
                      })}
                    </List>
                    <Text accessibilityRole="header" variant="metaStrong">{t('expenseGroups.detail.suggestedPayments')}</Text>
                    {entry.payments.length === 0 ? (
                      <Text tone="muted" variant="meta">{t('expenseGroups.detail.allSettled')}</Text>
                    ) : entry.payments.map((payment) => {
                      const wording = describePayment(payment, members, someone)
                      const sentence = t(`expenseGroups.detail.payment.${wording.kind}`, { from: wording.from, to: wording.to, amount: money(payment.amount, entry.currencyCode) })
                      return (
                        <View key={`${payment.fromMemberKey}-${payment.toMemberKey}`} style={styles.paymentLine}>
                          <Text style={styles.flex} variant="meta">{sentence}</Text>
                          {canWrite ? (
                            <Button
                              accessibilityLabel={t('expenseGroups.detail.recordPayment', { sentence })}
                              disabled={pending}
                              label={t('expenseGroups.detail.record')}
                              onPress={() => setSettling({ prefill: { ...payment, currencyCode: entry.currencyCode } })}
                              size="sm"
                              variant="outline"
                            />
                          ) : null}
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>
            )}
          </Section>

          <Section
            action={canWrite ? <Button disabled={pending} icon="plus" label={t('expenseGroups.addPerson')} onPress={() => setAdding(true)} size="sm" variant="ghost" /> : undefined}
            title={t('expenseGroups.detail.people')}
            variant="open"
          >
            <List>
              {members.map((member, index) => (
                <ListRow
                  figure={canWrite && !member.isYou ? (
                    <Button
                      accessibilityLabel={t('expenseGroups.detail.removeNamed', { name: member.name })}
                      disabled={pending}
                      label={t('expenseGroups.detail.remove')}
                      onPress={() => confirmRemoveMember(member)}
                      size="sm"
                      variant="ghost"
                    />
                  ) : undefined}
                  key={member.expenseGroupMemberKey}
                  meta={[member.isYou ? t('expenseGroups.you') : member.isHouseholdMember ? t('expenseGroups.householdMember') : t('expenseGroups.outsideHousehold'), member.email]}
                  separated={index > 0}
                  title={member.name}
                />
              ))}
            </List>
          </Section>

          <Section title={t('expenseGroups.detail.sharedExpenses')} variant="open">
            {state.expensesFailed ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.sectionError')}</Text>
            ) : !state.expenses ? (
              <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('expenseGroups.loading')}</Text>
            ) : state.expenses.length === 0 ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.noExpenses')}</Text>
            ) : (
              <List>
                {state.expenses.map((expense, index) => {
                  const title = expense.transaction.merchantName?.trim() || expense.transaction.description?.trim() || t('transactions.unnamed')
                  const when = expense.transaction.transactionDate ? formatShortDate(expense.transaction.transactionDate, locale) : null
                  return (
                    <ListRow
                      figure={<Amount currency={expense.currencyCode} locale={locale} size="amount" value={expense.transaction.settlementAmount} />}
                      key={expense.expenseGroupExpenseKey}
                      meta={[[when, t('expenseGroups.detail.paidBy', { name: nameOf(expense.paidByMemberKey) })].filter(Boolean).join(' · ')]}
                      separated={index > 0}
                      title={title}
                    />
                  )
                })}
              </List>
            )}
          </Section>

          <Section title={t('expenseGroups.detail.settlements')} variant="open">
            {state.settlementsFailed ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.sectionError')}</Text>
            ) : !state.settlements ? (
              <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('expenseGroups.loading')}</Text>
            ) : state.settlements.length === 0 ? (
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.noSettlements')}</Text>
            ) : (
              <List>
                {state.settlements.map((settlement, index) => (
                  <ListRow
                    badge={settlement.isLinked ? <Badge label={t('expenseGroups.detail.linked')} tone="outline" /> : undefined}
                    figure={<Amount currency={settlement.currencyCode} locale={locale} size="amount" value={settlement.amount} />}
                    key={settlement.expenseGroupSettlementKey}
                    meta={[formatShortDate(settlement.settledOn, locale), settlement.notes]}
                    separated={index > 0}
                    title={t('expenseGroups.detail.paid', { from: nameOf(settlement.fromMemberKey), to: nameOf(settlement.toMemberKey) })}
                  >
                    {canWrite ? (
                      <Button disabled={pending} label={t('expenseGroups.detail.deleteSettlement')} onPress={() => confirmDeleteSettlement(settlement)} size="sm" style={styles.hug} variant="ghost" />
                    ) : null}
                  </ListRow>
                ))}
              </List>
            )}
          </Section>

          {canWrite ? (
            <View style={styles.danger}>
              <Button disabled={pending} icon="trash" label={t('expenseGroups.detail.delete')} loading={remove.isPending} onPress={confirmDelete} variant="destructive-quiet" />
              <Text tone="muted" variant="meta">{t('expenseGroups.detail.deleteHelper')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {settling ? (
        <RecordSettlementScreen currencies={currencies} group={group} locale={locale} onClose={() => setSettling(null)} prefill={settling.prefill} />
      ) : null}
      {editing ? (
        <ExpenseGroupEditSheet
          currencies={currencyChoices}
          group={group}
          onClose={() => setEditing(false)}
          onSave={(payload) => update.mutateAsync({ groupId: group.expenseGroupKey, ...payload })}
          visible
        />
      ) : null}
      <AddPersonSheet
        candidates={candidates}
        onAdd={(member) => {
          setError(null)
          return addMember.mutateAsync({ groupId: group.expenseGroupKey, member }).then(() => undefined)
        }}
        onClose={() => setAdding(false)}
        visible={adding}
      />
    </SafeAreaView>
  )
}

/** "Add person": someone of the household, as themselves, or anyone else by name. */
function AddPersonSheet({ visible, candidates, onAdd, onClose }: Readonly<{
  visible: boolean
  candidates: readonly Readonly<{ appuserKey: number; name: string }>[]
  onAdd: (member: ReturnType<typeof freezePerson>) => Promise<void>
  onClose: () => void
}>) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => { if (pending) return; setName(''); setEmail(''); setError(null); onClose() }
  const add = async (member: () => ReturnType<typeof freezePerson>) => {
    let payload: ReturnType<typeof freezePerson>
    try {
      payload = member()
    } catch {
      setError(t('expenseGroups.create.emailInvalid'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onAdd(payload)
      setPending(false)
      setName('')
      setEmail('')
      onClose()
    } catch (caught) {
      setPending(false)
      setError(t(`expenseGroups.errors.${classifyGroupFailure(caught)}`))
    }
  }
  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={<Button disabled={pending || name.trim() === ''} label={t('expenseGroups.addPerson')} loading={pending} onPress={() => void add(() => freezePerson({ name, email }))} />}
      onClose={close}
      title={t('expenseGroups.addPerson')}
      visible={visible}
    >
      <View style={styles.stack}>
        {candidates.length > 0 ? (
          <View style={styles.stack}>
            <Text variant="metaStrong">{t('expenseGroups.create.household')}</Text>
            {candidates.map((candidate) => (
              <Button
                disabled={pending}
                icon="plus"
                key={candidate.appuserKey}
                label={candidate.name}
                onPress={() => void add(() => freezeHouseholdPerson(candidate.appuserKey))}
                size="sm"
                style={styles.hug}
                variant="secondary"
              />
            ))}
            <Text variant="metaStrong">{t('expenseGroups.create.people')}</Text>
          </View>
        ) : null}
        <FormGroup>
          <FormTextRow editable={!pending} label={t('expenseGroups.create.personName')} maxLength={MEMBER_NAME_MAX} onChangeText={setName} value={name} />
          <FormTextRow autoCapitalize="none" autoCorrect={false} editable={!pending} keyboardType="email-address" label={t('expenseGroups.create.personEmail')} onChangeText={setEmail} value={email} />
        </FormGroup>
        <Text tone="muted" variant="label">{t('expenseGroups.create.peopleHint')}</Text>
        {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  header: { gap: themeTokens.spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  stack: { gap: themeTokens.spacing[3] },
  paymentLine: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], minHeight: themeTokens.touchTarget.minimum },
  hug: { alignSelf: 'flex-start' },
  danger: { gap: themeTokens.spacing[1] },
})
