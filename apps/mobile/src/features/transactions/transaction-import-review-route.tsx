import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import type { TransactionImportDecision } from './transaction-import-contract'
import { TransactionImportReviewScreen } from './transaction-import-review-screen'
import {
  dateOrderPrompt,
  filterOptions,
  importStage,
  initialAccountMapping,
  isDecidableFilter,
  isFinishedStage,
  missingSessionStage,
  pageCount,
  REVIEW_PAGE_SIZE,
  type ReviewFilter,
  toReviewRow,
} from './transaction-import-review-view-model'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'
import { useTransactionImportSession, useTransactionImportSessionActions } from './use-transaction-import-session'

export type TransactionImportReviewRouteProps = Readonly<{
  sessionId: string
  /** When the session expires, as last read; tells one the sweep removed after it expired from one that is just gone. */
  expiresAt: string | null
  /** The accounts a file with several accounts can map to: the person's own. */
  accounts: readonly Readonly<{ id: number; name: string }>[]
  /** The person has seen how the import ended: it is not resumed again. */
  onFinished: () => void
  /** The session is gone (not found, and not expired): forget it and pick a file. */
  onGone: () => void
  onDone: () => void
  /** Leave this import (finished, cancelled or expired) and pick another file. */
  onImportAnother: () => void
  onBack: () => void
  now?: () => Date
}>

/**
 * A staged import's review, read from `/v1/transaction-import-sessions/:id` and decided there.
 * Leaving it keeps the session: the import screen resumes it until it ends. A commit carries on
 * in the background; coming back shows its progress, then its outcome.
 */
export function TransactionImportReviewRoute({ sessionId, expiresAt, accounts, onFinished, onGone, onDone, onImportAnother, onBack, now = () => new Date() }: TransactionImportReviewRouteProps) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const { runtime } = useProductRuntime()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [page, setPage] = useState(1)
  const query = useTransactionImportSession(sessionId, { page, pageSize: REVIEW_PAGE_SIZE, ...(filter === 'all' ? {} : { status: filter }) })
  const actions = useTransactionImportSessionActions(sessionId)

  const session = query.data?.session
  // A session's expiry is set when it is staged and never moves, so the one kept with it holds.
  const missing = query.isNotFound ? missingSessionStage(expiresAt, now()) : null
  const stage = session ? importStage(session) : missing
  const gone = query.isNotFound && missing === null

  useEffect(() => {
    if (gone) onGone()
  }, [gone, onGone])

  // Once per session: the outcome is seen (not resumed again), and an import that wrote rows
  // refreshes what it changed.
  const finished = stage !== null && isFinishedStage(stage)
  const wroteRows = stage?.kind === 'done' && stage.outcome !== 'failed'
  const finishedRef = useRef(false)
  useEffect(() => {
    if (!finished || finishedRef.current) return
    finishedRef.current = true
    if (wroteRows && runtime) void queryClient.invalidateQueries({ predicate: (cached) => isManualTransactionAffectedQuery(cached.queryKey, runtime.epochId) })
    onFinished()
  }, [finished, onFinished, queryClient, runtime, wroteRows])

  const rows = query.data?.rows
  const pages = rows ? pageCount(rows.total, rows.pageSize) : 1

  const decideAll = (decision: TransactionImportDecision) => {
    if (isDecidableFilter(filter)) void actions.run({ type: 'decide-status', decision, status: filter })
  }
  const cancel = async () => {
    if (await actions.run({ type: 'cancel' })) onImportAnother()
  }

  return (
    <TransactionImportReviewScreen
      busy={actions.pending}
      canCommit={session?.canCommit ?? false}
      committing={actions.pendingAction === 'commit'}
      createdAt={session?.createdAt ?? null}
      dateOrder={session ? dateOrderPrompt(session) : null}
      failure={finished || gone ? null : actions.failure}
      fileName={session?.fileName ?? null}
      filter={filter}
      filters={session ? filterOptions(session.counts, filter) : []}
      loadFailed={query.isError && !query.isNotFound && !session}
      locale={locale}
      locked={actions.demoLocked}
      mapping={session?.status === 'needs_mapping' && session.sourceAccounts.length > 0
        ? { sources: session.sourceAccounts, accounts, initial: initialAccountMapping(session) }
        : null}
      onBack={onBack}
      onCancel={() => { void cancel() }}
      onCommit={() => { void actions.run({ type: 'commit' }) }}
      onDateOrder={(dateOrder) => { void actions.run({ type: 'parse', dateOrder }) }}
      onDecideAll={decideAll}
      onDecideRow={(rowId, decision) => { void actions.run({ type: 'decide', decision, rowIds: [rowId] }) }}
      onDone={onDone}
      onFilterChange={(next) => { setFilter(next); setPage(1) }}
      onImportAnother={onImportAnother}
      onPageChange={setPage}
      onRetryLoad={() => { void query.refetch() }}
      onRetryRead={() => { void actions.run({ type: 'parse' }) }}
      onSaveMapping={(mapping) => { void actions.run({ type: 'map', mapping }) }}
      page={page}
      pages={pages}
      rows={rows ? rows.items.map(toReviewRow) : []}
      stage={gone ? null : stage}
      toImport={session?.decisions.import ?? 0}
    />
  )
}
