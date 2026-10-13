import { type Href, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { ProfileScreen, type ProfileViewState } from './profile-screen'
import { mapProfile } from './self-view-models'
import { useProfile } from './use-self-resource'

export function ProfileRoute() {
  const query = useProfile()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: ProfileViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const data = mapProfile(query.data.profile)
    state = query.isRefreshFailure ? { status: 'refresh-error', data, refreshing: query.isRefreshing } : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  const goBackToMore = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/more' as unknown as Href)
  }
  return <ProfileScreen state={state} onBack={goBackToMore} onRetry={async () => { await query.refetch() }} onLogout={signOut} onEdit={() => router.push('/settings/profile/edit' as unknown as Href)} />
}
