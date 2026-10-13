import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCategories } from '@/features/categories/use-categories'
import { mapCategories } from '@/features/categories/categories-view-model'

import { BudgetAddCategoryScreen, type Reconciliation } from './budget-add-category-screen'
import { availableLeafCategories } from './budget-category-options'
import { parseBudgetId, type BudgetAddCategoryWrite } from './budgets-contract'
import { classifyAddBudgetCategoryFailure, useAddBudgetCategory, type AddBudgetCategoryFailure } from './use-add-budget-category'
import { useBudgetMonth } from './use-budget-month'
import { useBudgets } from './use-budgets'

export function BudgetAddCategoryRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const roots = useBudgets()
  const serverPeriod = roots.data?.budgets.find((item) => item.budgetKey === budgetId)
  const year = serverPeriod?.year ?? null
  const month = serverPeriod?.month ?? null
  const budget = useBudgetMonth(budgetId, year, month)
  const categories = useCategories()
  const mutation = useAddBudgetCategory()
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const navigation = useNavigation()
  const [failure, setFailure] = useState<AddBudgetCategoryFailure | null>(null)
  const [reconciliation, setReconciliation] = useState<Reconciliation>(null)
  const submissionGate = useRef(false)
  useEffect(() => navigation.addListener('beforeRemove', (event) => { if (mutation.isPending) event.preventDefault() }), [mutation.isPending, navigation])
  const represented = new Set(budget.data?.budget.categories.map((row) => row.category_key) ?? [])
  const tree = categories.data ? mapCategories(categories.data, t, i18n.resolvedLanguage ?? i18n.language ?? 'en') : []
  const leaves = availableLeafCategories(tree, represented)
  const refreshAndFind = async (categoryKey: number): Promise<boolean | null> => {
    const result = await budget.refetch()
    if (result.isError || !result.data) return null
    return result.data.budget.categories.some((row) => row.category_key === categoryKey)
  }
  const submit = async (value: BudgetAddCategoryWrite) => {
    if (budgetId === null || submissionGate.current || mutation.isPending || failure === 'unknown' || failure === 'duplicate' || reconciliation !== null) return
    submissionGate.current = true
    setFailure(null)
    try {
      await mutation.mutateAsync({ budgetId, value })
      await budget.refetch()
      if (year !== null && month !== null) router.replace({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(budgetId), year: String(year), month: String(month) } })
    } catch (error) {
      const kind = classifyAddBudgetCategoryFailure(error)
      setFailure(kind)
      if (kind !== 'unknown' && kind !== 'duplicate') { submissionGate.current = false; return }
      const present = await refreshAndFind(value.categoryKey)
      if (kind === 'duplicate') setReconciliation(present === true ? 'committed' : 'duplicate-unknown')
      else setReconciliation(present === null ? 'refresh-failed' : present ? 'committed' : 'absent')
    }
  }
  const invalid = budgetId === null || budget.isNotFound || budget.isAccessTransition || categories.isAccessTransition || roots.isAccessTransition
  const status = invalid || roots.isLoading || budget.isLoading || categories.isLoading || year === null || month === null ? 'loading' : (!roots.data || !budget.data || !categories.data || roots.isError || budget.isError || categories.isError) ? 'error' : 'ready'
  return <BudgetAddCategoryScreen status={status} categories={leaves} currency={budget.data?.budget.currencyCode ?? 'EUR'} year={year ?? new Date().getFullYear()} pending={mutation.isPending} failure={failure} reconciliation={reconciliation} onBack={() => budgetId === null || year === null || month === null ? router.replace('/budgets') : router.replace({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(budgetId), year: String(year), month: String(month) } })} onRefresh={async () => { await Promise.all([roots.refetch(), budget.refetch(), categories.refetch()]) }} onSubmit={submit} onNewAttempt={() => { if (reconciliation !== 'absent') return; submissionGate.current = false; setFailure(null); setReconciliation(null) }} />
}
