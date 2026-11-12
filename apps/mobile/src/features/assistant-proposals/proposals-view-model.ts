import type { TFunction } from 'i18next'

import { formatTransactionDate } from '@/lib/dates/transaction-date'
import { formatCategoryName } from '@/lib/formatters/category-name'

import type { ProposalChangeDto, ProposalDto } from './proposals-contract'

export type ProposalDiffRow = Readonly<{
  key: string
  /** The transaction the change is on, by its description. */
  label: string
  date: string | null
  before: string
  after: string
}>

export type ProposalListItem = Readonly<{
  id: number
  title: string
  source: string | null
  expires: string
  rows: readonly ProposalDiffRow[]
  /** "2 more transactions can't be shown", or null. */
  unavailable: string | null
}>

/**
 * A proposal as the screen shows it. The title is built from the kind and the count in the
 * person's language; the server's `summary` is English and is used only for a kind this build
 * does not know.
 */
export function mapProposal(proposal: ProposalDto, t: TFunction, locale: string): ProposalListItem {
  const count = proposal.changes.length + proposal.unavailableCount
  return {
    id: proposal.id,
    title: titleOf(proposal, count, t),
    source: proposal.source === 'unknown' ? null : t(`pendingChanges.source.${proposal.source}`),
    expires: t('pendingChanges.expires', { date: formatDate(proposal.expiresAt, locale) }),
    rows: proposal.changes.map((change) => diffRow(change, t, locale)),
    unavailable: proposal.unavailableCount > 0 ? t('pendingChanges.unavailable', { count: proposal.unavailableCount }) : null,
  }
}

export function mapProposals(proposals: readonly ProposalDto[], t: TFunction, locale: string): ProposalListItem[] {
  return proposals.map((proposal) => mapProposal(proposal, t, locale))
}

function titleOf(proposal: ProposalDto, count: number, t: TFunction): string {
  switch (proposal.kind) {
    case 'categorize_transactions': {
      const category = proposal.changes.find((change) => typeof change.after === 'string')?.after
      return typeof category === 'string'
        ? t('pendingChanges.title.categorize', { category: formatCategoryName(category), count })
        : t('pendingChanges.title.categorizeUnnamed', { count })
    }
    case 'mark_transactions_reviewed':
      return t('pendingChanges.title.review', { count })
    case 'update_transaction_note':
      return t('pendingChanges.title.note')
    case 'unknown':
      return proposal.summary
  }
}

function diffRow(change: ProposalChangeDto, t: TFunction, locale: string): ProposalDiffRow {
  return {
    key: `${change.transactionId}-${change.field}`,
    label: change.description?.trim() || t('pendingChanges.untitledTransaction'),
    date: change.transactionDate ? formatTransactionDate(change.transactionDate, locale) : null,
    before: valueOf(change.field, change.before, t),
    after: valueOf(change.field, change.after, t),
  }
}

function valueOf(field: ProposalChangeDto['field'], value: ProposalChangeDto['before'], t: TFunction): string {
  switch (field) {
    case 'category':
      return typeof value === 'string' && value ? formatCategoryName(value) : t('pendingChanges.value.uncategorized')
    case 'reviewed':
      return t(value === true ? 'pendingChanges.value.reviewed' : 'pendingChanges.value.notReviewed')
    case 'note':
      return typeof value === 'string' && value ? value : t('pendingChanges.value.noNote')
    case 'unknown':
      return typeof value === 'string' && value ? value : '—'
  }
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}
