import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  notificationPreferencesEndpoint,
  updateNotificationPreferencesEndpoint,
  type NotificationPreferencePatch,
  type NotificationPreferencesDto,
} from './notification-preferences-contract'
import { notificationPreferencesKey } from './query-keys'

export function useNotificationPreferences() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('Notification preferences require an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: notificationPreferencesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(notificationPreferencesEndpoint),
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
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isNotFound,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}

export type UpdateNotificationFailure = 'unknown' | 'demo' | 'access' | 'mfa' | 'unsupported' | 'cancelled'

export function classifyUpdateNotificationFailure(error: unknown): UpdateNotificationFailure {
  if (!(error instanceof ApiError)) return 'unknown'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (
    error.code === 'auth-session'
    || (error.code === 'http' && (error.status === 403 || error.status === 401))
  ) return 'access'
  // 400 here is the API's DELIVERY_UNSUPPORTED / EMPTY_PATCH guard: the change is
  // rejected but the account is untouched.
  if (error.code === 'http' && error.status === 400) return 'unsupported'
  if (error.code === 'cancelled') return 'cancelled'
  return 'unknown'
}

/**
 * Guarded, single-flight preference toggle. The PATCH returns the full authoritative
 * state, which is committed straight into the cache (`setQueryData`) only while the
 * session generation is still current, so a stale response can never repopulate a
 * retired session.
 */
export function useUpdateNotificationPreferences() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('Notification preferences require an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (patch: NotificationPreferencePatch) => (
      runtime.apiClient.write(updateNotificationPreferencesEndpoint, {
        body: patch,
        commit: (state: NotificationPreferencesDto) => {
          queryClient.setQueryData(notificationPreferencesKey(runtime.epochId), state)
        },
      })
    ),
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
