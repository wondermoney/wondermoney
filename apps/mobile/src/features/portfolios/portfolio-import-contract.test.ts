import {
  createConfirmPortfolioImportAssetGroupsEndpoint,
  createConfirmPortfolioImportColumnMappingEndpoint,
  createConfirmPortfolioImportSessionEndpoint,
  createPortfolioImportPreviewEndpoint,
  createPortfolioImportSessionEndpoint,
  createSuggestPortfolioImportColumnMappingEndpoint,
  createTriggerPortfolioImportParseEndpoint,
  portfolioImportAssetGroupMappingWriteSchema,
  portfolioImportAssetGroupResolutionSchema,
  portfolioImportColumnMappingWriteSchema,
  portfolioImportPreviewResponseSchema,
  portfolioImportSessionCreateResponseSchema,
} from './portfolio-import-contract'

describe('portfolio import session endpoints', () => {
  it('builds the exact create/parse/mapping/confirm/preview paths', () => {
    expect(createPortfolioImportSessionEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/portfolio/7/import-sessions', successStatuses: [201] })
    expect(() => createPortfolioImportSessionEndpoint(0)).toThrow()
    expect(createTriggerPortfolioImportParseEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/parse', successStatuses: [202] })
    expect(createSuggestPortfolioImportColumnMappingEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/column-mapping/suggest', successStatuses: [200] })
    expect(createConfirmPortfolioImportColumnMappingEndpoint(41)).toMatchObject({ method: 'PATCH', path: '/v1/portfolio-import-sessions/41/column-mapping', successStatuses: [200] })
    expect(createConfirmPortfolioImportSessionEndpoint(41)).toMatchObject({ method: 'POST', path: '/v1/portfolio-import-sessions/41/confirm', successStatuses: [202] })
    expect(createPortfolioImportPreviewEndpoint(41)).toMatchObject({ method: 'GET', path: '/v1/portfolio-import-sessions/41?limit=25' })
    expect(() => createTriggerPortfolioImportParseEndpoint(0)).toThrow()
  })

  it('parses the session-create response, requiring a PUT presigned URL with no form fields', () => {
    const response = {
      correlationId: 'c1', importSessionId: 41, maxUploadSizeBytes: 26_214_400, s3Bucket: 'b', s3Key: 'k',
      status: 'waiting_for_upload', uploadHeaders: { 'Content-Type': 'text/csv' }, uploadMethod: 'PUT', uploadUrl: 'https://s3.example/upload',
    }
    expect(portfolioImportSessionCreateResponseSchema.parse(response)).toEqual(response)
    expect(portfolioImportSessionCreateResponseSchema.safeParse({ ...response, uploadMethod: 'POST' }).success).toBe(false)
    expect(portfolioImportSessionCreateResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false)
  })

  it('requires a non-empty column mapping to submit', () => {
    expect(portfolioImportColumnMappingWriteSchema.parse({ columnMapping: { transactionDate: 'Date' } })).toEqual({ columnMapping: { transactionDate: 'Date' } })
    expect(portfolioImportColumnMappingWriteSchema.safeParse({ columnMapping: { unknownField: 'x' } }).success).toBe(false)
  })

  it('parses a full preview response bucketed by row status', () => {
    const row = { id: 1, raw: { Date: '2026-07-01' }, rowNumber: 1, status: 'ready' as const }
    const response = {
      assetGroups: [],
      importSessionId: 41,
      limits: { rowsPerBucket: 25 },
      portfolioId: 7,
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [row] },
      status: 'ready_to_import' as const,
      summary: {
        blockingRows: 0, canConfirm: true, duplicateRows: 0, failedRows: 0, importableRows: 1, importedRows: 0,
        invalidRows: 0, needsAssetReviewRows: 0, readyRows: 1, skippedRows: 0, totalRows: 1,
      },
    }
    expect(portfolioImportPreviewResponseSchema.parse(response)).toEqual(response)
    expect(portfolioImportPreviewResponseSchema.safeParse({ ...response, status: 'not-a-real-status' }).success).toBe(false)
  })

  it('parses a full preview response with structured asset groups', () => {
    const response = {
      assetGroups: [
        { candidates: [{ financialAssetId: 9, symbol: 'AAPL' }], id: 1, rowCount: 2, status: 'ambiguous' as const },
        { candidates: [], id: 2, rowCount: 1, status: 'unmatched' as const },
      ],
      importSessionId: 41,
      limits: { rowsPerBucket: 25 },
      portfolioId: 7,
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] },
      status: 'needs_asset_review' as const,
      summary: {
        assetGroups: { ambiguousGroups: 1, matchedGroups: 0, providerErrorGroups: 0, totalGroups: 2, unmatchedGroups: 1 },
        blockingRows: 3, canConfirm: false, duplicateRows: 0, failedRows: 0, importableRows: 0, importedRows: 0,
        invalidRows: 0, needsAssetReviewRows: 3, readyRows: 0, skippedRows: 0, totalRows: 3,
      },
    }
    expect(portfolioImportPreviewResponseSchema.parse(response).assetGroups).toHaveLength(2)
    expect(portfolioImportPreviewResponseSchema.safeParse({
      ...response,
      assetGroups: [{ id: 1, rowCount: 1, status: 'not-a-real-status' }],
    }).success).toBe(false)
  })

  it('accepts each asset-group resolution kind and rejects an unknown one', () => {
    expect(portfolioImportAssetGroupResolutionSchema.parse({ financialAssetId: 9, type: 'match' })).toEqual({ financialAssetId: 9, type: 'match' })
    expect(portfolioImportAssetGroupResolutionSchema.parse({ symbol: 'AAPL', type: 'external_symbol' })).toEqual({ symbol: 'AAPL', type: 'external_symbol' })
    expect(portfolioImportAssetGroupResolutionSchema.parse({ type: 'skip' })).toEqual({ type: 'skip' })
    expect(portfolioImportAssetGroupResolutionSchema.safeParse({ type: 'delete' }).success).toBe(false)
  })

  it('requires at least one mapping to confirm asset groups, and builds the exact endpoint path', () => {
    expect(portfolioImportAssetGroupMappingWriteSchema.safeParse({ mappings: [] }).success).toBe(false)
    expect(portfolioImportAssetGroupMappingWriteSchema.parse({
      mappings: [{ assetGroupId: 1, resolution: { type: 'skip' } }],
    })).toEqual({ mappings: [{ assetGroupId: 1, resolution: { type: 'skip' } }] })
    expect(createConfirmPortfolioImportAssetGroupsEndpoint(41)).toMatchObject({ method: 'PATCH', path: '/v1/portfolio-import-sessions/41/asset-groups', successStatuses: [200] })
    expect(() => createConfirmPortfolioImportAssetGroupsEndpoint(0)).toThrow()
  })
})
