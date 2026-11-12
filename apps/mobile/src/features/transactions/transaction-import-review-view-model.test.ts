import type { TransactionImportRowDto, TransactionImportSessionDto } from './transaction-import-contract'
import {
  applyRowDecisions,
  dateOrderPrompt,
  filterOptions,
  importStage,
  initialAccountMapping,
  isFinishedStage,
  isMappingComplete,
  missingSessionStage,
  pageCount,
  refetchIntervalFor,
  toReviewRow,
} from './transaction-import-review-view-model'

const counts = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0, skipped: 0, imported: 0, failed: 0 }

function session(overrides: Partial<TransactionImportSessionDto> = {}): TransactionImportSessionDto {
  return {
    accountId: 7,
    accountMapping: {},
    canCommit: true,
    canRetry: false,
    committedAt: null,
    counts,
    createdAt: '2026-11-10T10:00:00.000Z',
    decisions: { import: 0, skip: 0 },
    detailsDeletedAt: null,
    errorCode: null,
    expiresAt: '2026-11-17T10:00:00.000Z',
    fileName: 'statement.csv',
    format: 'statement',
    id: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e',
    sourceAccounts: [],
    sourceCategories: [],
    status: 'ready',
    warnings: [],
    ...overrides,
  }
}

function row(overrides: Partial<TransactionImportRowDto> = {}): TransactionImportRowDto {
  return {
    decision: 'import',
    error: null,
    id: 1,
    normalized: { amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z', description: 'CARD 1234 CAFE', merchant: 'Cafe' },
    sourceRow: 2,
    status: 'new',
    ...overrides,
  }
}

describe('importStage', () => {
  it('waits while the file is read, and offers a retry once the read stopped', () => {
    expect(importStage(session({ status: 'parsing' }))).toEqual({ kind: 'reading', stalled: false })
    expect(importStage(session({ status: 'parsing', canRetry: true }))).toEqual({ kind: 'reading', stalled: true })
    // No job reads a file that never arrived.
    expect(importStage(session({ status: 'waiting_for_upload' }))).toEqual({ kind: 'reading', stalled: true })
  })

  it('stops at review for a read file, with the mapping step when the file holds several accounts', () => {
    expect(importStage(session({ status: 'ready' }))).toEqual({ kind: 'review', needsMapping: false })
    expect(importStage(session({ status: 'needs_mapping', canCommit: false }))).toEqual({ kind: 'review', needsMapping: true })
  })

  it('never commits a file whose categories need mapping (a YNAB export): it is imported on the web', () => {
    expect(importStage(session({ format: 'ynab' }))).toEqual({ kind: 'needs-web', reason: 'categories' })
    expect(importStage(session({ status: 'needs_mapping', format: 'ynab', canCommit: false }))).toEqual({ kind: 'needs-web', reason: 'categories' })
    expect(importStage(session({ sourceCategories: [{ label: 'Bills: Rent' }] }))).toEqual({ kind: 'needs-web', reason: 'categories' })
    expect(importStage(session({ status: 'parsing', format: 'ynab' }))).toEqual({ kind: 'reading', stalled: false })
    expect(isFinishedStage({ kind: 'needs-web', reason: 'categories' })).toBe(false)
  })

  it('never commits an Actual Budget export, even one whose rows have no categories: it is imported on the web', () => {
    expect(importStage(session({ format: 'actual' }))).toEqual({ kind: 'needs-web', reason: 'categories' })
    expect(importStage(session({ status: 'needs_mapping', format: 'actual', canCommit: false }))).toEqual({ kind: 'needs-web', reason: 'categories' })
    expect(importStage(session({ status: 'parsing', format: 'actual' }))).toEqual({ kind: 'reading', stalled: false })
    expect(importStage(session({ status: 'importing', format: 'actual' }))).toMatchObject({ kind: 'importing' })
  })

  it('sends a PDF statement to the web once it is read: the app has no balance check to acknowledge', () => {
    expect(importStage(session({ status: 'parsing', format: 'pdf' }))).toEqual({ kind: 'reading', stalled: false })
    expect(importStage(session({ status: 'ready', format: 'pdf' }))).toEqual({ kind: 'needs-web', reason: 'pdf' })
    expect(importStage(session({ status: 'failed', format: 'pdf', errorCode: 'too_many_pages' }))).toEqual({ kind: 'read-failed' })
    expect(importStage(session({ status: 'succeeded', format: 'pdf' }))).toMatchObject({ kind: 'done', outcome: 'succeeded' })
  })

  it('reports commit progress as rows imported of rows to import', () => {
    expect(importStage(session({ status: 'importing', counts: { ...counts, imported: 120 }, decisions: { import: 380, skip: 4 } }))).toEqual({ kind: 'importing', stalled: false, imported: 120, total: 500 })
    expect(importStage(session({ status: 'importing', canRetry: true }))).toEqual({ kind: 'importing', stalled: true, imported: 0, total: 0 })
  })

  it('reads a finished commit as its outcome and counts', () => {
    expect(importStage(session({ status: 'succeeded', counts: { ...counts, imported: 3, skipped: 1 } }))).toEqual({ kind: 'done', outcome: 'succeeded', imported: 3, skipped: 1, failed: 0, detailsDeleted: false })
    expect(importStage(session({ status: 'partial', counts: { ...counts, imported: 2, failed: 1 }, detailsDeletedAt: '2026-11-20T00:00:00.000Z' }))).toEqual({ kind: 'done', outcome: 'partial', imported: 2, skipped: 0, failed: 1, detailsDeleted: true })
  })

  it('tells a file that could not be read (a code) from a commit whose rows all failed (no code)', () => {
    expect(importStage(session({ status: 'failed', errorCode: 'unreadable' }))).toEqual({ kind: 'read-failed' })
    expect(importStage(session({ status: 'failed', counts: { ...counts, failed: 2 } }))).toEqual({ kind: 'done', outcome: 'failed', imported: 0, skipped: 0, failed: 2, detailsDeleted: false })
  })

  it.each(['expired', 'cancelled'] as const)('reads a %s session as expired, as web does', (status) => {
    expect(importStage(session({ status }))).toEqual({ kind: 'expired' })
  })

  it('does not guess at a status this build does not know', () => {
    expect(importStage(session({ status: 'unknown' }))).toEqual({ kind: 'unsupported' })
  })

  it('treats only an outcome as finished', () => {
    expect(isFinishedStage({ kind: 'done', outcome: 'succeeded', imported: 1, skipped: 0, failed: 0, detailsDeleted: false })).toBe(true)
    expect(isFinishedStage({ kind: 'read-failed' })).toBe(true)
    expect(isFinishedStage({ kind: 'expired' })).toBe(true)
    expect(isFinishedStage({ kind: 'review', needsMapping: false })).toBe(false)
    expect(isFinishedStage({ kind: 'importing', stalled: false, imported: 0, total: 1 })).toBe(false)
    expect(isFinishedStage({ kind: 'unsupported' })).toBe(false)
  })
})

describe('missingSessionStage', () => {
  const now = new Date('2026-11-12T12:00:00.000Z')

  it('says a session the daily sweep removed after it expired has expired', () => {
    expect(missingSessionStage('2026-11-11T00:00:00.000Z', now)).toEqual({ kind: 'expired' })
  })

  it('forgets a session that is gone for another reason', () => {
    expect(missingSessionStage('2026-11-19T00:00:00.000Z', now)).toBeNull()
    expect(missingSessionStage(null, now)).toBeNull()
    expect(missingSessionStage('not a date', now)).toBeNull()
  })
})

describe('refetchIntervalFor', () => {
  it('polls while the worker reads or writes, as web does', () => {
    expect(refetchIntervalFor(session({ status: 'parsing' }))).toBe(2000)
    expect(refetchIntervalFor(session({ status: 'importing' }))).toBe(2000)
  })

  it('stops polling once the job stopped, at review and after the outcome', () => {
    expect(refetchIntervalFor(session({ status: 'importing', canRetry: true }))).toBe(false)
    expect(refetchIntervalFor(session({ status: 'ready' }))).toBe(false)
    expect(refetchIntervalFor(session({ status: 'succeeded' }))).toBe(false)
    expect(refetchIntervalFor(undefined)).toBe(false)
  })
})

describe('toReviewRow', () => {
  it('includes a new row by default', () => {
    expect(toReviewRow(row())).toMatchObject({ decidable: true, included: true, marker: null, title: 'Cafe', amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z' })
  })

  it.each(['duplicate', 'possible_duplicate'] as const)('marks a %s row and excludes it by default', (status) => {
    expect(toReviewRow(row({ status, decision: 'skip' }))).toMatchObject({ decidable: true, included: false, marker: status })
    // An undecided row takes the default too: a duplicate is skipped unless the person includes it.
    expect(toReviewRow(row({ status, decision: null }))).toMatchObject({ included: false })
  })

  it('includes a duplicate the person chose to import', () => {
    expect(toReviewRow(row({ status: 'duplicate', decision: 'import' }))).toMatchObject({ included: true, marker: 'duplicate' })
  })

  it('never offers an unreadable row, and shows why it was not read', () => {
    expect(toReviewRow(row({ status: 'invalid', decision: null, normalized: null, error: 'Bad date' }))).toEqual({
      id: 1, sourceRow: 2, title: null, amount: null, currency: null, date: null, status: 'invalid', marker: 'invalid', decidable: false, included: false, error: 'Bad date',
    })
  })

  it('falls back from the merchant to the description', () => {
    expect(toReviewRow(row({ normalized: { amount: 1, date: '2026-11-03', description: 'Transfer' } })).title).toBe('Transfer')
    expect(toReviewRow(row({ normalized: { amount: 1, date: '2026-11-03', description: '  ' } })).title).toBeNull()
  })

  it.each(['imported', 'skipped', 'failed', 'unknown'] as const)('shows a %s row as not decidable', (status) => {
    expect(toReviewRow(row({ status }))).toMatchObject({ decidable: false, included: false })
  })
})

describe('filterOptions', () => {
  it('offers all, then each reviewable status that has rows, with counts', () => {
    expect(filterOptions({ ...counts, new: 3, duplicate: 2, imported: 1 }, 'all')).toEqual([
      { value: 'all', count: 6 },
      { value: 'new', count: 3 },
      { value: 'duplicate', count: 2 },
    ])
  })

  it('keeps the current filter even when it emptied', () => {
    expect(filterOptions({ ...counts, new: 1 }, 'possible_duplicate').map((option) => option.value)).toEqual(['all', 'new', 'possible_duplicate'])
  })
})

describe('pageCount', () => {
  it('has at least one page', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(50, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
  })
})

describe('dateOrderPrompt', () => {
  it('asks when a QIF file did not say which order its dates are in', () => {
    expect(dateOrderPrompt(session({ warnings: [{ code: 'date_order_ambiguous', detail: 'month-first' }] }))).toBe('month-first')
    expect(dateOrderPrompt(session({ warnings: [{ code: 'date_order_ambiguous' }] }))).toBe('day-first')
    expect(dateOrderPrompt(session({ warnings: [{ code: 'date_order_conflict' }] }))).toBe('day-first')
    expect(dateOrderPrompt(session({ warnings: [{ code: 'other' }] }))).toBeNull()
  })
})

describe('account mapping', () => {
  const sourceAccounts = [{ label: 'Checking', rowCount: 3 }, { label: 'DE89370400440532013000', rowCount: 1, suggestedAccountId: 9 }]

  it('pre-fills a suggested account, keeping what was saved', () => {
    expect(initialAccountMapping(session({ sourceAccounts, accountMapping: { Checking: 7 } }))).toEqual({ Checking: 7, DE89370400440532013000: 9 })
  })

  it('is complete once every account in the file has a target', () => {
    const mapped = session({ sourceAccounts })
    expect(isMappingComplete(mapped, { Checking: 7 })).toBe(false)
    expect(isMappingComplete(mapped, { Checking: 7, DE89370400440532013000: 9 })).toBe(true)
  })
})

describe('applyRowDecisions', () => {
  const view = {
    rows: { items: [row({ id: 1 }), row({ id: 2, status: 'duplicate', decision: 'skip' }), row({ id: 3, status: 'invalid', decision: null, normalized: null })], page: 1, pageSize: 50, total: 3 },
    session: session({ decisions: { import: 1, skip: 1 } }),
  }

  it('includes a duplicate and moves it to the import count', () => {
    const next = applyRowDecisions(view, [2], 'import')
    expect(next.rows.items.map((item) => item.decision)).toEqual(['import', 'import', null])
    expect(next.session.decisions).toEqual({ import: 2, skip: 0 })
  })

  it('skips a new row', () => {
    expect(applyRowDecisions(view, [1], 'skip').session.decisions).toEqual({ import: 0, skip: 2 })
  })

  it('leaves an unreadable row and an unchanged decision alone', () => {
    expect(applyRowDecisions(view, [3], 'import')).toBe(view)
    expect(applyRowDecisions(view, [1], 'import').session.decisions).toEqual({ import: 1, skip: 1 })
  })
})
