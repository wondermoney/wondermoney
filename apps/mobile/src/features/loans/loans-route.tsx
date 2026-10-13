import { useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { LoansScreen, type LoansViewState } from './loans-screen'
import { mapLoans } from './loans-view-model'
import { useLoans } from './use-loans'

export function LoansRoute() {
  const query = useLoans()
  const router = useRouter()
  let state: LoansViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', loans: mapLoans(query.data), refreshing: query.isRefreshing }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  return <LoansScreen
    state={state}
    onBack={() => router.replace('/more')}
    onRefresh={async () => { await query.refetch() }}
    onOpenLoan={(loanId) => router.push({ pathname: '/loans/[loanId]', params: { loanId: String(loanId) } })}
    onCreateLoan={() => router.push('/loans/create')}
  />
}
