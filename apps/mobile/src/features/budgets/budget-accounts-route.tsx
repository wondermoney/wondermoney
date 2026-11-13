import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'

import { useAccounts } from '@/features/accounts/use-accounts'

import { BudgetAccountsScreen } from './budget-accounts-screen'
import { parseBudgetId } from './budgets-contract'
import { linkableBudgetAccounts } from './budgets-view-model'
import { classifyBudgetAccountsWriteFailure, useBudgetAccountsMutation, type BudgetAccountsWriteFailure } from './use-budget-accounts-mutation'
import { useBudgetAccounts } from './use-budget-accounts'
import { useBudgetDetail } from './use-budget-detail'

export function BudgetAccountsRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const linked = useBudgetAccounts(budgetId)
  const detail = useBudgetDetail(budgetId)
  const accounts = useAccounts()
  const mutation = useBudgetAccountsMutation()
  const [failure, setFailure] = useState<BudgetAccountsWriteFailure | null>(null)
  const router = useRouter()
  usePreventRemove(mutation.isPending)

  const invalid = budgetId === null || linked.isInvalidRoute || linked.isAccessTransition || detail.isAccessTransition || accounts.isAccessTransition
  const status = invalid || linked.isLoading || detail.isLoading || accounts.isLoading ? 'loading' : (!linked.data || !detail.data || !accounts.data || linked.isError || detail.isError || accounts.isError) ? 'error' : 'ready'

  // A household budget can't link a private account (the API refuses it); a personal one can.
  const visible = accounts.data?.accounts ?? []
  const offered = linkableBudgetAccounts(visible, detail.data?.budget.visibility ?? 'household')
  const offeredIds = new Set(offered.map((account) => account.accountKey))
  const leftOut = new Set(visible.filter((account) => !offeredIds.has(account.accountKey)).map((account) => account.accountKey))

  const submit = async (accountKeys: readonly number[]) => {
    if (budgetId === null) return
    setFailure(null)
    try {
      await mutation.mutateAsync({ budgetId, value: { accountKeys: [...accountKeys] } })
      router.replace('/budgets')
    } catch (error) {
      setFailure(classifyBudgetAccountsWriteFailure(error))
    }
  }

  return <BudgetAccountsScreen
    status={status}
    accounts={offered.map((account) => ({ id: account.accountKey, name: account.accountName }))}
    // A private account an older household budget still links is not resubmitted: saving would fail.
    linkedIds={linked.data?.accounts.map((account) => account.accountKey).filter((id) => !leftOut.has(id)) ?? []}
    privateAccountsHidden={leftOut.size > 0}
    pending={mutation.isPending}
    failure={failure}
    onBack={() => router.replace('/budgets')}
    onRefresh={async () => { await Promise.all([linked.refetch(), accounts.refetch()]) }}
    onSubmit={submit}
  />
}
