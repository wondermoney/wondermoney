import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { AccountEditScreen, type AccountEditViewState } from './account-edit-screen'
import { parseAccountId } from './accounts-contract'
import { useAccount } from './use-account'
import { useAccountDeleteMutation } from './use-account-delete-mutation'
import { useAccountMetadataMutation } from './use-account-metadata-mutation'

export function AccountEditRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const accountId = parseAccountId(params.accountId)
  const detail = useAccount(accountId)
  const mutation = useAccountMetadataMutation()
  const deleteMutation = useAccountDeleteMutation()
  const router = useRouter()
  let state: AccountEditViewState

  if (detail.isInvalidId) state = { status: 'invalid-id' }
  else if (detail.isAccessTransition) state = { status: 'access-transition' }
  else if (detail.isLoading) state = { status: 'loading' }
  else if (detail.data) {
    state = {
      status: detail.isRefreshFailure ? 'refresh-error' : 'loaded',
      model: {
        id: detail.data.account.accountKey,
        name: detail.data.account.accountName ?? '',
        isPrivate: detail.data.account.isPrivate,
        isOwnedByViewer: detail.data.account.isOwnedByViewer,
      },
      refreshing: detail.isRefreshing,
    }
  } else if (detail.isNotFound) state = { status: 'not-found' }
  else if (detail.error instanceof ApiError && detail.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const back = () => accountId === null
    ? router.replace('/accounts' as Href)
    : router.replace({ pathname: '/accounts/[accountId]', params: { accountId: String(accountId) } })

  return <AccountEditScreen
    state={state}
    onBack={back}
    onRetry={async () => { await detail.refetch() }}
    pending={mutation.isPending}
    deletePending={deleteMutation.isPending}
    onSaveAccount={async (value) => { if (accountId === null) return; await mutation.mutateAsync({ accountId, value }) }}
    onDeleteAccount={async () => { if (accountId === null) return; await deleteMutation.mutateAsync(accountId); router.replace('/accounts' as Href) }}
  />
}
