import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { parseAccountId } from '@/features/accounts/accounts-contract'

import { InstallmentPlanDetailScreen, type InstallmentPlanDetailViewState } from './installment-plan-detail-screen'
import { parseInstallmentPlanId } from './installments-contract'
import { classifyInstallmentWriteFailure, useDeleteInstallmentPlan, type InstallmentWriteFailure } from './use-installment-plan-mutations'
import { useInstallmentPlan } from './use-installment-plans'

export function InstallmentPlanDetailRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[]; planId?: string | string[] }>()
  const routeAccountId = parseAccountId(params.accountId)
  const planId = parseInstallmentPlanId(params.planId)
  const query = useInstallmentPlan(planId)
  const remove = useDeleteInstallmentPlan()
  const [deleteFailure, setDeleteFailure] = useState<InstallmentWriteFailure | null>(null)
  const router = useRouter()
  const { signOut } = useProductRuntime()
  // The plan knows its card; the route's account only stands in until it has loaded.
  const accountId = query.data?.installmentPlan.accountKey ?? routeAccountId
  const accountHref = accountId === null ? '/accounts' as const : `/accounts/${accountId}` as const

  let state: InstallmentPlanDetailViewState
  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.data) state = { status: 'loaded', plan: query.data.installmentPlan, stale: query.isRefreshFailure }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const leave = () => { if (router.canGoBack()) router.back(); else router.replace(accountHref) }

  return (
    <InstallmentPlanDetailScreen
      backHref={accountHref}
      deleteFailure={deleteFailure}
      deleting={remove.isPending}
      onBack={leave}
      onDelete={planId === null || accountId === null ? undefined : async () => {
        setDeleteFailure(null)
        try {
          await remove.mutateAsync({ planId, accountId })
          leave()
        } catch (error) {
          setDeleteFailure(classifyInstallmentWriteFailure(error))
        }
      }}
      onLogout={signOut}
      onRetry={async () => { await query.refetch() }}
      state={state}
    />
  )
}
