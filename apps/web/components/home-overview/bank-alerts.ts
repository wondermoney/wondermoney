import type { BankingAlert } from "@/lib/api/banking/useBankingAlerts";

/** localStorage key holding the JSON array of dismissed alert ids. */
export const BANK_ALERTS_DISMISSED_KEY = "wm:bank-alerts:dismissed";

/**
 * Access already ended comes first, then access about to end (fewest days
 * left first), then syncs that keep failing (longest streak first).
 */
function urgencyRank(alert: BankingAlert): number {
  switch (alert.kind) {
    case "consent_revoked":
      return 0;
    case "consent_expiring":
      return 1;
    case "sync_failing":
      return 2;
    default:
      return 3;
  }
}

function timeOrInfinity(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareUrgency(a: BankingAlert, b: BankingAlert): number {
  const byKind = urgencyRank(a) - urgencyRank(b);
  if (byKind !== 0) return byKind;
  if (a.kind === "consent_expiring") {
    const byDays =
      (a.daysUntilExpiry ?? Number.POSITIVE_INFINITY) -
      (b.daysUntilExpiry ?? Number.POSITIVE_INFINITY);
    if (byDays !== 0 && !Number.isNaN(byDays)) return byDays;
    const byEnd = timeOrInfinity(a.expiresAt) - timeOrInfinity(b.expiresAt);
    if (byEnd !== 0 && !Number.isNaN(byEnd)) return byEnd;
  }
  if (a.kind === "sync_failing") {
    const bySince =
      timeOrInfinity(a.failingSince) - timeOrInfinity(b.failingSince);
    if (bySince !== 0 && !Number.isNaN(bySince)) return bySince;
  }
  return 0;
}

/** The alerts not yet dismissed, most urgent first. */
export function pickVisibleBankAlerts(
  alerts: readonly BankingAlert[],
  dismissedIds: ReadonlySet<string>,
): BankingAlert[] {
  return alerts
    .filter((alert) => !dismissedIds.has(alert.id))
    .sort(compareUrgency);
}

/** Reads the stored id list; anything malformed reads as nothing dismissed. */
export function parseDismissedBankAlertIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * The id list to store after dismissing `newIds`. Ids of alerts the API no
 * longer returns are dropped so the list cannot grow without bound; an
 * episode's id does not come back once it has ended.
 */
export function nextDismissedBankAlertIds(
  storedIds: readonly string[],
  newIds: readonly string[],
  currentAlertIds: readonly string[],
): string[] {
  const current = new Set(currentAlertIds);
  const kept = storedIds.filter((id) => current.has(id));
  return [...new Set([...kept, ...newIds])];
}
