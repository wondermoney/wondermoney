import type { BankConnectionRow } from './connection-status-view-model'

/**
 * Derives the bank-connection funnel's terminal steps from the only
 * evidence this app actually has.
 *
 * There is no app-scheme callback from bank consent (see
 * `start-connection-contract.ts`) and no push signal, so "the connection
 * finished" is never handed to us — it is observed, by the connections list
 * polling a `processing` row until it settles (`use-bank-connections.ts`). This
 * turns that polling into the two ADR-approved outcomes without inventing
 * certainty: outcomes are reported only for a *change* between two observations
 * the same screen made, so the first load of a list that already contains
 * connected rows reports nothing.
 *
 * Counts only. Institution names, connection IDs and error text are all
 * deliberately out of reach here — the ADR approves no properties on any of
 * these events.
 */
export type ConnectionOutcome = 'completed' | 'failed'

export type ConnectionTally = Readonly<{
  connected: number
  failed: number
}>

export function tallyConnections(rows: readonly BankConnectionRow[]): ConnectionTally {
  let connected = 0
  let failed = 0
  for (const row of rows) {
    if (row.status === 'connected') connected += 1
    if (row.status === 'error' || row.status === 'expired') failed += 1
  }
  return Object.freeze({ connected, failed })
}

/**
 * `previous === null` is the first observation — nothing transitioned yet, so
 * nothing is reported.
 */
export function resolveConnectionOutcomes(
  previous: ConnectionTally | null,
  next: ConnectionTally,
): readonly ConnectionOutcome[] {
  if (previous === null) return []
  const outcomes: ConnectionOutcome[] = []
  if (next.connected > previous.connected) outcomes.push('completed')
  if (next.failed > previous.failed) outcomes.push('failed')
  return outcomes
}

/**
 * A user whose very first connection just came online has, server-side, just had
 * accounts created for them by that connection — the bank-connection half of the
 * activation funnel's `first_account_created`. Requires a prior observation of
 * zero connected rows, so an existing connection re-syncing never counts.
 */
export function isFirstBankConnection(
  previous: ConnectionTally | null,
  next: ConnectionTally,
): boolean {
  if (previous === null) return false
  return previous.connected === 0 && next.connected > 0
}
