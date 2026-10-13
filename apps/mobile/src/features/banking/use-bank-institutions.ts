import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { resolveBankCountryCode } from './bank-country'
import { createBankInstitutionsEndpoint } from './institutions-contract'
import { bankInstitutionsKey } from './query-keys'

/**
 * RAD-240 — read-only institution picker source. Genuinely idempotent GET
 * (unlike start-bank-connection), so this is a plain cached useQuery, same
 * shape as use-bank-connections: no retry, no focus/reconnect refetch,
 * MFA routed through blockAccess.
 */
export function useBankInstitutions() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBankInstitutions requires an authenticated runtime')
  const countryCode = resolveBankCountryCode()
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: bankInstitutionsKey(runtime.epochId, countryCode),
    queryFn: () => runtime.apiClient.read(createBankInstitutionsEndpoint(countryCode)),
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

  const error = query.error instanceof ApiError ? query.error : null
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
  }
}
