/**
 * Wraps a query with the app's access rules: an MFA error hands
 * off to the runtime's block screen, and a 404 / unverifiable payload
 * suppresses stale data rather than rendering it as if it were current.
 *
 * This lived in the loans feature as `useGuardedQuery`, but nothing about
 * it is loan-specific — categories already used it from there.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from './errors'

export function useGuardedQuery<T>(query: UseQueryResult<T, Error>) {
  const { blockAccess } = useProductRuntime()
  const handledError = useRef<unknown>(null)
  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (!(query.error instanceof ApiError)) return
    if (query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])
  const error = query.error instanceof ApiError ? query.error : null
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isNotFound,
    isAccessTransition,
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
