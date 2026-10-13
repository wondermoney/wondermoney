import {
  createBackgroundOperationEndpoint,
  createStartTransactionImportEndpoint,
  createTransactionImportUploadEndpoint,
  isTerminalTransactionImportStatus,
} from './transaction-import-contract'

describe('isTerminalTransactionImportStatus', () => {
  it.each(['succeeded', 'partial', 'failed', 'needs_action', 'stale'])('treats %s as terminal', (status) => {
    expect(isTerminalTransactionImportStatus(status)).toBe(true)
  })

  it.each(['queued', 'running', 'unknown'])('treats %s as not terminal', (status) => {
    expect(isTerminalTransactionImportStatus(status)).toBe(false)
  })
})

describe('createTransactionImportUploadEndpoint', () => {
  it('builds the per-account presigned-upload POST path', () => {
    const endpoint = createTransactionImportUploadEndpoint(7)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/account/7/transaction/upload')
  })

  it.each([0, -1, 1.5])('rejects a non-positive or non-integer account id (%s)', (accountId) => {
    expect(() => createTransactionImportUploadEndpoint(accountId)).toThrow()
  })
})

describe('createStartTransactionImportEndpoint', () => {
  it('builds the per-account import-start POST path', () => {
    const endpoint = createStartTransactionImportEndpoint(7)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/account/7/transaction/import')
  })

  it('rejects a non-positive account id', () => {
    expect(() => createStartTransactionImportEndpoint(0)).toThrow()
  })
})

describe('createBackgroundOperationEndpoint', () => {
  it('builds the operation-status GET path with the correlation id encoded', () => {
    const endpoint = createBackgroundOperationEndpoint('abc 123')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/operations/abc%20123')
  })

  it('rejects an empty or blank correlation id', () => {
    expect(() => createBackgroundOperationEndpoint('')).toThrow()
    expect(() => createBackgroundOperationEndpoint('   ')).toThrow()
  })
})
