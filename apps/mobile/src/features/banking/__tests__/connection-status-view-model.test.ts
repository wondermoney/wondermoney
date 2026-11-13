import type { BankConnectionDto } from '../connection-status-contract'
import { mapBankConnections } from '../connection-status-view-model'

const dto = (over: Partial<BankConnectionDto> = {}): BankConnectionDto => ({
  accessType: 'open_banking',
  dataFreshAsOf: '2026-07-30T10:00:00.000Z',
  expiresAt: '2026-08-30T12:00:00.000Z',
  institutionName: 'Real Bank',
  provider: 'GoCardless',
  status: 'connected',
  ...over,
})

describe('mapBankConnections', () => {
  it('returns the same rows the contract returned (no enrichment)', () => {
    const rows = mapBankConnections([
      dto(),
      dto({ status: 'error', institutionName: null }),
    ])
    expect(rows).toEqual([
      {
        accessType: 'open_banking',
        accountNames: null,
        bankId: null,
        connectionId: null,
        dataFreshAsOf: '2026-07-30T10:00:00.000Z',
        daysUntilExpiry: null,
        expiresAt: '2026-08-30T12:00:00.000Z',
        institutionName: 'Real Bank',
        lastError: null,
        provider: 'GoCardless',
        status: 'connected',
      },
      {
        accessType: 'open_banking',
        accountNames: null,
        bankId: null,
        connectionId: null,
        dataFreshAsOf: '2026-07-30T10:00:00.000Z',
        daysUntilExpiry: null,
        expiresAt: '2026-08-30T12:00:00.000Z',
        institutionName: null,
        lastError: null,
        provider: 'GoCardless',
        status: 'error',
      },
    ])
  })

  it('carries the reconnect bank id and days left when the API sends them', () => {
    const [row] = mapBankConnections([dto({ bankId: 'UFQ6OlRlc3Q', daysUntilExpiry: 9, status: 'expiring' })])
    expect(row).toMatchObject({ bankId: 'UFQ6OlRlc3Q', daysUntilExpiry: 9, status: 'expiring' })
  })

  it('returns an empty list when the response is empty', () => {
    expect(mapBankConnections([])).toEqual([])
  })

  it('normalizes an undefined connectionId to null when the server omits the field', () => {
    const [row] = mapBankConnections([dto()])
    expect(row!.connectionId).toBeNull()
  })

  it('passes through a real connectionId untouched', () => {
    const [row] = mapBankConnections([dto({ connectionId: 42 })])
    expect(row!.connectionId).toBe(42)
  })

  it('normalizes an explicit null connectionId to null', () => {
    const [row] = mapBankConnections([dto({ connectionId: null })])
    expect(row!.connectionId).toBeNull()
  })

  it("names a SimpleFIN connection's accounts, leaving blank names out", () => {
    const [row] = mapBankConnections([dto({
      provider: 'SimpleFIN',
      accounts: [{ accountKey: 3, accountName: ' Everyday checking ' }, { accountKey: 4, accountName: null }, { accountKey: 5, accountName: '  ' }, { accountKey: 6, accountName: 'Savings' }],
    })])
    expect(row!.accountNames).toEqual(['Everyday checking', 'Savings'])
  })

  it('reads an empty account list as no accounts yet, and a missing one (an older API) as unknown', () => {
    const [none] = mapBankConnections([dto({ provider: 'SimpleFIN', accounts: [] })])
    expect(none!.accountNames).toEqual([])
    const [older] = mapBankConnections([dto({ provider: 'SimpleFIN' })])
    expect(older!.accountNames).toBeNull()
  })

  it('carries the newest failure so the row can say what went wrong', () => {
    const [row] = mapBankConnections([dto({ lastError: { code: 'rate_limited', occurredAt: '2026-07-30T10:00:00.000Z' } })])
    expect(row!.lastError).toEqual({ code: 'rate_limited', occurredAt: '2026-07-30T10:00:00.000Z' })
  })
})
