import { BANK_SYNC_ERROR_ACTION_KEYS, BANK_SYNC_ERROR_COPY } from '@wondermoney/shared/bank-sync'

import type { BankSyncHistoryRunDto } from '../sync-history-contract'
import { mapBankSyncHistory } from '../sync-history-view-model'

const run = (over: Partial<BankSyncHistoryRunDto> = {}): BankSyncHistoryRunDto => ({
  accounts: 3,
  errorCode: null,
  finishedAt: '2026-07-21T10:05:00.000Z',
  flow: 'scheduled-refresh',
  result: 'full_success',
  retryAt: null,
  rowsCreated: 12,
  startedAt: '2026-07-21T10:00:00.000Z',
  ...over,
})

describe('mapBankSyncHistory', () => {
  it('keeps a successful run free of an error', () => {
    expect(mapBankSyncHistory([run()])[0]).toEqual({
      accounts: 3,
      error: null,
      finishedAt: '2026-07-21T10:05:00.000Z',
      flow: 'scheduled-refresh',
      result: 'full_success',
      retryAt: null,
      rowsCreated: 12,
      startedAt: '2026-07-21T10:00:00.000Z',
    })
  })

  it('reduces a failure to the shared copy key and its action, never the provider message', () => {
    const [row] = mapBankSyncHistory([run({ errorCode: 'rate_limited', result: 'failed' })])
    expect(row!.error).toEqual({
      actionKey: BANK_SYNC_ERROR_ACTION_KEYS.wait,
      messageKey: BANK_SYNC_ERROR_COPY.rate_limited.messageKey,
    })
  })

  it('falls back to the unknown copy for a code this build does not know', () => {
    const [row] = mapBankSyncHistory([run({ errorCode: 'a_new_provider_code', result: 'failed' })])
    expect(row!.error).toEqual({
      actionKey: BANK_SYNC_ERROR_ACTION_KEYS['contact-support'],
      messageKey: BANK_SYNC_ERROR_COPY.unknown.messageKey,
    })
  })

  it('keeps a still-running attempt with no result or error', () => {
    const [row] = mapBankSyncHistory([run({ errorCode: null, finishedAt: null, result: null })])
    expect(row).toMatchObject({ error: null, finishedAt: null, result: null })
  })
})
