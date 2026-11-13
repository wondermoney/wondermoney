import { bankSyncHistoryKey } from '../query-keys'
import { bankSyncHistoryResponseSchema, createBankSyncHistoryEndpoint } from '../sync-history-contract'

describe('bank sync history contract', () => {
  it('reads an Enable Banking connection from the shared connections route', () => {
    const endpoint = createBankSyncHistoryEndpoint(42)
    expect(endpoint).toMatchObject({ method: 'GET', path: '/v1/banking/connections/42/syncs' })
    expect(endpoint.schema).toBe(bankSyncHistoryResponseSchema)
    expect(createBankSyncHistoryEndpoint(42, 'EnableBanking').path).toBe('/v1/banking/connections/42/syncs')
  })

  it('reads a SimpleFIN connection from its own route, with the same run shape', () => {
    const endpoint = createBankSyncHistoryEndpoint(42, 'SimpleFIN')
    expect(endpoint).toMatchObject({ method: 'GET', path: '/v1/banking/simplefin/connections/42/syncs' })
    expect(endpoint.schema).toBe(bankSyncHistoryResponseSchema)
  })

  it('refuses an invalid connection id', () => {
    expect(() => createBankSyncHistoryEndpoint(0, 'SimpleFIN')).toThrow()
  })

  it('caches the two id spaces apart', () => {
    expect(bankSyncHistoryKey(1, 42, 'SimpleFIN')).not.toEqual(bankSyncHistoryKey(1, 42, 'EnableBanking'))
    expect(bankSyncHistoryKey(1, 42)).toEqual(bankSyncHistoryKey(1, 42, 'EnableBanking'))
  })
})
