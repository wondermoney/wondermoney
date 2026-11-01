import {
  createStatementImportSessionEndpoint,
  createStatementImportStatusEndpoint,
  createTriggerStatementImportEndpoint,
  statementImportSessionCreateResponseSchema,
  statementImportSummarySchema,
} from '../statement-import-contract'

const session = {
  importSessionId: 41,
  maxUploadSizeBytes: 1000,
  status: 'waiting_for_upload',
  uploadHeaders: { 'Content-Type': 'text/csv' },
  uploadMethod: 'PUT',
  uploadUrl: 'https://s3.example/upload',
}

describe('statement-import contract', () => {
  it('accepts a full session-create response', () => {
    expect(statementImportSessionCreateResponseSchema.parse(session)).toEqual(session)
  })

  it('reads a status this build does not know as unknown, and rejects a missing or non-string one', () => {
    expect(statementImportSessionCreateResponseSchema.parse({ ...session, status: 'scanning' }).status).toBe('unknown')
    expect(statementImportSessionCreateResponseSchema.safeParse({ ...session, status: 7 }).success).toBe(false)
    const { status: _status, ...withoutStatus } = session
    expect(statementImportSessionCreateResponseSchema.safeParse(withoutStatus).success).toBe(false)
  })

  it('strips fields the API adds instead of rejecting the response', () => {
    expect(statementImportSessionCreateResponseSchema.parse({ ...session, extra: 1 })).toEqual(session)
    const summary = { duplicateRows: 0, failedRows: 0, importedRows: 3, totalRows: 3 }
    expect(statementImportSummarySchema.parse({ ...summary, skippedRows: 0 })).toEqual(summary)
  })

  it('exposes the create-session write endpoint nested under the account', () => {
    const endpoint = createStatementImportSessionEndpoint(12)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/account/12/statement-imports')
  })

  it('refuses to build a create-session endpoint for an invalid account id', () => {
    expect(() => createStatementImportSessionEndpoint(0)).toThrow()
    expect(() => createStatementImportSessionEndpoint(-1)).toThrow()
  })

  it('exposes the trigger-parse write endpoint', () => {
    const endpoint = createTriggerStatementImportEndpoint(41)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/banking/statement-imports/41/parse')
  })

  it('exposes the status read endpoint', () => {
    const endpoint = createStatementImportStatusEndpoint(41)
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/banking/statement-imports/41')
  })

  it('refuses to build session-scoped endpoints for an invalid session id', () => {
    expect(() => createTriggerStatementImportEndpoint(0)).toThrow()
    expect(() => createStatementImportStatusEndpoint(-1)).toThrow()
  })

  it('accepts a valid summary and rejects negative counts', () => {
    const summary = { duplicateRows: 1, failedRows: 0, importedRows: 9, totalRows: 10 }
    expect(statementImportSummarySchema.parse(summary)).toEqual(summary)
    expect(statementImportSummarySchema.safeParse({ ...summary, failedRows: -1 }).success).toBe(false)
  })
})
