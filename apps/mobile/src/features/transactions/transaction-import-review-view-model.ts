import type {
  KnownTransactionImportRowStatus,
  TransactionImportDecision,
  TransactionImportRowDto,
  TransactionImportRowStatus,
  TransactionImportSessionDto,
  TransactionImportViewDto,
} from './transaction-import-contract'

/*
 * The review step of a staged import, as web's TransactionImportReview reads it: which stage the
 * session is at, how each row shows, and what the person may decide. The rules are web's (and the
 * API's, `packages/shared/lib/import/review.ts`): a new row imports, a duplicate or a near match is
 * skipped unless the person includes it, an unreadable row never imports.
 */

/** Rows per page, as on web. */
export const REVIEW_PAGE_SIZE = 50

/** The filters the review offers, in order; a status with no rows is not offered. */
export const REVIEW_FILTERS = ['new', 'duplicate', 'possible_duplicate', 'invalid'] as const
export type ReviewFilter = 'all' | typeof REVIEW_FILTERS[number]

const DECIDABLE: ReadonlySet<TransactionImportRowStatus> = new Set<TransactionImportRowStatus>(['new', 'duplicate', 'possible_duplicate'])

/** Whether the person may include or skip a row: any row that reads and has not been committed. */
export const canDecideRow = (status: TransactionImportRowStatus): boolean => DECIDABLE.has(status)

/** What a row imports as unless the person says otherwise. */
export function defaultDecision(status: TransactionImportRowStatus): TransactionImportDecision | null {
  if (status === 'new') return 'import'
  if (status === 'duplicate' || status === 'possible_duplicate') return 'skip'
  return null
}

export type TransactionImportStage =
  /** The worker is reading the file; `stalled` when its job stopped and the read can be started again. */
  | Readonly<{ kind: 'reading'; stalled: boolean }>
  /** Rows await the person's decisions; `needsMapping` while an account in the file has no target. */
  | Readonly<{ kind: 'review'; needsMapping: boolean }>
  /** The commit is writing rows; `stalled` when its job stopped (asked again, it carries on). */
  | Readonly<{ kind: 'importing'; stalled: boolean; imported: number; total: number }>
  | Readonly<{ kind: 'done'; outcome: 'succeeded' | 'partial' | 'failed'; imported: number; skipped: number; failed: number; detailsDeleted: boolean }>
  /** The file could not be read (the session ended with a code). */
  | Readonly<{ kind: 'read-failed' }>
  /** Closed without a commit: it expired (after seven days) or was cancelled. */
  | Readonly<{ kind: 'expired' }>
  /**
   * A file with its own categories to map (a YNAB or Actual Budget export). The app has no category step, and a
   * commit without one would import every row uncategorised, so it does not commit it: the
   * person cancels and imports the file on the web.
   */
  | Readonly<{ kind: 'needs-web' }>
  /** A status this build does not know. */
  | Readonly<{ kind: 'unsupported' }>

export function importStage(session: TransactionImportSessionDto): TransactionImportStage {
  switch (session.status) {
    case 'waiting_for_upload':
      // The app always stages an uploaded file; no job will read one that never arrived.
      return { kind: 'reading', stalled: true }
    case 'parsing':
      return { kind: 'reading', stalled: session.canRetry }
    case 'ready':
    case 'needs_mapping':
      if (needsCategoryMapping(session)) return { kind: 'needs-web' }
      return { kind: 'review', needsMapping: session.status === 'needs_mapping' }
    case 'importing': {
      const imported = session.counts.imported
      return { kind: 'importing', stalled: session.canRetry, imported, total: imported + session.decisions.import }
    }
    case 'failed':
      // A file that could not be read ends the session with a code; a commit whose rows failed does not.
      if (session.errorCode) return { kind: 'read-failed' }
      return doneStage(session, 'failed')
    case 'succeeded':
    case 'partial':
      return doneStage(session, session.status)
    case 'cancelled':
    case 'expired':
      return { kind: 'expired' }
    default:
      return { kind: 'unsupported' }
  }
}

/** Formats whose sessions always map the file's categories (a YNAB or Actual Budget export). */
const CATEGORY_MAPPED_FORMATS: ReadonlySet<string> = new Set(['actual', 'ynab'])

const needsCategoryMapping = (session: TransactionImportSessionDto): boolean => (
  CATEGORY_MAPPED_FORMATS.has(session.format) || session.sourceCategories.length > 0
)

function doneStage(session: TransactionImportSessionDto, outcome: 'succeeded' | 'partial' | 'failed'): TransactionImportStage {
  return {
    kind: 'done',
    outcome,
    imported: session.counts.imported,
    skipped: session.counts.skipped,
    failed: session.counts.failed,
    // Seven days after a commit only the summary is kept.
    detailsDeleted: session.detailsDeletedAt !== null,
  }
}

/** An outcome the person has seen once is not resumed again. */
export const isFinishedStage = (stage: TransactionImportStage): boolean => (
  stage.kind === 'done' || stage.kind === 'read-failed' || stage.kind === 'expired'
)

/**
 * A stored session the API no longer has. An uncommitted session expires seven days after it
 * was started, and the daily sweep then deletes it: past its expiry, it expired. Gone before
 * (another sign-in, another server), the app just forgets it.
 */
export function missingSessionStage(expiresAt: string | null, now: Date): TransactionImportStage | null {
  const expiry = expiresAt === null ? Number.NaN : Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry <= now.getTime() ? { kind: 'expired' } : null
}

const POLL_MS = 2000

/** How often to read a session again: while the worker is on it, every two seconds; otherwise not (web's rule). */
export function refetchIntervalFor(session: Pick<TransactionImportSessionDto, 'canRetry' | 'status'> | undefined): false | number {
  if (!session) return false
  return (session.status === 'parsing' || session.status === 'importing') && !session.canRetry ? POLL_MS : false
}

/** A duplicate, a near match or an unreadable line is marked; so is what the commit did with a row. A new row is not. */
export type ReviewRowMarker = Exclude<TransactionImportRowStatus, 'new' | 'unknown'> | null

export type ReviewRowModel = Readonly<{
  id: number
  sourceRow: number
  /** The merchant, else the description; `null` when the line has neither (the screen says "Row n"). */
  title: string | null
  amount: number | null
  currency: string | null
  /** An ISO timestamp; its calendar day is the row's date. */
  date: string | null
  status: TransactionImportRowStatus
  marker: ReviewRowMarker
  decidable: boolean
  /** Whether the commit will write it. */
  included: boolean
  /** Why the line could not be read or written. */
  error: string | null
}>

const present = (value: string | undefined): string | null => (value && value.trim() ? value : null)

export function toReviewRow(row: TransactionImportRowDto): ReviewRowModel {
  const decidable = canDecideRow(row.status)
  return {
    id: row.id,
    sourceRow: row.sourceRow,
    title: present(row.normalized?.merchant) ?? present(row.normalized?.description),
    amount: row.normalized?.amount ?? null,
    currency: row.normalized?.currency ?? null,
    date: row.normalized?.date ?? null,
    status: row.status,
    marker: row.status === 'new' || row.status === 'unknown' ? null : row.status,
    decidable,
    included: decidable && (row.decision ?? defaultDecision(row.status)) === 'import',
    error: row.error,
  }
}

export type ReviewFilterOption = Readonly<{ value: ReviewFilter; count: number }>

/** "All", then each reviewable status that has rows (and the current one, even emptied), with its count. */
export function filterOptions(counts: Readonly<Record<KnownTransactionImportRowStatus, number>>, current: ReviewFilter): ReviewFilterOption[] {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return [
    { value: 'all', count: total },
    ...REVIEW_FILTERS.filter((filter) => filter === current || counts[filter] > 0).map((filter) => ({ value: filter, count: counts[filter] })),
  ]
}

export const isDecidableFilter = (filter: ReviewFilter): filter is Exclude<ReviewFilter, 'all' | 'invalid'> => (
  filter !== 'all' && canDecideRow(filter)
)

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize))

/**
 * A QIF file whose dates could be day first or month first: the reader read them one way and
 * asks. Returns the order it assumed, or `null` when there is nothing to ask.
 */
export function dateOrderPrompt(session: Pick<TransactionImportSessionDto, 'warnings'>): 'day-first' | 'month-first' | null {
  if (!session.warnings.some((warning) => warning.code === 'date_order_ambiguous' || warning.code === 'date_order_conflict')) return null
  return session.warnings.find((warning) => warning.code === 'date_order_ambiguous')?.detail === 'month-first' ? 'month-first' : 'day-first'
}

/** The saved mapping, with the account the server matched by the file's own identifier where none is chosen yet. */
export function initialAccountMapping(session: Pick<TransactionImportSessionDto, 'accountMapping' | 'sourceAccounts'>): Record<string, number> {
  const mapping: Record<string, number> = { ...session.accountMapping }
  for (const source of session.sourceAccounts) {
    if (mapping[source.label] === undefined && source.suggestedAccountId !== undefined) mapping[source.label] = source.suggestedAccountId
  }
  return mapping
}

export const isMappingComplete = (session: Pick<TransactionImportSessionDto, 'sourceAccounts'>, mapping: Readonly<Record<string, number | undefined>>): boolean => (
  session.sourceAccounts.every((source) => mapping[source.label] !== undefined)
)

/**
 * A row decision as it will read once the API has it: the rows' own decisions and the session's
 * import/skip counts in one cached page, so the checkbox and the commit count follow the tap at
 * once. Only decidable rows change, as on the API.
 */
export function applyRowDecisions(view: TransactionImportViewDto, rowIds: readonly number[], decision: TransactionImportDecision): TransactionImportViewDto {
  const ids = new Set(rowIds)
  let moved = 0
  const items = view.rows.items.map((row) => {
    if (!ids.has(row.id) || !canDecideRow(row.status)) return row
    const current = row.decision ?? defaultDecision(row.status)
    if (current !== decision) moved += 1
    return { ...row, decision }
  })
  if (moved === 0 && items.every((row, index) => row === view.rows.items[index])) return view
  const other: TransactionImportDecision = decision === 'import' ? 'skip' : 'import'
  const decisions = { ...view.session.decisions, [decision]: view.session.decisions[decision] + moved, [other]: Math.max(0, view.session.decisions[other] - moved) }
  return { ...view, rows: { ...view.rows, items }, session: { ...view.session, decisions } }
}
