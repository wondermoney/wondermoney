import type { BankConnectionRow } from '../connection-status-view-model'
import {
  isFirstBankConnection,
  resolveConnectionOutcomes,
  tallyConnections,
} from '../connection-outcome-policy'

const row = (status: BankConnectionRow['status']): BankConnectionRow => ({
  accessType: 'open_banking',
  connectionId: 1,
  dataFreshAsOf: null,
  expiresAt: null,
  institutionName: 'Test Bank',
  provider: 'GoCardless',
  status,
})

describe('tallyConnections', () => {
  it('counts settled outcomes and ignores connections still processing', () => {
    expect(tallyConnections([row('connected'), row('processing'), row('error'), row('expired')]))
      .toEqual({ connected: 1, failed: 2 })
  })

  it('carries nothing but counts, so no institution can leak through it', () => {
    expect(Object.keys(tallyConnections([row('connected')])).sort()).toEqual(['connected', 'failed'])
  })
})

describe('resolveConnectionOutcomes', () => {
  it('reports nothing on the first observation of an already-connected list', () => {
    expect(resolveConnectionOutcomes(null, { connected: 3, failed: 1 })).toEqual([])
  })

  it('reports a completion when a connection settles while the screen is open', () => {
    expect(resolveConnectionOutcomes({ connected: 0, failed: 0 }, { connected: 1, failed: 0 }))
      .toEqual(['completed'])
  })

  it('reports a failure when a connection errors or expires', () => {
    expect(resolveConnectionOutcomes({ connected: 1, failed: 0 }, { connected: 1, failed: 1 }))
      .toEqual(['failed'])
  })

  it('reports both when a poll observes one of each', () => {
    expect(resolveConnectionOutcomes({ connected: 0, failed: 0 }, { connected: 1, failed: 1 }))
      .toEqual(['completed', 'failed'])
  })

  it('stays silent while nothing changes and when a connection is removed', () => {
    expect(resolveConnectionOutcomes({ connected: 2, failed: 1 }, { connected: 2, failed: 1 })).toEqual([])
    expect(resolveConnectionOutcomes({ connected: 2, failed: 1 }, { connected: 1, failed: 0 })).toEqual([])
  })
})

describe('isFirstBankConnection', () => {
  it('is true only for a user observed at zero connections who now has one', () => {
    expect(isFirstBankConnection({ connected: 0, failed: 0 }, { connected: 1, failed: 0 })).toBe(true)
  })

  it('is false for an additional connection, a re-sync, and a first observation', () => {
    expect(isFirstBankConnection({ connected: 1, failed: 0 }, { connected: 2, failed: 0 })).toBe(false)
    expect(isFirstBankConnection({ connected: 1, failed: 0 }, { connected: 1, failed: 0 })).toBe(false)
    expect(isFirstBankConnection(null, { connected: 1, failed: 0 })).toBe(false)
  })
})
