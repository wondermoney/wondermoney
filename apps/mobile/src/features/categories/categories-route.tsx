import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'

import { CategoriesScreen, type CategoriesViewState } from './categories-screen'
import { mapCategories } from './categories-view-model'
import { useCategories } from './use-categories'
import { useCategoryWrite, useCategoryWriteDemoLocked, useCategoryWriteGate } from './use-category-write'

export function CategoriesRoute() {
  const query = useCategories()
  const writeGate = useCategoryWriteGate()
  const demoLocked = useCategoryWriteDemoLocked()
  const write = useCategoryWrite()
  const router = useRouter()
  const { t, i18n } = useTranslation()
  let state: CategoriesViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', categories: mapCategories(query.data, t, i18n.language), refreshing: query.isRefreshing }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  // A system category's switch sets "counts as spending" for this household only.
  const onToggleCountsAsSpending = (categoryId: number, countsAsSpending: boolean) => {
    write.mutate({ type: 'edit', categoryId, payload: { countsAsSpending } }, {
      onError: () => Alert.alert(t('categories.toggleFailedTitle'), t('categories.toggleFailedMessage')),
    })
  }
  return <CategoriesScreen state={state} createBlocked={writeGate !== null || demoLocked} demoLocked={demoLocked} togglePending={write.isPending} onToggleCountsAsSpending={onToggleCountsAsSpending} onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/more') }} onRetry={async () => { await query.refetch() }} onCreate={() => router.push('/settings/categories/create')} onEdit={(categoryId) => router.push({ pathname: '/settings/categories/[categoryId]/edit', params: { categoryId: String(categoryId) } })} />
}
