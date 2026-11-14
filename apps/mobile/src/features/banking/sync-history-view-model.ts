import { BANK_SYNC_ERROR_ACTION_KEYS, bankSyncErrorCopy } from '@wondermoney/shared/bank-sync'

import type { BankSyncHistoryRunDto } from './sync-history-contract'

/**
 * One run as the screen renders it. The provider message is never carried: a
 * failure is reduced to the shared copy key and the one action that helps.
 */
export type BankSyncHistoryRow = Readonly<{
  accounts: null | number
  error: null | { actionKey: string; messageKey: string }
  finishedAt: null | string
  flow: null | 'initial-add' | 'scheduled-refresh'
  result: null | 'failed' | 'full_success' | 'partial'
  retryAt: null | string
  rowsCreated: null | number
  startedAt: string
}>

function asRow(run: BankSyncHistoryRunDto): BankSyncHistoryRow {
  const copy = run.errorCode ? bankSyncErrorCopy(run.errorCode) : null
  return {
    accounts: run.accounts,
    error: copy ? { actionKey: BANK_SYNC_ERROR_ACTION_KEYS[copy.action], messageKey: copy.messageKey } : null,
    finishedAt: run.finishedAt,
    flow: run.flow,
    result: run.result,
    retryAt: run.retryAt,
    rowsCreated: run.rowsCreated,
    startedAt: run.startedAt,
  }
}

export function mapBankSyncHistory(runs: readonly BankSyncHistoryRunDto[]): readonly BankSyncHistoryRow[] {
  return runs.map(asRow)
}
