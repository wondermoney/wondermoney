import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { transactionsRootKey } from '@/features/transactions/query-keys'
import { createAccountTransactionsEndpoint } from '@/features/transactions/transactions-contract'

import { linkCandidates, linkSearchFilters, type LinkCandidate } from './installment-link-candidates'
import type { InstallmentPlanDetailDto } from './installments-contract'
import {
  classifyInstallmentLinkFailure,
  installmentLinkFailureMessage,
  useLinkInstallment,
  useUnlinkInstallment,
} from './use-installment-plan-mutations'

export type InstallmentLinkCandidates =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; rows: readonly LinkCandidate[] }

/** What the plan screen needs to link and unlink installments by hand. */
export type InstallmentLinking = Readonly<{
  /** The installment whose picker is open, or null. */
  target: number | null
  candidates: InstallmentLinkCandidates
  showAllAmounts: boolean
  pending: boolean
  /** The message key of the last refusal, or null. */
  failure: string | null
  open: (installmentNumber: number) => void
  close: () => void
  toggleShowAllAmounts: () => void
  /** Link the open installment to this transaction; the picker closes once it is linked. */
  link: (transactionKey: number) => Promise<void>
  unlink: (installmentNumber: number) => Promise<void>
}>

/**
 * Manual installment links for the plan screen: the candidate search (the card's posted charges
 * near the installment's day, from the account transaction list), the link and unlink writes, and
 * the reason a write was refused. Candidates live under the transactions root, so a link change
 * refreshes them with the lists.
 */
export function useInstallmentLinking(plan: InstallmentPlanDetailDto | null): InstallmentLinking {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useInstallmentLinking requires an authenticated runtime')
  const [target, setTarget] = useState<number | null>(null)
  const [showAllAmounts, setShowAllAmounts] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const linkWrite = useLinkInstallment()
  const unlinkWrite = useUnlinkInstallment()

  const installment = plan?.installments.find((row) => row.installmentNumber === target) ?? null
  const accountId = plan?.accountKey ?? 0
  const filters = installment ? linkSearchFilters(installment.scheduledDate) : null
  const search = useQuery({
    queryKey: [...transactionsRootKey(runtime.epochId), 'installment-candidates', accountId, installment?.scheduledDate ?? null],
    queryFn: () => runtime.apiClient.read(createAccountTransactionsEndpoint(accountId, filters!)),
    enabled: installment !== null && accountId > 0,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  let candidates: InstallmentLinkCandidates = { status: 'loading' }
  if (search.data && installment) candidates = { status: 'loaded', rows: linkCandidates(search.data.transactions, installment, { showAllAmounts }) }
  else if (search.isError) candidates = { status: 'error' }

  return {
    target: installment ? target : null,
    candidates,
    showAllAmounts,
    pending: linkWrite.isPending || unlinkWrite.isPending,
    failure,
    open: (installmentNumber) => {
      setFailure(null)
      setShowAllAmounts(false)
      setTarget(installmentNumber)
    },
    close: () => {
      setFailure(null)
      setTarget(null)
    },
    toggleShowAllAmounts: () => setShowAllAmounts((value) => !value),
    link: async (transactionKey) => {
      if (!plan || target === null) return
      setFailure(null)
      try {
        await linkWrite.mutateAsync({ planId: plan.installmentPlanKey, accountId: plan.accountKey, installmentNumber: target, transactionKey })
        setTarget(null)
      } catch (error) {
        setFailure(installmentLinkFailureMessage(classifyInstallmentLinkFailure(error), 'link'))
      }
    },
    unlink: async (installmentNumber) => {
      if (!plan) return
      setFailure(null)
      try {
        await unlinkWrite.mutateAsync({ planId: plan.installmentPlanKey, accountId: plan.accountKey, installmentNumber })
      } catch (error) {
        setFailure(installmentLinkFailureMessage(classifyInstallmentLinkFailure(error), 'unlink'))
      }
    },
  }
}
