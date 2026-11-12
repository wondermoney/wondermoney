import {
  confirmAssetMappings,
  confirmColumnMapping,
  createSession,
  previewAfterAssetMappings,
  previewAfterColumnMapping,
  previewNeedsColumnMapping,
  previewWithAssetGroups,
  suggestColumnMapping,
  triggerParse,
} from './portfolio-import-api-payloads'
import {
  columnMappingWriteFromSuggestion,
  createConfirmPortfolioImportAssetMappingsEndpoint,
  createConfirmPortfolioImportColumnMappingEndpoint,
  createConfirmPortfolioImportSessionEndpoint,
  createPortfolioImportPreviewEndpoint,
  createPortfolioImportSessionEndpoint,
  createSuggestPortfolioImportColumnMappingEndpoint,
  createTriggerPortfolioImportParseEndpoint,
  isBlockingAssetGroup,
  portfolioImportAssetMappingsWriteSchema,
  portfolioImportColumnMappingWriteSchema,
  portfolioImportPreviewResponseSchema,
  portfolioImportSessionCreateResponseSchema,
} from './portfolio-import-contract'

// The routes in apps/api/src/routes/v1/portfolio.ts and portfolio-import-session.ts.
describe('portfolio import session endpoints', () => {
  it('builds the exact create/parse/mapping/asset-mapping/confirm/preview paths', () => {
    expect(createPortfolioImportSessionEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/portfolio/7/import-sessions', successStatuses: [201] })
    expect(() => createPortfolioImportSessionEndpoint(0)).toThrow()
    expect(createTriggerPortfolioImportParseEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/parse', successStatuses: [202] })
    expect(createSuggestPortfolioImportColumnMappingEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/column-mapping/suggest', successStatuses: [200] })
    expect(createConfirmPortfolioImportColumnMappingEndpoint(41)).toMatchObject({ method: 'PATCH', path: '/v1/portfolio-import-sessions/41/column-mapping', successStatuses: [200] })
    expect(createConfirmPortfolioImportAssetMappingsEndpoint(41)).toMatchObject({ method: 'PATCH', path: '/v1/portfolio-import-sessions/41/asset-mappings', successStatuses: [200] })
    expect(createConfirmPortfolioImportSessionEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/confirm', successStatuses: [202] })
    expect(createPortfolioImportPreviewEndpoint(41)).toMatchObject({ method: 'GET', path: '/v1/portfolio-import-sessions/41?limit=25' })
    expect(() => createTriggerPortfolioImportParseEndpoint(0)).toThrow()
    expect(() => createConfirmPortfolioImportAssetMappingsEndpoint(0)).toThrow()
  })
})

describe('captured API responses', () => {
  it('parses the session-create response, requiring a PUT presigned URL with no form fields', () => {
    const parsed = portfolioImportSessionCreateResponseSchema.parse(createSession)
    expect(parsed).toMatchObject({ importSessionId: 1, status: 'waiting_for_upload', uploadMethod: 'PUT', uploadHeaders: { 'Content-Type': 'text/csv' } })
    expect(portfolioImportSessionCreateResponseSchema.safeParse({ ...createSession, uploadMethod: 'POST' }).success).toBe(false)
  })

  it('parses the parse trigger, suggest and confirm-mapping responses', () => {
    expect(createTriggerPortfolioImportParseEndpoint(1).schema.parse(triggerParse)).toMatchObject({ importSessionId: 1, status: 'parsing' })
    expect(createSuggestPortfolioImportColumnMappingEndpoint(1).schema.parse(suggestColumnMapping)).toMatchObject({
      columnMapping: { columnMapping: { ticker: 'Symbol', transactionDate: 'Date' }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 } },
      mappingSource: 'local_heuristic',
      status: 'needs_column_mapping',
    })
    expect(createConfirmPortfolioImportColumnMappingEndpoint(1).schema.parse(confirmColumnMapping)).toMatchObject({ importSessionId: 1, status: 'needs_asset_review' })
  })

  it('parses every captured preview, nulls from empty columns included', () => {
    for (const preview of [previewNeedsColumnMapping, previewAfterColumnMapping, previewWithAssetGroups, previewAfterAssetMappings]) {
      const result = portfolioImportPreviewResponseSchema.safeParse(preview)
      expect(result.error).toBeUndefined()
    }
    const parsed = portfolioImportPreviewResponseSchema.parse(previewWithAssetGroups)
    expect(parsed.rows.invalid[0]).toMatchObject({ failureReason: 'Quantity is required', internalTransactionId: null, skipReason: null })
  })

  it('reads asset groups as the preview service builds them', () => {
    const { assetGroups } = portfolioImportPreviewResponseSchema.parse(previewWithAssetGroups)
    expect(assetGroups.map((group) => [group.id, group.status])).toEqual([[1, 'ambiguous'], [2, 'unmatched'], [3, 'provider_error'], [4, 'matched']])
    const [ambiguous, unmatched] = assetGroups
    expect(ambiguous).toMatchObject({
      identity: { brokerAssetName: 'Example Fund', brokerExchange: 'XAMS', brokerTicker: 'EXF', currency: 'EUR', isin: 'NL0000000001' },
      recommendedCandidateId: 1,
    })
    expect(ambiguous?.candidates.map((candidate) => [candidate.id, candidate.symbol])).toEqual([[1, 'EXF.AS'], [2, 'EXF.DE'], [3, null]])
    // The API leaves `candidates` out for a group the provider found nothing for.
    expect(unmatched?.candidates).toEqual([])
    expect(assetGroups.filter(isBlockingAssetGroup).map((group) => group.id)).toEqual([1, 2, 3])
  })

  it('reads resolved groups as selected or skipped, so they leave the review', () => {
    const { assetGroups } = portfolioImportPreviewResponseSchema.parse(previewAfterAssetMappings)
    expect(assetGroups.map((group) => [group.id, group.status])).toEqual([[1, 'ambiguous'], [4, 'matched'], [3, 'selected'], [2, 'skipped']])
    expect(assetGroups.filter(isBlockingAssetGroup).map((group) => group.id)).toEqual([1])
    expect(createConfirmPortfolioImportAssetMappingsEndpoint(1).schema.parse(confirmAssetMappings)).toEqual({ importSessionId: 1, status: 'needs_asset_review' })
  })

  it('keeps parsing a preview when the API adds fields or statuses this build does not know', () => {
    const parsed = portfolioImportPreviewResponseSchema.parse({
      ...previewWithAssetGroups,
      assetGroups: [{ ...previewWithAssetGroups.assetGroups[0], status: 'pending_provider', extra: true }],
      importType: 'positions',
      rows: { ...previewWithAssetGroups.rows, quarantined: [] },
      status: 'awaiting_approval',
      summary: { ...previewWithAssetGroups.summary, terminalKind: 'rolled_back' },
    })
    expect(parsed.status).toBe('unknown')
    expect(parsed.assetGroups[0]?.status).toBe('unknown')
    expect(parsed.assetGroups.filter(isBlockingAssetGroup)).toEqual([])
    expect(parsed.summary.terminalKind).toBe('unknown')
    expect(parsed).not.toHaveProperty('importType')
  })

  it('parses a preview from an API without the failed bucket', () => {
    const { failed: _omitted, ...rowsWithoutFailed } = previewWithAssetGroups.rows
    expect(portfolioImportPreviewResponseSchema.safeParse({ ...previewWithAssetGroups, rows: rowsWithoutFailed }).success).toBe(true)
  })
})

describe('column-mapping confirm body', () => {
  it('relays the whole suggestion in the shape the confirm route accepts', () => {
    const { columnMapping } = createSuggestPortfolioImportColumnMappingEndpoint(1).schema.parse(suggestColumnMapping)
    expect(columnMappingWriteFromSuggestion(columnMapping!)).toEqual({
      columnMapping: { currency: 'Currency', isin: 'ISIN', quantity: 'Quantity', ticker: 'Symbol', transactionDate: 'Date', transactionType: 'Type', unitPrice: 'Price' },
      derivedValues: {},
      fixedValues: {},
      layout: { dataStartRowIndex: 1, headerRowIndex: 0 },
      transformations: {},
    })
  })

  it('carries inferred values and transformations, drops keys this build does not know and nulls', () => {
    const { columnMapping } = createSuggestPortfolioImportColumnMappingEndpoint(1).schema.parse({
      ...suggestColumnMapping,
      columnMapping: {
        ...suggestColumnMapping.columnMapping,
        columnMapping: { ...suggestColumnMapping.columnMapping.columnMapping, currency: null, settlementCurrency: 'Ccy' },
        fixedValues: { currency: 'EUR' },
        newSection: { anything: true },
        transformations: { dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', thousandsSeparator: null },
      },
    })
    const body = columnMappingWriteFromSuggestion(columnMapping!)
    expect(body.fixedValues).toEqual({ currency: 'EUR' })
    expect(body.transformations).toEqual({ dateFormat: 'dd/MM/yyyy', decimalSeparator: ',' })
    expect(body.columnMapping).not.toHaveProperty('settlementCurrency')
    expect(body.columnMapping.currency).toBeUndefined()
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('newSection')
  })

  it('rejects keys the confirm route does not accept', () => {
    expect(portfolioImportColumnMappingWriteSchema.parse({ columnMapping: { transactionDate: 'Date' } })).toEqual({ columnMapping: { transactionDate: 'Date' } })
    expect(portfolioImportColumnMappingWriteSchema.safeParse({ columnMapping: { unknownField: 'x' } }).success).toBe(false)
    // What the app used to send: the whole suggestion nested as the column mapping. The API answers 400.
    expect(portfolioImportColumnMappingWriteSchema.safeParse({ columnMapping: suggestColumnMapping.columnMapping }).success).toBe(false)
  })
})

describe('asset-mapping decisions', () => {
  it('accepts each decision the API accepts', () => {
    const decisions = [
      { action: 'use_candidate', candidateId: 1, groupId: 1 },
      { action: 'use_external_symbol', groupId: 2, symbol: 'EXF.AS' },
      { action: 'use_existing_asset', financialAssetId: 9, groupId: 3 },
      { action: 'skip_group', groupId: 4 },
      { action: 'skip_group', groupId: 5, skipReason: 'Not mine' },
    ]
    expect(portfolioImportAssetMappingsWriteSchema.parse({ decisions })).toEqual({ decisions })
  })

  it('rejects what the API rejects: the old body, empty, over 100, duplicates, bad symbols', () => {
    const skip = (groupId: number) => ({ action: 'skip_group', groupId })
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ mappings: [{ assetGroupId: 1, resolution: { type: 'skip' } }] }).success).toBe(false)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: [] }).success).toBe(false)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: Array.from({ length: 100 }, (_, index) => skip(index + 1)) }).success).toBe(true)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: Array.from({ length: 101 }, (_, index) => skip(index + 1)) }).success).toBe(false)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: [skip(1), skip(1)] }).success).toBe(false)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: [{ action: 'use_external_symbol', groupId: 1, symbol: '$$$' }] }).success).toBe(false)
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: [{ action: 'use_candidate', groupId: 1 }] }).success).toBe(false)
  })
})
