import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'
import type { ReadEndpoint } from '@/lib/api/runtime-schema'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import {
  createInstallmentCommitmentsEndpoint,
  createInstallmentPlanDetailEndpoint,
  createInstallmentPlansEndpoint,
  createInstallmentSuggestionsEndpoint,
  isValidInstallmentPlanId,
} from './installments-contract'
import {
  installmentCommitmentsKey,
  installmentPlanDetailKey,
  installmentPlansKey,
  installmentSuggestionsKey,
} from './query-keys'

function useAccountScoped<Value>(
  name: string,
  accountId: number | null,
  enabled: boolean,
  endpoint: (accountId: number) => ReadEndpoint<Value>,
  key: (epochId: number, accountId: number) => readonly unknown[],
) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error(`${name} requires an authenticated runtime`)
  const valid = accountId !== null && isValidInstallmentPlanId(accountId)
  const query = useInsightQuery(endpoint(valid ? accountId : 1), key(runtime.epochId, valid ? accountId : 0), valid && enabled)
  return { ...query, isInvalidId: !valid }
}

/** A card's installment plans. Disabled for an account that is not a card. */
export function useInstallmentPlans(accountId: number | null, enabled = true) {
  return useAccountScoped('Installment plans', accountId, enabled, createInstallmentPlansEndpoint, installmentPlansKey)
}

/** What the card's plans still have to charge. */
export function useInstallmentCommitments(accountId: number | null, enabled = true) {
  return useAccountScoped('Installment commitments', accountId, enabled, createInstallmentCommitmentsEndpoint, installmentCommitmentsKey)
}

/** Posted rows on the card that look like installments of a purchase with no plan. */
export function useInstallmentSuggestions(accountId: number | null, enabled = true) {
  return useAccountScoped('Installment suggestions', accountId, enabled, createInstallmentSuggestionsEndpoint, installmentSuggestionsKey)
}

/** One plan with its whole schedule; a plan the reader cannot see reads as not found. */
export function useInstallmentPlan(planId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Installment plan requires an authenticated runtime')
  const valid = planId !== null && isValidInstallmentPlanId(planId)
  const query = useGuardedQuery(useQuery({
    queryKey: installmentPlanDetailKey(runtime.epochId, valid ? planId : 0),
    queryFn: () => runtime.apiClient.read(createInstallmentPlanDetailEndpoint(planId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidId: !valid }
}
