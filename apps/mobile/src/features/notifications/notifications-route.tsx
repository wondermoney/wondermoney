import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useConfirmedFeature } from '@/lib/server/use-instance'

import {
  buildNotificationPreferencePatch,
  mapNotificationPreferences,
  type NotificationStream,
} from './notification-preferences-view-model'
import { NotificationsScreen, type NotificationsViewState, type PushSectionState } from './notifications-screen'
import type { PushCategory } from './push-contract'
import {
  classifyUpdateNotificationFailure,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type UpdateNotificationFailure,
} from './use-notification-preferences'
import type { NotificationPreferencePatch } from './notification-preferences-contract'
import { usePushPreferences, useSendTestPush, useTogglePushCategory } from './use-push-notifications'

export function NotificationsRoute() {
  const query = useNotificationPreferences()
  const mutation = useUpdateNotificationPreferences()
  const { signOut } = useProductRuntime()
  const router = useRouter()
  const [saveFailure, setSaveFailure] = useState<UpdateNotificationFailure | null>(null)
  const push = usePushSection()

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
      push={push}
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

/** The push section: only on a server with push on, and only once its switches have loaded. */
function usePushSection(): PushSectionState | undefined {
  const pushOn = useConfirmedFeature((features) => features.push)
  const preferences = usePushPreferences(pushOn)
  const toggle = useTogglePushCategory()
  const sendTest = useSendTestPush()
  const [failure, setFailure] = useState<PushSectionState['failure']>(null)
  const [test, setTest] = useState<PushSectionState['test']>('idle')
  if (!pushOn) return undefined

  const onToggle = (category: PushCategory, next: boolean) => {
    if (toggle.isPending) return
    setFailure(null)
    toggle.mutate({ category, next }, {
      onSuccess: (result) => {
        if (result.status === 'denied' || result.status === 'unavailable') setFailure(result.status)
      },
      onError: () => setFailure('error'),
    })
  }

  const onSendTest = () => {
    if (sendTest.isPending) return
    setTest('sending')
    sendTest.mutate(undefined, {
      onSuccess: () => setTest('sent'),
      onError: (error) => setTest(error instanceof ApiError && error.code === 'http' && error.status === 409 ? 'no-device' : 'error'),
    })
  }

  return {
    preferences: preferences.data ?? null,
    saving: toggle.isPending,
    failure,
    test,
    onToggle,
    onSendTest,
  }
}
