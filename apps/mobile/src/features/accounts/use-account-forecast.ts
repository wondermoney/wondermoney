import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'

import { createAccountForecastEndpoint } from './forecast-contract'
import { accountForecastKey } from './query-keys'

export function useAccountForecast(accountId: number | null, days = 30) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Account forecast requires an authenticated runtime')
  const valid = accountId !== null && Number.isSafeInteger(accountId) && accountId > 0
  const query = useInsightQuery(
    createAccountForecastEndpoint(valid ? accountId : 1, days),
    accountForecastKey(runtime.epochId, valid ? accountId : 0, days),
    valid,
  )
  return { ...query, isInvalidId: !valid }
}
