import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createGoalActivityEndpoint,
  createGoalDetailEndpoint,
  type GoalActivityDto,
  isValidGoalId,
} from './goals-contract'
import { goalActivityKey, goalDetailKey } from './query-keys'

const isApiError = (error: unknown, code: string) => error instanceof ApiError && error.code === code
const isNotFound = (error: unknown) => error instanceof ApiError && error.code === 'http' && error.status === 404

export function useGoalDetail(goalId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useGoalDetail requires an authenticated runtime')
  const validId = goalId !== null && isValidGoalId(goalId)
  const keyId = validId ? goalId : 0

  const detail = useQuery({
    queryKey: goalDetailKey(runtime.epochId, keyId),
    queryFn: () => runtime.apiClient.read(createGoalDetailEndpoint(goalId!)),
    enabled: validId,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const activity = useInfiniteQuery({
    queryKey: goalActivityKey(runtime.epochId, keyId),
    queryFn: ({ pageParam }) => runtime.apiClient.read(createGoalActivityEndpoint(goalId!, pageParam)),
    initialPageParam: 0,
    enabled: validId && detail.data !== undefined,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.activities.length
      return lastPage.activities.length > 0 && nextOffset < lastPage.total ? nextOffset : undefined
    },
  })

  const errors = useMemo(() => [detail.error, activity.error].filter(Boolean), [activity.error, detail.error])
  const handledAccessError = useRef<unknown>(null)
  useEffect(() => {
    const accessError = errors.find((error) => (
      isApiError(error, 'mfa-required')
    ))
    if (!accessError || accessError === handledAccessError.current || !(accessError instanceof ApiError)) return
    handledAccessError.current = accessError
    blockAccess('mfa-required')
  }, [blockAccess, errors])

  const activities = useMemo(() => {
    const unique = new Map<number, GoalActivityDto>()
    for (const page of activity.data?.pages ?? []) {
      for (const item of page.activities) if (!unique.has(item.goalActivityKey)) unique.set(item.goalActivityKey, item)
    }
    return [...unique.values()]
  }, [activity.data?.pages])

  const hasAccessError = errors.some((error) => (
    isApiError(error, 'mfa-required')
  ))
  const hasInvalidResponse = errors.some((error) => isApiError(error, 'invalid-response'))
  const hasNotFound = errors.some(isNotFound)
  const suppressData = hasAccessError || hasInvalidResponse || hasNotFound
  const hasDetailData = detail.data !== undefined
  const hasActivityData = activity.data !== undefined

  return {
    data: hasDetailData && !suppressData ? {
      detail: detail.data,
      activities,
      totalActivities: activity.data?.pages.at(-1)?.total ?? 0,
    } : undefined,
    error: errors[0] ?? null,
    isInvalidId: !validId,
    isAccessTransition: hasAccessError,
    isInvalidResponse: hasInvalidResponse,
    isNotFound: hasNotFound,
    isLoading: validId && !hasDetailData && detail.error === null,
    isActivityLoading: hasDetailData && activity.isLoading,
    isActivityError: hasDetailData && !hasActivityData && activity.isError && !suppressData,
    isLoadMoreError: hasDetailData && hasActivityData && activity.isFetchNextPageError,
    isRefreshFailure: hasDetailData && !suppressData && (
      detail.isError || (hasActivityData && activity.isRefetchError && !activity.isFetchNextPageError)
    ),
    isRefreshing: hasDetailData && (detail.isFetching || (activity.isRefetching && !activity.isFetchingNextPage)),
    isLoadingMore: activity.isFetchingNextPage,
    hasMore: activity.hasNextPage,
    loadMore: activity.fetchNextPage,
    refresh: async () => {
      const detailResult = await detail.refetch()
      if (detailResult.data === undefined || detailResult.error !== null) return false
      const activityResult = await activity.refetch()
      return activityResult.data !== undefined && activityResult.error === null
    },
  }
}
