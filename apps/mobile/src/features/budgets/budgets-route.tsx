import { useRouter } from 'expo-router'
import { useState } from 'react'

import { effectiveMemberFilter, memberKeysParam, type MemberFilter } from '@/features/household/member-attribution'
import { useHouseholdMembers } from '@/features/household/use-household-members'
import { ApiError } from '@/lib/api/errors'

import { BudgetsScreen, type BudgetsViewState } from './budgets-screen'
import { mapBudgets } from './budgets-view-model'
import { useBudgets } from './use-budgets'

export function BudgetsRoute() {
  // The member filter (households of more than one) narrows what each budget counts, never which
  // budgets are listed: the API keeps a personal budget its owner's whoever they filter by (#89).
  const members = useHouseholdMembers()
  const [memberChoice, setMemberChoice] = useState<MemberFilter>(null)
  const memberFilter = effectiveMemberFilter(memberChoice, members)
  const query = useBudgets(memberKeysParam(memberFilter))
  const router = useRouter()
  let state: BudgetsViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = {
      status: query.isRefreshFailure ? 'refresh-error' : 'loaded',
      budgets: mapBudgets(query.data),
      refreshing: query.isRefreshing,
    }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return <BudgetsScreen state={state} memberFilter={members.multiMember ? { model: members, value: memberFilter, onChange: setMemberChoice } : undefined} onBack={() => router.replace('/more')} onCreateBudget={() => router.push('/budgets/create')} onRefresh={async () => { await query.refetch() }} onEditBudget={(budgetId) => router.push({ pathname: '/budgets/[budgetId]/edit', params: { budgetId: String(budgetId) } })} onOpenBudget={(budgetId, year, month) => router.push({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(budgetId), year: String(year), month: String(month) } })} />
}
