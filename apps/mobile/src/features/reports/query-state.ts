import { useEffect, useRef } from 'react'

import { ApiError } from '@/lib/api/errors'

export const isAccessError = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'mfa-required'

export const isInvalidResponse = (error: unknown): boolean => error instanceof ApiError
  && error.code === 'invalid-response'

export function useReportAccessErrors(
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

export const conservativeReportQueryOptions = {
  retry: false,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: 30_000,
} as const
