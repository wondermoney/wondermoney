import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { LoanEditScreen, type LoanEditViewState } from './loan-edit-screen'
import { parseLoanId, type LoanDto } from './loans-contract'
import { useLoan } from './use-loan'
import { useLoanMetadataMutation } from './use-loan-metadata-mutation'

export function LoanEditRoute() {
  const params = useLocalSearchParams<{ loanId?: string | string[] }>()
  const loanId = parseLoanId(params.loanId)
  const detail = useLoan(loanId)
  const mutation = useLoanMetadataMutation()
  const router = useRouter()
  let state: LoanEditViewState

  const toModel = (loan: LoanDto) => ({
    id: loan.loanKey,
    name: loan.name,
    providerName: loan.providerName ?? null,
    notes: loan.notes ?? null,
    includeInNetWorth: loan.includeInNetWorth,
    type: loan.type,
    openingPrincipalBalance: loan.openingPrincipalBalance,
    openingBalanceDate: loan.openingBalanceDate,
    regularPaymentAmount: loan.regularPaymentAmount ?? null,
    annualInterestRateBps: loan.annualInterestRateBps ?? null,
    termMonths: loan.termMonths ?? null,
  })

  if (detail.isInvalidId) state = { status: 'invalid-route' }
  else if (detail.isAccessTransition) state = { status: 'access-transition' }
  else if (detail.isLoading) state = { status: 'loading' }
  else if (detail.data) {
    state = {
      status: detail.isRefreshFailure ? 'refresh-error' : 'loaded',
      model: toModel(detail.data.loan),
      refreshing: detail.isRefreshing,
    }
  } else if (detail.isNotFound) state = { status: 'not-found' }
  else if (detail.error instanceof ApiError && detail.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const back = () => loanId === null
    ? router.replace('/loans' as Href)
    : router.replace({ pathname: '/loans/[loanId]', params: { loanId: String(loanId) } })

  const pending = loanId !== null && mutation.isLoanPending(loanId)
  const refreshRequired = loanId !== null && mutation.requiresAuthoritativeRefresh(loanId)
  return <LoanEditScreen
    state={state}
    onBack={back}
    onRetry={async () => { await detail.refetch() }}
    onRefreshAuthoritative={async () => {
      if (loanId === null) return null
      const result = await detail.refetch()
      if (result.error || !result.data) return null
      mutation.markAuthoritativeRefresh(loanId)
      return toModel(result.data.loan)
    }}
    pending={pending}
    refreshRequired={refreshRequired}
    onSaveLoan={async (value) => { if (loanId === null) return; await mutation.mutateAsync({ loanId, value }) }}
  />
}
