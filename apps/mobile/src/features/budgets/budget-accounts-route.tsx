import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { useAccounts } from '@/features/accounts/use-accounts'

import { BudgetAccountsScreen } from './budget-accounts-screen'
import { parseBudgetId } from './budgets-contract'
import { classifyBudgetAccountsWriteFailure, useBudgetAccountsMutation, type BudgetAccountsWriteFailure } from './use-budget-accounts-mutation'
import { useBudgetAccounts } from './use-budget-accounts'

export function BudgetAccountsRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const linked = useBudgetAccounts(budgetId)
  const accounts = useAccounts()
  const mutation = useBudgetAccountsMutation()
  const [failure, setFailure] = useState<BudgetAccountsWriteFailure | null>(null)
  const router = useRouter()
  const navigation = useNavigation()
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (mutation.isPending) event.preventDefault()
  }), [mutation.isPending, navigation])

  const invalid = budgetId === null || linked.isInvalidRoute || linked.isAccessTransition || accounts.isAccessTransition
  const status = invalid || linked.isLoading || accounts.isLoading ? 'loading' : (!linked.data || !accounts.data || linked.isError || accounts.isError) ? 'error' : 'ready'

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
    accounts={(accounts.data?.accounts ?? []).map((account) => ({ id: account.accountKey, name: account.accountName }))}
    linkedIds={linked.data?.accounts.map((account) => account.accountKey) ?? []}
    pending={mutation.isPending}
    failure={failure}
    onBack={() => router.replace('/budgets')}
    onRefresh={async () => { await Promise.all([linked.refetch(), accounts.refetch()]) }}
    onSubmit={submit}
  />
}
