import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { AccountEditScreen, type AccountEditViewState } from './account-edit-screen'
import type { AccountSharingViewState } from './account-sharing-section'
import { parseAccountId } from './accounts-contract'
import { useAccount } from './use-account'
import { useAccountDeleteMutation } from './use-account-delete-mutation'
import { useAccountMetadataMutation } from './use-account-metadata-mutation'
import { useAccountShares, useAccountSharesMutation } from './use-account-shares'
import { useCreditCardMutation } from './use-credit-card-mutation'

export function AccountEditRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const accountId = parseAccountId(params.accountId)
  const detail = useAccount(accountId)
  const mutation = useAccountMetadataMutation()
  const creditCardMutation = useCreditCardMutation()
  const deleteMutation = useAccountDeleteMutation()
  const shares = useAccountShares(accountId)
  const sharesMutation = useAccountSharesMutation()
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
        creditCard: detail.data.account.creditCard ?? null,
        myAccess: detail.data.account.myAccess,
      },
      refreshing: detail.isRefreshing,
    }
  } else if (detail.isNotFound) state = { status: 'not-found' }
  else if (detail.error instanceof ApiError && detail.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const sharing: AccountSharingViewState = shares.data
    ? { status: 'loaded', shares: shares.data }
    : shares.isUnsupported ? { status: 'unsupported' }
      : shares.isLoading ? { status: 'loading' } : { status: 'error' }

  const back = () => accountId === null
    ? router.replace('/accounts' as Href)
    : router.replace({ pathname: '/accounts/[accountId]', params: { accountId: String(accountId) } })

  return <AccountEditScreen
    state={state}
    onBack={back}
    onRetry={async () => { await detail.refetch() }}
    pending={mutation.isPending}
    creditCardPending={creditCardMutation.isPending}
    deletePending={deleteMutation.isPending}
    sharing={sharing}
    sharingPending={sharesMutation.isPending}
    onRetrySharing={() => { void shares.refetch() }}
    onSaveSharing={async (value) => { if (accountId === null) return; await sharesMutation.mutateAsync({ accountId, value }) }}
    onSaveAccount={async (value) => { if (accountId === null) return; await mutation.mutateAsync({ accountId, value }) }}
    onSaveCreditCard={async (value) => { if (accountId === null) return; await creditCardMutation.mutateAsync({ accountId, value }) }}
    onDeleteAccount={async () => { if (accountId === null) return; await deleteMutation.mutateAsync(accountId); router.replace('/accounts' as Href) }}
  />
}
