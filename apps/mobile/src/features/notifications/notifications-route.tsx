import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  buildNotificationPreferencePatch,
  mapNotificationPreferences,
  type NotificationStream,
} from './notification-preferences-view-model'
import { NotificationsScreen, type NotificationsViewState } from './notifications-screen'
import {
  classifyUpdateNotificationFailure,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type UpdateNotificationFailure,
} from './use-notification-preferences'
import type { NotificationPreferencePatch } from './notification-preferences-contract'

export function NotificationsRoute() {
  const query = useNotificationPreferences()
  const mutation = useUpdateNotificationPreferences()
  const { signOut } = useProductRuntime()
  const router = useRouter()
  const [saveFailure, setSaveFailure] = useState<UpdateNotificationFailure | null>(null)

  let state: NotificationsViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const mapped = mapNotificationPreferences(query.data)
    state = {
      status: 'loaded',
      rows: mapped.rows,
      marketingOptOut: mapped.marketingOptOut,
      refreshFailed: query.isRefreshFailure,
      refreshing: query.isRefreshing,
    }
  } else state = { status: 'error' }

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/more' as unknown as Href)
  }

  const applyPatch = async (patch: NotificationPreferencePatch) => {
    if (mutation.isPending) return
    setSaveFailure(null)
    try {
      await mutation.mutateAsync(patch)
    } catch (error) {
      setSaveFailure(classifyUpdateNotificationFailure(error))
      // The optimistic commit only runs on success, so the cache is untouched; resync
      // from the server so the toggles reflect authoritative state.
      if (!(error instanceof ApiError && (error.code === 'mfa-required'))) {
        void query.refetch()
      }
    }
  }

  return (
    <NotificationsScreen
      state={state}
      saving={mutation.isPending}
      saveFailure={saveFailure}
      onBack={goBack}
      onRetry={async () => { await query.refetch() }}
      onLogout={signOut}
      onToggleStream={(stream: NotificationStream, next: boolean) => void applyPatch(buildNotificationPreferencePatch(stream, next))}
      onToggleMarketingOptOut={(next: boolean) => void applyPatch({ marketingOptOut: next })}
    />
  )
}
