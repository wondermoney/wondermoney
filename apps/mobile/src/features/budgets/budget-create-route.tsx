import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from 'react-native'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { themeTokens } from '@/theme/tokens'

import { BudgetCreateScreen } from './budget-create-screen'
import { BudgetFailure, BudgetLoading } from './budgets-screen'
import { newBudgetCandidates } from './budget-create-model'
import { budgetInventoryEndpoint, budgetsEndpoint, createBudgetDetailEndpoint, createBudgetMonthEndpoint, type BudgetCreateWrite } from './budgets-contract'
import { budgetDetailKey, budgetInventoryKey, budgetMonthKey, budgetsKey } from './query-keys'
import { classifyCreateBudgetFailure, useCreateBudget, type CreateBudgetFailure } from './use-create-budget'
import { useBudgetInventory } from './use-budget-inventory'

export function BudgetCreateRoute() {
  const mutation = useCreateBudget()
  const inventory = useBudgetInventory()
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('BudgetCreateRoute requires an authenticated runtime')
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const router = useRouter()
  const navigation = useNavigation()
  const [failure, setFailure] = useState<CreateBudgetFailure | null>(null)
  const submissionGate = useRef(false)
  const [generation, setGeneration] = useState(0)
  const [candidates, setCandidates] = useState<readonly { id: number; name: string }[] | null>(null)
  const [reconciliationFailed, setReconciliationFailed] = useState(false)
  useEffect(() => navigation.addListener('beforeRemove', (event) => { if (mutation.isPending) event.preventDefault() }), [mutation.isPending, navigation])

  const submit = async (payload: BudgetCreateWrite) => {
    if (submissionGate.current || mutation.isPending || failure === 'unknown' || candidates !== null || reconciliationFailed) return
    submissionGate.current = true
    setFailure(null)
    const before = new Set((inventory.data?.budgets ?? []).map((budget) => budget.budgetKey))
    try {
      const response = await mutation.mutateAsync(payload)
      const [fullResult] = await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: budgetsKey(runtime.epochId), queryFn: () => runtime.apiClient.read(budgetsEndpoint), staleTime: 0 }),
        queryClient.fetchQuery({ queryKey: budgetDetailKey(runtime.epochId, response.budgetKey), queryFn: () => runtime.apiClient.read(createBudgetDetailEndpoint(response.budgetKey)), staleTime: 0 }),
      ])
      const period = fullResult.status === 'fulfilled' ? fullResult.value.budgets.find((budget) => budget.budgetKey === response.budgetKey) : undefined
      if (!period) { router.replace('/budgets'); return }
      const monthResult = await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: budgetMonthKey(runtime.epochId, response.budgetKey, period.year, period.month), queryFn: () => runtime.apiClient.read(createBudgetMonthEndpoint(response.budgetKey, period.year, period.month)), staleTime: 0 }),
      ])
      if (monthResult[0].status === 'fulfilled') router.replace({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(response.budgetKey), year: String(period.year), month: String(period.month) } })
      else router.replace('/budgets')
    } catch (error) {
      const kind = classifyCreateBudgetFailure(error)
      setFailure(kind)
      if (kind !== 'unknown') { submissionGate.current = false; return }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: budgetInventoryKey(runtime.epochId) }),
        queryClient.invalidateQueries({ queryKey: budgetsKey(runtime.epochId) }),
      ])
      const [inventoryResult, fullResult] = await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: budgetInventoryKey(runtime.epochId), queryFn: () => runtime.apiClient.read(budgetInventoryEndpoint), staleTime: 0 }),
        queryClient.fetchQuery({ queryKey: budgetsKey(runtime.epochId), queryFn: () => runtime.apiClient.read(budgetsEndpoint), staleTime: 0 }),
      ])
      if (inventoryResult.status === 'rejected' || fullResult.status === 'rejected') setReconciliationFailed(true)
      else setCandidates(newBudgetCandidates(inventoryResult.value, before))
    }
  }
  if (inventory.isLoading) return <BudgetLoading label={t('budgetCreate.inventoryLoading')} palette={palette} />
  if (!inventory.data && inventory.isError) return <BudgetFailure title={t('budgetCreate.inventoryErrorTitle')} message={t('budgetCreate.inventoryErrorMessage')} onRetry={async () => { await inventory.refetch() }} onBack={() => router.replace('/budgets')} palette={palette} />
  return <BudgetCreateScreen key={generation} pending={mutation.isPending} failure={failure} candidates={candidates} reconciliationFailed={reconciliationFailed} onBack={() => router.replace('/budgets')} onSubmit={submit} onCreateAnother={() => { submissionGate.current = false; setFailure(null); setCandidates(null); setReconciliationFailed(false); setGeneration((value) => value + 1) }} />
}
