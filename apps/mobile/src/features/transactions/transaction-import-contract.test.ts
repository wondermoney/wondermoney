import {
  buildCreateTransactionImportSessionBody,
  createCancelTransactionImportEndpoint,
  createCommitTransactionImportEndpoint,
  createDecideTransactionImportRowsEndpoint,
  createMapTransactionImportAccountsEndpoint,
  createParseTransactionImportEndpoint,
  createTransactionImportSessionEndpoint,
  createTransactionImportUploadEndpoint,
  importFormatForFileName,
  readTransactionImportSessionEndpoint,
} from './transaction-import-contract'

const sessionDto = {
  accountId: 7,
  accountMapping: {},
  canCommit: true,
  canRetry: false,
  committedAt: null,
  correlationId: 'transaction-import:parse:abc',
  counts: { new: 2, duplicate: 1, possible_duplicate: 0, invalid: 1, skipped: 0, imported: 0, failed: 0 },
  createdAt: '2026-11-10T10:00:00.000Z',
  decisions: { import: 2, skip: 1 },
  detailsDeletedAt: null,
  errorCode: null,
  expiresAt: '2026-11-17T10:00:00.000Z',
  fileName: 'statement.csv',
  format: 'statement',
  id: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e',
  sourceAccounts: [],
  status: 'ready',
  upload: null,
  warnings: [],
}

describe('createTransactionImportUploadEndpoint', () => {
  it('builds the per-account presigned-upload POST path', () => {
    const endpoint = createTransactionImportUploadEndpoint(7)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/account/7/transaction/upload')
  })

  it.each([0, -1, 1.5])('rejects a non-positive or non-integer account id (%s)', (accountId) => {
    expect(() => createTransactionImportUploadEndpoint(accountId)).toThrow()
  })

  it('strips fields the API adds', () => {
    expect(createTransactionImportUploadEndpoint(7).schema.parse({ key: 'k', presignedUrl: 'https://s3.example/u', isSupportedBank: true, bankName: 'X' })).toEqual({ key: 'k', presignedUrl: 'https://s3.example/u', isSupportedBank: true })
  })

  it.each(['bank', 'generic'] as const)('keeps the known format %s', (format) => {
    expect(createTransactionImportUploadEndpoint(7).schema.parse({ key: 'k', presignedUrl: 'u', isSupportedBank: false, csvImportFormat: format }).csvImportFormat).toBe(format)
  })

  it('reads a format this build does not know as unknown instead of failing the response', () => {
    expect(createTransactionImportUploadEndpoint(7).schema.parse({ key: 'k', presignedUrl: 'u', isSupportedBank: false, csvImportFormat: 'bank_v2' }).csvImportFormat).toBe('unknown')
  })
})

describe('the staged import session', () => {
  it('creates a session on the sessions collection, without committing it', () => {
    const endpoint = createTransactionImportSessionEndpoint
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/transaction-import-sessions')
    expect(buildCreateTransactionImportSessionBody({ accountId: 7, fileName: 'statement.csv', key: 'account-7-k' })).toEqual({ accountId: 7, fileName: 'statement.csv', format: 'statement', key: 'account-7-k' })
  })

  it('never asks the API to commit on its own', () => {
    const body = buildCreateTransactionImportSessionBody({ accountId: 7, fileName: 'a.ofx', key: 'k' })
    expect(body).not.toHaveProperty('autoCommit')
  })

  it('leaves out a blank file name and caps a long one at the API limit', () => {
    expect(buildCreateTransactionImportSessionBody({ accountId: 7, fileName: '  ', key: 'k' })).toEqual({ accountId: 7, format: 'statement', key: 'k' })
    expect(buildCreateTransactionImportSessionBody({ accountId: 7, fileName: 'a'.repeat(3000), key: 'k' }).fileName).toHaveLength(2048)
  })

  it.each([
    ['statement.csv', 'statement'],
    ['statement.xlsx', 'statement'],
    ['bank.OFX', 'ofx'],
    ['bank.qfx', 'ofx'],
    ['money.qif', 'qif'],
    ['camt.xml', 'camt053'],
  ])('reads %s in the format web picks for it (%s)', (name, format) => {
    expect(importFormatForFileName(name)).toBe(format)
  })

  it('reads a session and one page of its rows, by status', () => {
    const id = sessionDto.id
    expect(readTransactionImportSessionEndpoint(id, { page: 2, pageSize: 50 }).path).toBe(`/v1/transaction-import-sessions/${id}?page=2&pageSize=50`)
    expect(readTransactionImportSessionEndpoint(id, { page: 1, pageSize: 50, status: 'duplicate' }).path).toBe(`/v1/transaction-import-sessions/${id}?page=1&pageSize=50&status=duplicate`)
  })

  it.each([
    ['decide', createDecideTransactionImportRowsEndpoint, 'PATCH', 'rows'],
    ['map accounts', createMapTransactionImportAccountsEndpoint, 'PATCH', 'account-mapping'],
    ['parse', createParseTransactionImportEndpoint, 'POST', 'parse'],
    ['commit', createCommitTransactionImportEndpoint, 'POST', 'commit'],
    ['cancel', createCancelTransactionImportEndpoint, 'POST', 'cancel'],
  ] as const)('builds the %s endpoint', (_label, build, method, segment) => {
    const endpoint = build(sessionDto.id)
    expect(endpoint.method).toBe(method)
    expect(endpoint.path).toBe(`/v1/transaction-import-sessions/${sessionDto.id}/${segment}`)
  })

  it('rejects an id that is not a session id', () => {
    expect(() => readTransactionImportSessionEndpoint('../accounts', { page: 1, pageSize: 50 })).toThrow()
    expect(() => createCommitTransactionImportEndpoint('')).toThrow()
  })

  it('reads the session view and its rows', () => {
    const view = readTransactionImportSessionEndpoint(sessionDto.id, { page: 1, pageSize: 50 }).schema.parse({
      rows: {
        items: [
          { decision: 'import', error: null, id: 11, matchedTransaction: null, normalized: { amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z', description: 'Coffee', merchant: 'Cafe' }, raw: { a: 1 }, sourceRow: 2, status: 'new', targetAccountId: 7 },
          { decision: null, error: 'Bad date', id: 12, matchedTransaction: null, normalized: null, raw: {}, sourceRow: 3, status: 'invalid', targetAccountId: 7 },
        ],
        page: 1,
        pageSize: 50,
        total: 2,
      },
      session: sessionDto,
    })
    expect(view.session).toMatchObject({ id: sessionDto.id, status: 'ready', canCommit: true, decisions: { import: 2, skip: 1 }, fileName: 'statement.csv' })
    expect(view.rows.items[0]).toEqual({ decision: 'import', error: null, id: 11, normalized: { amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z', description: 'Coffee', merchant: 'Cafe' }, sourceRow: 2, status: 'new' })
    expect(view.rows.items[1]).toMatchObject({ decision: null, normalized: null, status: 'invalid', error: 'Bad date' })
  })

  it('reads a status, a row status or a decision this build does not know as unknown instead of failing', () => {
    const parsed = createCommitTransactionImportEndpoint(sessionDto.id).schema.parse({ session: { ...sessionDto, status: 'needs_category_mapping', counts: { ...sessionDto.counts, conflict: 3 } } })
    expect(parsed.session.status).toBe('unknown')
    expect(parsed.session.counts).toEqual(sessionDto.counts)
    const row = readTransactionImportSessionEndpoint(sessionDto.id, { page: 1, pageSize: 50 }).schema.parse({
      rows: { items: [{ decision: 'maybe', error: null, id: 1, normalized: null, sourceRow: 1, status: 'conflict' }], page: 1, pageSize: 50, total: 1 },
      session: sessionDto,
    }).rows.items[0]
    expect(row).toMatchObject({ decision: null, status: 'unknown' })
  })

  it('reads the categories a YNAB export asks to map, and none from an API that has no category step', () => {
    const parsed = createTransactionImportSessionEndpoint.schema.parse({ session: { ...sessionDto, format: 'ynab', sourceCategories: [{ label: 'Bills: Rent', name: 'Rent', group: 'Bills', rowCount: 2 }], categoryMapping: {} } })
    expect(parsed.session).toMatchObject({ format: 'ynab', sourceCategories: [{ label: 'Bills: Rent' }] })
    expect(createTransactionImportSessionEndpoint.schema.parse({ session: sessionDto }).session.sourceCategories).toEqual([])
  })

  it('accepts a session from an API that predates the file name and the commit summary', () => {
    const { fileName: _fileName, committedAt: _committedAt, detailsDeletedAt: _detailsDeletedAt, ...older } = sessionDto
    const parsed = createTransactionImportSessionEndpoint.schema.parse({ session: older })
    expect(parsed.session).toMatchObject({ fileName: null, committedAt: null, detailsDeletedAt: null })
  })
})
