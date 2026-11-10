import type { BankAlertDto } from './bank-alerts-contract'

/** What the Home banner shows: the most urgent alert, how many more there are, and every id it covers. */
export type BankAlertBannerModel = Readonly<{
  primary: BankAlertDto
  moreCount: number
  /** The ids a dismiss hides: every alert the banner stands for. */
  ids: readonly string[]
}>

/**
 * Urgency rank: access the bank already ended first, then consent ending
 * within a day, then a failing sync, then consent ending later. Within a rank
 * the sooner end or the older failure comes first, and the id breaks ties so
 * the order is stable between renders.
 */
function rank(alert: BankAlertDto): number {
  switch (alert.kind) {
    case 'consent_revoked': return 0
    case 'consent_expiring': return alert.daysUntilExpiry !== null && alert.daysUntilExpiry <= 1 ? 1 : 3
    case 'sync_failing': return 2
  }
}

const UNKNOWN_LAST = Number.MAX_SAFE_INTEGER

const timeOf = (iso: string | null): number => {
  const time = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(time) ? UNKNOWN_LAST : time
}

function compareAlerts(a: BankAlertDto, b: BankAlertDto): number {
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  if (a.kind === 'consent_expiring' && b.kind === 'consent_expiring') {
    const byDays = (a.daysUntilExpiry ?? UNKNOWN_LAST) - (b.daysUntilExpiry ?? UNKNOWN_LAST)
    if (byDays !== 0) return byDays
  }
  if (a.kind === 'sync_failing' && b.kind === 'sync_failing') {
    const bySince = timeOf(a.failingSince) - timeOf(b.failingSince)
    if (bySince !== 0) return bySince
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Orders the alerts most urgent first. */
export function orderBankAlerts(alerts: readonly BankAlertDto[]): BankAlertDto[] {
  return [...alerts].sort(compareAlerts)
}

/** The banner for the alerts not yet dismissed, or null when there is nothing to show. */
export function selectBankAlertBanner(
  alerts: readonly BankAlertDto[],
  dismissedIds: ReadonlySet<string>,
): BankAlertBannerModel | null {
  const visible = orderBankAlerts(alerts.filter((alert) => !dismissedIds.has(alert.id)))
  const [primary] = visible
  if (!primary) return null
  return { primary, moreCount: visible.length - 1, ids: visible.map((alert) => alert.id) }
}

/** Upper bound on remembered dismissals, so the stored value stays small. */
export const MAX_REMEMBERED_DISMISSALS = 50

/**
 * The dismissed ids to remember after dismissing `dismissing`: those, plus
 * earlier dismissals that still match a current alert. Ids the server no
 * longer returns are forgotten, since an episode id doesn't come back once
 * the episode ends.
 */
export function nextDismissedIds(
  remembered: ReadonlySet<string>,
  dismissing: readonly string[],
  currentIds: readonly string[],
): string[] {
  const current = new Set(currentIds)
  const fresh = new Set(dismissing)
  const kept = [...remembered].filter((id) => current.has(id) && !fresh.has(id))
  return [...fresh, ...kept].slice(0, MAX_REMEMBERED_DISMISSALS)
}

/** Reads a stored dismissal list; anything unreadable is an empty list. */
export function parseDismissedIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
  } catch {
    return []
  }
}
