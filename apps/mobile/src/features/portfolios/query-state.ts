import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { ApiError } from '@/lib/api/errors'

export type PortfolioQueryResult = UseQueryResult<unknown, Error>

export function usePortfolioAccessErrors(
  errors: readonly unknown[],
  blockAccess: (reason: 'mfa-required') => void,
) {
  const handled = useRef(new Set<unknown>())
  useEffect(() => {
    for (const error of errors) {
      if (handled.current.has(error)) continue
      handled.current.add(error)
      if (!(error instanceof ApiError)) continue
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    }
  }, [blockAccess, errors])
}

export const isAccessError = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'mfa-required'

export const isInvalidResponse = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'invalid-response'

export const isNotFound = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'http' && error.status === 404

export const isRateLimited = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'http' && error.status === 429

export const conservativePortfolioQueryOptions = {
  retry: false,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Number.POSITIVE_INFINITY,
} as const
