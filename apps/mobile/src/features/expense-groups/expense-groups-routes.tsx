import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccounts } from '@/features/accounts/use-accounts'
import { useLoanCurrencies } from '@/features/loans/use-loan-currencies'

import type { CreateGroupDraft } from './expense-groups-contract'
import { ExpenseGroupCreateScreen } from './expense-group-create-screen'
import { ExpenseGroupDetailScreen, type ExpenseGroupDetailState } from './expense-group-detail-screen'
import { ExpenseGroupsScreen, type ExpenseGroupsViewState } from './expense-groups-screen'
import { classifyGroupFailure } from './expense-groups-view-model'
import { useGroupAccess } from './use-group-access'
import {
  useCreateExpenseGroup,
  useExpenseGroup,
  useExpenseGroups,
  useGroupBalances,
  useGroupExpenses,
  useGroupSettlements,
} from './use-expense-groups'

/** `/groups`: the household's groups. */
export function ExpenseGroupsRoute() {
  const query = useExpenseGroups()
  const { canWrite } = useGroupAccess()
  const router = useRouter()
  let state: ExpenseGroupsViewState
  if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isError ? 'refresh-error' : 'loaded', groups: query.data.groups, refreshing: query.isFetching && !query.isLoading }
  else state = { status: 'error' }
  return (
    <ExpenseGroupsScreen
      canWrite={canWrite}
      onCreateGroup={() => router.push('/groups/create' as Href)}
      onOpenGroup={(groupId) => router.push({ pathname: '/groups/[groupId]', params: { groupId: String(groupId) } } as Href)}
      onRefresh={async () => { await query.refetch() }}
      state={state}
    />
  )
}

/** `/groups/create`: a new group, then its page. */
export function ExpenseGroupCreateRoute() {
  const { t } = useTranslation()
  const router = useRouter()
  const create = useCreateExpenseGroup()
  const currencies = useLoanCurrencies()
  const accounts = useAccounts()
  const { candidates } = useGroupAccess()
  const [error, setError] = useState<string | null>(null)
  const defaultCurrency = accounts.data?.accounts[0]?.accountOwnerAppuserKey?.currencyKey.code ?? null
  const submit = (draft: CreateGroupDraft) => {
    setError(null)
    create.mutateAsync(draft)
      .then(({ group }) => router.replace({ pathname: '/groups/[groupId]', params: { groupId: String(group.expenseGroupKey) } } as Href))
      .catch((caught: unknown) => setError(t(`expenseGroups.errors.${classifyGroupFailure(caught)}`)))
  }
  return (
    <ExpenseGroupCreateScreen
      candidates={candidates}
      currencies={currencies.data?.currencies.map((currency) => currency.code) ?? []}
      defaultCurrency={defaultCurrency}
      error={error}
      onClose={() => router.back()}
      onSubmit={submit}
      pending={create.isPending}
    />
  )
}

const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)

export function parseGroupId(value?: string | string[]): number | null {
  const id = Number(firstParam(value))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** `/groups/[groupId]`: one group's people, balances, shared expenses and settlements. */
export function ExpenseGroupDetailRoute() {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>()
  const groupId = parseGroupId(params.groupId)
  const router = useRouter()
  const group = useExpenseGroup(groupId)
  const balances = useGroupBalances(groupId)
  const expenses = useGroupExpenses(groupId)
  const settlements = useGroupSettlements(groupId)
  const access = useGroupAccess()
  let state: ExpenseGroupDetailState
  if (groupId === null) state = { status: 'not-found' }
  else if (group.isLoading) state = { status: 'loading' }
  else if (group.data) {
    state = {
      status: 'loaded',
      group: group.data.group,
      balances: balances.data ?? null,
      balancesFailed: balances.isError && !balances.data,
      expenses: expenses.data?.expenses ?? null,
      expensesFailed: expenses.isError && !expenses.data,
      settlements: settlements.data?.settlements ?? null,
      settlementsFailed: settlements.isError && !settlements.data,
      refreshing: (group.isFetching || balances.isFetching || expenses.isFetching || settlements.isFetching) && !group.isLoading,
    }
  } else if (group.error && 'status' in group.error && group.error.status === 404) state = { status: 'not-found' }
  else state = { status: 'error' }
  return (
    <ExpenseGroupDetailScreen
      canWrite={access.canWrite}
      candidates={state.status === 'loaded' ? access.candidates.filter((candidate) => !state.group.members.some((member) => member.appuserKey === candidate.appuserKey)) : []}
      onBack={() => router.replace('/groups' as Href)}
      onDeleted={() => router.replace('/groups' as Href)}
      onRefresh={async () => { await Promise.all([group.refetch(), balances.refetch(), expenses.refetch(), settlements.refetch()]) }}
      state={state}
    />
  )
}
