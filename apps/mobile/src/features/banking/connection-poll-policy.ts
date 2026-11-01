/**
 * Mobile has no push/webhook signal for when a bank connection
 * finishes syncing, so while any connection reads `processing`
 * we poll `GET /v1/banking/connections` on a fixed interval. Bounded: once a
 * connection has read `processing` for longer than the timeout, polling
 * stops and the screen falls back to the manual pull-to-refresh affordance
 * rather than draining battery/data indefinitely.
 */
export const PROCESSING_POLL_INTERVAL_MS = 15_000
export const PROCESSING_POLL_TIMEOUT_MS = 3 * 60_000

export function resolveConnectionsPollIntervalMs(
  rows: readonly { status: string }[] | undefined,
  processingSinceMs: number | null,
  nowMs: number,
): number | false {
  if (!rows || !rows.some((row) => row.status === 'processing')) return false
  if (processingSinceMs !== null && nowMs - processingSinceMs > PROCESSING_POLL_TIMEOUT_MS) return false
  return PROCESSING_POLL_INTERVAL_MS
}
