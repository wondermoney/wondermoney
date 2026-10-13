import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { ApiError } from '@/lib/api/errors'

import { LoanDetailScreen, type LoanDetailViewState } from './loan-detail-screen'
import { parseLoanId } from './loans-contract'
import { mapLoan, mapRepayments } from './loans-view-model'
import { useLoan } from './use-loan'
import { useLoanRepayments } from './use-loan-repayments'
import { useLoanRepaymentCandidates } from './use-loan-repayment-candidates'
import { classifyRepaymentWriteFailure, useLoanRepaymentMutation } from './use-loan-repayment-mutation'

export function LoanDetailRoute() {
  const params = useLocalSearchParams<{ loanId?: string | string[] }>()
  const loanId = parseLoanId(params.loanId)
  const loanQuery = useLoan(loanId)
  const repaymentsQuery = useLoanRepayments(loanId)
  const candidatesQuery = useLoanRepaymentCandidates(loanId)
  const repaymentMutation = useLoanRepaymentMutation()
  const router = useRouter()
  const navigation = useNavigation()
  const repaymentPending = loanId !== null && repaymentMutation.isLoanPending(loanId)
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (repaymentPending) event.preventDefault()
  }), [navigation, repaymentPending])
  let state: LoanDetailViewState
  if (loanQuery.isInvalidId) state = { status: 'invalid-id' }
  else if (loanQuery.isAccessTransition || repaymentsQuery.isAccessTransition || candidatesQuery.isAccessTransition) state = { status: 'access-transition' }
  else if (loanQuery.isLoading) state = { status: 'loading' }
  else if (loanQuery.data) {
    let history: Extract<LoanDetailViewState, { status: 'loaded' }>['history']
    if (repaymentsQuery.isLoading) history = { status: 'loading' }
    else if (repaymentsQuery.data) history = { status: repaymentsQuery.isRefreshFailure ? 'refresh-error' : 'loaded', repayments: mapRepayments(repaymentsQuery.data) }
    else if (repaymentsQuery.error instanceof ApiError && repaymentsQuery.error.code === 'invalid-response') history = { status: 'invalid-response' }
    else history = { status: 'error' }
    state = {
      status: loanQuery.isRefreshFailure ? 'refresh-error' : 'loaded',
      loan: mapLoan(loanQuery.data.loan),
      history,
      refreshing: loanQuery.isRefreshing || repaymentsQuery.isRefreshing,
    }
  } else if (loanQuery.isNotFound) state = { status: 'not-found' }
  else if (loanQuery.error instanceof ApiError && loanQuery.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  let candidates: import('./loan-repayment-workflow').CandidateState
  if (candidatesQuery.isLoading) candidates = { status: 'loading' }
  else if (candidatesQuery.data) candidates = { status: candidatesQuery.isRefreshFailure ? 'refresh-error' : 'loaded', candidates: candidatesQuery.data.candidates }
  else if (candidatesQuery.error instanceof ApiError && candidatesQuery.error.code === 'invalid-response') candidates = { status: 'invalid-response' }
  else candidates = { status: 'error' }
  const refreshRepaymentAuthority = async () => {
    const [historyResult, candidatesResult] = await Promise.all([repaymentsQuery.refetch(), candidatesQuery.refetch()])
    const authoritative = historyResult.isSuccess && candidatesResult.isSuccess && historyResult.data !== undefined && candidatesResult.data !== undefined
    if (authoritative && loanId !== null) repaymentMutation.markAuthoritativeRefresh(loanId)
    return authoritative
  }
  return <LoanDetailScreen state={state} onBack={() => router.replace('/loans')} onEdit={() => { if (loanId !== null) router.push({ pathname: '/loans/[loanId]/edit', params: { loanId: String(loanId) } } as Href) }} onRefresh={async () => { await Promise.all([loanQuery.refetch(), repaymentsQuery.refetch(), candidatesQuery.refetch()]) }} repaymentWorkflow={{
    candidates,
    pending: repaymentPending,
    refreshRequired: loanId !== null && repaymentMutation.requiresAuthoritativeRefresh(loanId),
    onRefreshCandidates: async () => { await candidatesQuery.refetch() },
    onResolveUnknown: refreshRepaymentAuthority,
    onWrite: async (write) => {
      try {
        await repaymentMutation.mutateAsync(write)
        return 'success'
      } catch (error) {
        return classifyRepaymentWriteFailure(error)
      }
    },
  }} />
}
