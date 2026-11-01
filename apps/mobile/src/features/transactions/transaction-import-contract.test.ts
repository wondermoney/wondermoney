import {
  createBackgroundOperationEndpoint,
  createStartTransactionImportEndpoint,
  createTransactionImportUploadEndpoint,
  isTerminalTransactionImportStatus,
  readImportRowCounts,
} from './transaction-import-contract'

describe('isTerminalTransactionImportStatus', () => {
  it.each(['succeeded', 'partial', 'failed', 'needs_action', 'stale'])('treats %s as terminal', (status) => {
    expect(isTerminalTransactionImportStatus(status)).toBe(true)
  })

  it.each(['queued', 'running', 'unknown'])('treats %s as not terminal', (status) => {
    expect(isTerminalTransactionImportStatus(status)).toBe(false)
  })
})

describe('transaction import responses', () => {
  it('strip fields the API adds', () => {
    expect(createTransactionImportUploadEndpoint(7).schema.parse({ key: 'k', presignedUrl: 'https://s3.example/u', isSupportedBank: true, bankName: 'X' })).toEqual({ key: 'k', presignedUrl: 'https://s3.example/u', isSupportedBank: true })
    expect(createStartTransactionImportEndpoint(7).schema.parse({ correlationId: 'c', status: 'queued', queuedAt: 'now' })).toEqual({ correlationId: 'c', status: 'queued' })
    expect(createBackgroundOperationEndpoint('c').schema.parse({ correlationId: 'c', status: 'running', progress: null, startedAt: 'now' })).toEqual({ correlationId: 'c', status: 'running', progress: null })
  })
})

describe('the upload response csvImportFormat', () => {
  const parse = (body: Record<string, unknown>) => createTransactionImportUploadEndpoint(7).schema.parse({ key: 'k', presignedUrl: 'https://s3.example/u', isSupportedBank: false, ...body })

  it.each(['bank', 'generic'] as const)('keeps the known format %s', (format) => {
    expect(parse({ csvImportFormat: format }).csvImportFormat).toBe(format)
  })

  it('reads a format this build does not know as unknown instead of failing the response', () => {
    expect(parse({ csvImportFormat: 'bank_v2' }).csvImportFormat).toBe('unknown')
  })

  it('accepts a response from an API that does not send the field', () => {
    expect(parse({}).csvImportFormat).toBeUndefined()
  })
})

describe('readImportRowCounts', () => {
  it('reads the failed and total row counts the worker reports', () => {
    expect(readImportRowCounts({ imported: 1, failed: 1, totalRows: 2 })).toEqual({ failed: 1, total: 2 })
  })

  it.each([
    ['no progress', null],
    ['missing totals', { failed: 1 }],
    ['non-numeric counts', { failed: '1', totalRows: '2' }],
    ['negative counts', { failed: -1, totalRows: 2 }],
  ])('returns null for %s', (_label, progress) => {
    expect(readImportRowCounts(progress as Record<string, unknown> | null)).toBeNull()
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
