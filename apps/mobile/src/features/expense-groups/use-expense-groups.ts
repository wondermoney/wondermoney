import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { isSplitAffectedQuery } from '@/features/transactions/use-transaction-splits'
import { ApiError } from '@/lib/api/errors'

import {
  createAddGroupMemberEndpoint,
  createDeleteExpenseGroupEndpoint,
  createDeleteSettlementEndpoint,
  createExpenseGroupDetailEndpoint,
  createExpenseGroupEndpoint,
  createGroupBalancesEndpoint,
  createGroupExpenseEndpoint,
  createGroupExpensesEndpoint,
  createGroupSettlementsEndpoint,
  createRecordSettlementEndpoint,
  createRemoveGroupMemberEndpoint,
  createSettlementSuggestionsEndpoint,
  createShareExpenseEndpoint,
  createUnshareExpenseEndpoint,
  createUpdateExpenseGroupEndpoint,
  expenseGroupsEndpoint,
  freezeCreateGroup,
  freezeRecordSettlement,
  freezeShareExpense,
  type CreateGroupDraft,
  type MemberPayload,
  type RecordSettlementDraft,
  type ShareExpensePayload,
} from './expense-groups-contract'
import {
  expenseGroupBalancesKey,
  expenseGroupExpenseKey,
  expenseGroupExpensesKey,
  expenseGroupKey,
  expenseGroupSettlementsKey,
  expenseGroupsListKey,
  expenseGroupsRootKey,
  settlementSuggestionsKey,
} from './query-keys'

const validId = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const readOptions = { retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false } as const

function useRuntime(name: string) {
  const context = useProductRuntime()
  if (!context.runtime) throw new Error(`${name} requires an authenticated runtime`)
  return { runtime: context.runtime, blockAccess: context.blockAccess }
}

/** The household's groups, newest first, with the reader's balance in each. */
export function useExpenseGroups() {
  const { runtime } = useRuntime('useExpenseGroups')
  return useQuery({
    queryKey: expenseGroupsListKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(expenseGroupsEndpoint),
    ...readOptions,
  })
}

export function useExpenseGroup(groupId: number | null) {
  const { runtime } = useRuntime('useExpenseGroup')
  return useQuery({
    queryKey: expenseGroupKey(runtime.epochId, groupId ?? 0),
    queryFn: () => runtime.apiClient.read(createExpenseGroupDetailEndpoint(groupId!)),
    enabled: validId(groupId),
    ...readOptions,
  })
}

export function useGroupBalances(groupId: number | null) {
  const { runtime } = useRuntime('useGroupBalances')
  return useQuery({
    queryKey: expenseGroupBalancesKey(runtime.epochId, groupId ?? 0),
    queryFn: () => runtime.apiClient.read(createGroupBalancesEndpoint(groupId!)),
    enabled: validId(groupId),
    ...readOptions,
  })
}

export function useGroupExpenses(groupId: number | null) {
  const { runtime } = useRuntime('useGroupExpenses')
  return useQuery({
    queryKey: expenseGroupExpensesKey(runtime.epochId, groupId ?? 0),
    queryFn: () => runtime.apiClient.read(createGroupExpensesEndpoint(groupId!)),
    enabled: validId(groupId),
    ...readOptions,
  })
}

/** How one transaction is shared in a group (its payer, method and shares). */
export function useGroupExpense(groupId: number | null, transactionId: number) {
  const { runtime } = useRuntime('useGroupExpense')
  return useQuery({
    queryKey: expenseGroupExpenseKey(runtime.epochId, groupId ?? 0, transactionId),
    queryFn: () => runtime.apiClient.read(createGroupExpenseEndpoint(groupId!, transactionId)),
    enabled: validId(groupId) && validId(transactionId),
    ...readOptions,
  })
}

export function useGroupSettlements(groupId: number | null) {
  const { runtime } = useRuntime('useGroupSettlements')
  return useQuery({
    queryKey: expenseGroupSettlementsKey(runtime.epochId, groupId ?? 0),
    queryFn: () => runtime.apiClient.read(createGroupSettlementsEndpoint(groupId!)),
    enabled: validId(groupId),
    ...readOptions,
  })
}

/** Transactions that could be the money behind a settlement; off until both people are chosen. */
export function useSettlementSuggestions(groupId: number, query: Readonly<{ fromMemberId: number | null; toMemberId: number | null; currencyCode: string; search: string }>, enabled: boolean) {
  const { runtime } = useRuntime('useSettlementSuggestions')
  const ready = enabled && validId(query.fromMemberId) && validId(query.toMemberId) && query.fromMemberId !== query.toMemberId
  return useQuery({
    queryKey: settlementSuggestionsKey(runtime.epochId, groupId, { fromMemberId: query.fromMemberId ?? 0, toMemberId: query.toMemberId ?? 0, currencyCode: query.currencyCode, search: query.search }),
    queryFn: () => runtime.apiClient.read(createSettlementSuggestionsEndpoint(groupId, {
      fromMemberId: query.fromMemberId!,
      toMemberId: query.toMemberId!,
      currencyCode: query.currencyCode,
      search: query.search,
    })),
    enabled: ready,
    ...readOptions,
    placeholderData: (previous) => previous,
  })
}

/**
 * Every group write can move a balance; a share or a linked settlement also changes what the
 * household spent or earned, so the ledger, budgets and reports go stale with it.
 */
export const isExpenseGroupAffectedQuery = (queryKey: QueryKey, epochId: number): boolean => (
  (queryKey[0] === expenseGroupsRootKey(epochId)[0] && queryKey[1] === epochId)
  || isSplitAffectedQuery(queryKey, epochId)
)

/** One mutation shape for every group write: one at a time, then everything it touches refreshes. */
function useGroupWrite<Input, Value>(name: string, run: (runtime: NonNullable<ReturnType<typeof useProductRuntime>['runtime']>, input: Input, commit: () => void) => Promise<Value>) {
  const { runtime, blockAccess } = useRuntime(name)
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (input: Input) => {
      if (inFlight.current) throw new Error('A group change is already pending.')
      inFlight.current = true
      try {
        return await run(runtime, input, () => {
          void queryClient.invalidateQueries({ predicate: (query) => isExpenseGroupAffectedQuery(query.queryKey, runtime.epochId) })
        })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

export function useCreateExpenseGroup() {
  return useGroupWrite('useCreateExpenseGroup', (runtime, draft: CreateGroupDraft, commit) => (
    runtime.apiClient.write(createExpenseGroupEndpoint, { body: freezeCreateGroup(draft), commit })
  ))
}

export function useUpdateExpenseGroup() {
  return useGroupWrite('useUpdateExpenseGroup', (runtime, input: Readonly<{ groupId: number; archived?: boolean; name?: string }>, commit) => {
    const { groupId, ...body } = input
    return runtime.apiClient.write(createUpdateExpenseGroupEndpoint(groupId), { body, commit })
  })
}

export function useDeleteExpenseGroup() {
  return useGroupWrite('useDeleteExpenseGroup', (runtime, groupId: number, commit) => (
    runtime.apiClient.write(createDeleteExpenseGroupEndpoint(groupId), { commit })
  ))
}

export function useAddGroupMember() {
  return useGroupWrite('useAddGroupMember', (runtime, input: Readonly<{ groupId: number; member: MemberPayload }>, commit) => (
    runtime.apiClient.write(createAddGroupMemberEndpoint(input.groupId), { body: input.member, commit })
  ))
}

export function useRemoveGroupMember() {
  return useGroupWrite('useRemoveGroupMember', (runtime, input: Readonly<{ groupId: number; memberId: number }>, commit) => (
    runtime.apiClient.write(createRemoveGroupMemberEndpoint(input.groupId, input.memberId), { commit })
  ))
}

export function useShareExpense() {
  return useGroupWrite('useShareExpense', (runtime, input: Readonly<{ groupId: number; share: ShareExpensePayload }>, commit) => (
    runtime.apiClient.write(createShareExpenseEndpoint(input.groupId), { body: freezeShareExpense(input.share), commit })
  ))
}

export function useUnshareExpense() {
  return useGroupWrite('useUnshareExpense', (runtime, input: Readonly<{ groupId: number; transactionId: number }>, commit) => (
    runtime.apiClient.write(createUnshareExpenseEndpoint(input.groupId, input.transactionId), { commit })
  ))
}

export function useRecordSettlement() {
  return useGroupWrite('useRecordSettlement', (runtime, input: Readonly<{ groupId: number; settlement: RecordSettlementDraft }>, commit) => (
    runtime.apiClient.write(createRecordSettlementEndpoint(input.groupId), { body: freezeRecordSettlement(input.settlement), commit })
  ))
}

export function useDeleteSettlement() {
  return useGroupWrite('useDeleteSettlement', (runtime, input: Readonly<{ groupId: number; settlementId: number }>, commit) => (
    runtime.apiClient.write(createDeleteSettlementEndpoint(input.groupId, input.settlementId), { commit })
  ))
}
