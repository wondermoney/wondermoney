import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'

import { PendingChangesScreen, type PendingChangesViewState } from './pending-changes-screen'
import { mapProposals } from './proposals-view-model'
import { classifyProposalDecisionFailure, type ProposalDecisionFailure, useDecideProposal, usePendingProposals } from './use-assistant-proposals'
import type { ProposalDecision } from './proposals-contract'

export function PendingChangesRoute() {
  const query = usePendingProposals()
  const decide = useDecideProposal()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [failure, setFailure] = useState<ProposalDecisionFailure | null>(null)

  let state: PendingChangesViewState
  if (query.aiHidden) state = { status: 'ai-hidden' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', proposals: mapProposals(query.data.proposals, t, locale), refreshing: query.isRefreshing }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const run = (proposalId: number, decision: ProposalDecision) => {
    if (pendingId !== null) return
    setPendingId(proposalId)
    setFailure(null)
    decide.mutate({ proposalId, decision }, {
      onError: (error) => setFailure(classifyProposalDecisionFailure(error)),
      onSettled: () => setPendingId(null),
    })
  }

  return (
    <PendingChangesScreen
      failure={failure}
      onApply={(proposalId) => run(proposalId, 'apply')}
      onDismiss={(proposalId) => run(proposalId, 'reject')}
      onRetry={async () => { setFailure(null); await query.refetch() }}
      pendingId={pendingId}
      state={state}
    />
  )
}
