import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { accountCurrenciesEndpoint } from '@/features/accounts/offline-account-contract'
import { accountCurrenciesKey } from '@/features/accounts/query-keys'
import { ApiError } from '@/lib/api/errors'

/** Reuses the accounts feature's global currency list — loans draw from the same currency table. */
export function useLoanCurrencies() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useLoanCurrencies requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: accountCurrenciesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(accountCurrenciesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (!(query.error instanceof ApiError)) return
    if (query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])

  const errorCode = query.error instanceof ApiError ? query.error.code : null
  return {
    ...query,
    isAccessTransition: errorCode === 'mfa-required',
  }
}
