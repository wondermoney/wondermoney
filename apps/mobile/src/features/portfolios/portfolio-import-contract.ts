import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

import { isValidPortfolioId } from './portfolios-contract'

function importSessionPath(importSessionId: number, suffix = ''): string {
  if (!Number.isSafeInteger(importSessionId) || importSessionId <= 0) throw new Error('A positive safe import session id is required.')
  return `/v1/portfolio-import-sessions/${importSessionId}${suffix}`
}

const PORTFOLIO_IMPORT_SESSION_STATUSES = [
  'cancelled', 'expired', 'failed', 'importing', 'needs_asset_review', 'needs_column_mapping',
  'parsing', 'partial', 'ready_to_import', 'succeeded', 'uploaded', 'waiting_for_upload',
] as const
// A status this build doesn't know reads as 'unknown': not in flight and not a success, so the
// flow ends on the generic processing-failed screen instead of an invalid-response error.
const importSessionStatusSchema = tolerantEnum(PORTFOLIO_IMPORT_SESSION_STATUSES, 'unknown')

export const portfolioImportSessionCreateResponseSchema = z.object({
  broker: z.object({ id: z.number().int().positive(), name: z.string() }).optional(),
  correlationId: z.string(),
  expiresAt: z.string().optional(),
  importSessionId: z.number().int().positive(),
  maxUploadSizeBytes: z.number().int().positive(),
  s3Bucket: z.string(),
  s3Key: z.string(),
  status: importSessionStatusSchema,
  uploadFields: z.undefined().optional(),
  uploadHeaders: z.record(z.string(), z.string()),
  uploadMethod: z.literal('PUT'),
  uploadUrl: z.string(),
})

export const createPortfolioImportSessionEndpoint = (portfolioId: number) => {
  if (!isValidPortfolioId(portfolioId)) throw new Error('A positive safe portfolio id is required.')
  return writeEndpoint({
    method: 'POST' as const,
    path: `/v1/portfolio/${portfolioId}/import-sessions`,
    schema: portfolioImportSessionCreateResponseSchema,
    successStatuses: [201],
  })
}

const parseTriggerResponseSchema = z.object({
  correlationId: z.string(),
  importSessionId: z.number().int().positive(),
  status: z.string(),
})

export const createTriggerPortfolioImportParseEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'POST' as const, path: importSessionPath(importSessionId, '/parse'), schema: parseTriggerResponseSchema, successStatuses: [202],
})

// The column-mapping step. The suggest route answers with a whole suggestion (the columns plus the
// layout, transformations and fixed/derived values the server inferred), and confirming relays
// all of it back. The confirm validator (validators/portfolio.ts
// confirmPortfolioImportColumnMappingRequestSchema) is strict about keys, so the suggestion is
// read key by key: a key this build does not know is dropped instead of being sent back to fail.
// Values are relayed as the server suggested them and the server validates them.
const relayedText = z.string().min(1).nullish().transform((value) => value ?? undefined)
const relayedCount = z.number().int().nonnegative().nullish().transform((value) => value ?? undefined)
const relayedFlag = z.boolean().nullish().transform((value) => value ?? undefined)

const COLUMN_MAPPING_FIELDS = [
  'assetName', 'brokerExchange', 'currency', 'externalTransactionId', 'feeAmount', 'isin',
  'quantity', 'ticker', 'totalAmount', 'transactionDate', 'transactionType', 'unitPrice',
] as const
type ColumnMappingField = (typeof COLUMN_MAPPING_FIELDS)[number]

function columnMappingShape<Schema extends z.ZodType>(field: Schema) {
  return Object.fromEntries(COLUMN_MAPPING_FIELDS.map((key) => [key, field])) as Record<ColumnMappingField, Schema>
}

export const portfolioImportColumnMappingSuggestionSchema = z.object({
  columnMapping: z.object(columnMappingShape(relayedText)),
  derivedValues: z.object({ transactionType: relayedText }).nullish(),
  fixedValues: z.object({ currency: relayedText, transactionType: relayedText }).nullish(),
  layout: z.object({
    dataStartRowIndex: relayedCount,
    footerMatchers: z.array(z.string().min(1)).nullish().transform((value) => value ?? undefined),
    footerRowCount: relayedCount,
    headerRowIndex: relayedCount,
  }).nullish(),
  transformations: z.object({
    dateFormat: relayedText,
    decimalSeparator: relayedText,
    negativeAmountMeansBuy: relayedFlag,
    quantitySignIndicatesDirection: relayedFlag,
    thousandsSeparator: relayedText,
  }).nullish(),
})
export type PortfolioImportColumnMappingSuggestionDto = z.infer<typeof portfolioImportColumnMappingSuggestionSchema>

const suggestColumnMappingResponseSchema = z.object({
  // Absent (not merely empty) when the server could not suggest a mapping at all
  // (see AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING) — JSON drops the undefined key entirely.
  columnMapping: portfolioImportColumnMappingSuggestionSchema.optional(),
  importSessionId: z.number().int().positive(),
  mappingSource: z.string().optional(),
  status: importSessionStatusSchema,
  warning: z.string().optional(),
})

export const createSuggestPortfolioImportColumnMappingEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'POST' as const, path: importSessionPath(importSessionId, '/column-mapping/suggest'), schema: suggestColumnMappingResponseSchema, successStatuses: [200],
})

const writtenText = z.string().min(1).optional()

/** The confirm body, key for key the API's strict confirmPortfolioImportColumnMappingRequestSchema. */
export const portfolioImportColumnMappingWriteSchema = z.object({
  columnMapping: z.object(columnMappingShape(writtenText)).strict(),
  derivedValues: z.object({ transactionType: writtenText }).strict().optional(),
  fixedValues: z.object({ currency: writtenText, transactionType: writtenText }).strict().optional(),
  layout: z.object({
    dataStartRowIndex: z.number().int().nonnegative().optional(),
    footerMatchers: z.array(z.string().min(1)).optional(),
    footerRowCount: z.number().int().nonnegative().optional(),
    headerRowIndex: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  transformations: z.object({
    dateFormat: writtenText,
    decimalSeparator: writtenText,
    negativeAmountMeansBuy: z.boolean().optional(),
    quantitySignIndicatesDirection: z.boolean().optional(),
    thousandsSeparator: writtenText,
  }).strict().optional(),
}).strict()
export type PortfolioImportColumnMappingWrite = z.infer<typeof portfolioImportColumnMappingWriteSchema>

/** The confirm body that accepts a server suggestion as it stands. */
export function columnMappingWriteFromSuggestion(suggestion: PortfolioImportColumnMappingSuggestionDto): PortfolioImportColumnMappingWrite {
  return portfolioImportColumnMappingWriteSchema.parse({
    columnMapping: suggestion.columnMapping,
    ...(suggestion.derivedValues ? { derivedValues: suggestion.derivedValues } : {}),
    ...(suggestion.fixedValues ? { fixedValues: suggestion.fixedValues } : {}),
    ...(suggestion.layout ? { layout: suggestion.layout } : {}),
    ...(suggestion.transformations ? { transformations: suggestion.transformations } : {}),
  })
}

const confirmColumnMappingResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: z.string(),
  summary: z.unknown(),
})

export const createConfirmPortfolioImportColumnMappingEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'PATCH' as const, path: importSessionPath(importSessionId, '/column-mapping'), schema: confirmColumnMappingResponseSchema, successStatuses: [200],
})

const confirmImportResponseSchema = z.object({
  correlationId: z.string(),
  importSessionId: z.number().int().positive(),
  status: z.string(),
})

export const createConfirmPortfolioImportSessionEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'POST' as const, path: importSessionPath(importSessionId, '/confirm'), schema: confirmImportResponseSchema, successStatuses: [202],
})

// Columns the server leaves empty arrive as `null` (MikroORM hydrates NULL as null), not absent,
// so every optional value read from a stored row is nullish.
const storedText = z.string().nullish()
const storedId = z.number().int().positive().nullish()

const importPreviewRowSchema = z.object({
  assetGroupId: storedId,
  failureReason: storedText,
  financialAssetId: storedId,
  id: z.number().int().positive(),
  internalTransactionId: storedText,
  normalized: z.record(z.string(), z.unknown()).nullish(),
  raw: z.record(z.string(), z.unknown()),
  rowNumber: z.number().int().nonnegative(),
  skipReason: storedText,
  status: tolerantEnum(['duplicate', 'failed', 'imported', 'invalid', 'needs_asset_review', 'ready', 'skipped', 'valid'], 'unknown'),
})

// Asset review, as the preview service builds it (portfolio-import-session-preview.service.ts):
// one group per distinct broker identity in the file, with the provider listings found for it.
// Rows point back at their group through importPreviewRowSchema.assetGroupId.
const PORTFOLIO_IMPORT_ASSET_GROUP_STATUSES = ['ambiguous', 'matched', 'provider_error', 'selected', 'skipped', 'unmatched'] as const

const portfolioImportAssetCandidateSchema = z.object({
  confidence: z.number().nullish(),
  currency: storedText,
  exchange: storedText,
  id: z.number().int().positive(),
  isin: storedText,
  isRecommended: z.boolean().optional(),
  name: storedText,
  rejectedReason: storedText,
  // A listing without a symbol cannot be chosen: the API refuses it ("Candidate symbol is required").
  symbol: storedText,
})
export type PortfolioImportAssetCandidateDto = z.infer<typeof portfolioImportAssetCandidateSchema>

export const portfolioImportAssetGroupSchema = z.object({
  // Absent, not empty, when the provider returned nothing for the group.
  candidates: z.array(portfolioImportAssetCandidateSchema).nullish().transform((candidates) => candidates ?? []),
  id: z.number().int().positive(),
  identity: z.object({
    brokerAssetName: storedText,
    brokerExchange: storedText,
    brokerTicker: storedText,
    currency: storedText,
    isin: storedText,
  }),
  recommendedCandidateId: storedId,
  selectedAction: storedText,
  selectedFinancialAssetId: storedId,
  // An unknown status reads as 'unknown', which the review treats as not needing a decision:
  // the server, not this build, decides whether the session can be confirmed.
  status: tolerantEnum(PORTFOLIO_IMPORT_ASSET_GROUP_STATUSES, 'unknown'),
})
export type PortfolioImportAssetGroupDto = z.infer<typeof portfolioImportAssetGroupSchema>

// The statuses the API counts as blocking (portfolio-import-session-state BLOCKING_GROUP_STATUSES):
// each such group needs a decision before the session can be confirmed.
const BLOCKING_ASSET_GROUP_STATUSES: ReadonlySet<string> = new Set(['ambiguous', 'provider_error', 'unmatched'])
export const isBlockingAssetGroup = (group: Pick<PortfolioImportAssetGroupDto, 'status'>) => BLOCKING_ASSET_GROUP_STATUSES.has(group.status)

// Mirrors validators/portfolio.ts confirmPortfolioImportAssetMappingsRequestSchema.
const tickerSymbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Z0-9][\w.:\-/]{0,19}$/i)
const positiveId = z.number().int().positive()

export const portfolioImportAssetMappingDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('use_candidate'), candidateId: positiveId, groupId: positiveId }).strict(),
  z.object({ action: z.literal('use_external_symbol'), groupId: positiveId, symbol: tickerSymbolSchema }).strict(),
  z.object({ action: z.literal('use_existing_asset'), financialAssetId: positiveId, groupId: positiveId }).strict(),
  z.object({ action: z.literal('skip_group'), groupId: positiveId, skipReason: z.string().trim().min(1).max(255).optional() }).strict(),
])
export type PortfolioImportAssetMappingDecision = z.infer<typeof portfolioImportAssetMappingDecisionSchema>

/** The API takes at most this many decisions per request. */
export const PORTFOLIO_IMPORT_ASSET_MAPPING_BATCH_SIZE = 100

export const portfolioImportAssetMappingsWriteSchema = z.object({
  decisions: z.array(portfolioImportAssetMappingDecisionSchema).min(1).max(PORTFOLIO_IMPORT_ASSET_MAPPING_BATCH_SIZE)
    // The API refuses a request that decides one group twice.
    .refine((decisions) => new Set(decisions.map((decision) => decision.groupId)).size === decisions.length, 'Each asset group may be decided once per request.'),
}).strict()

const confirmAssetMappingsResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: importSessionStatusSchema,
})

export const createConfirmPortfolioImportAssetMappingsEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'PATCH' as const, path: importSessionPath(importSessionId, '/asset-mappings'), schema: confirmAssetMappingsResponseSchema, successStatuses: [200],
})

export const portfolioImportPreviewResponseSchema = z.object({
  assetGroups: z.array(portfolioImportAssetGroupSchema),
  broker: z.object({ id: z.number().int().positive(), name: z.string() }).nullish(),
  columnMapping: z.object({ confirmed: z.unknown().optional(), suggestion: z.unknown().optional(), warning: z.string().optional() }).nullish(),
  importSessionId: z.number().int().positive(),
  limits: z.object({ rowsPerBucket: z.number().int().positive() }),
  portfolioId: z.number().int().positive(),
  rows: z.object({
    duplicate: z.array(importPreviewRowSchema),
    // Rows that failed while a confirmed import ran. Optional so the app still parses a
    // self-hosted API that predates the bucket.
    failed: z.array(importPreviewRowSchema).optional(),
    invalid: z.array(importPreviewRowSchema),
    needsAssetReview: z.array(importPreviewRowSchema),
    ready: z.array(importPreviewRowSchema),
  }),
  status: importSessionStatusSchema,
  summary: z.object({
    assetGroups: z.object({
      ambiguousGroups: z.number().int().nonnegative(),
      matchedGroups: z.number().int().nonnegative(),
      providerErrorGroups: z.number().int().nonnegative(),
      totalGroups: z.number().int().nonnegative(),
      unmatchedGroups: z.number().int().nonnegative(),
    }).optional(),
    blockingRows: z.number().int().nonnegative(),
    canConfirm: z.boolean(),
    duplicateRows: z.number().int().nonnegative(),
    failedRows: z.number().int().nonnegative(),
    failureReason: z.string().optional(),
    importableRows: z.number().int().nonnegative(),
    importedRows: z.number().int().nonnegative(),
    invalidRows: z.number().int().nonnegative(),
    needsAssetReviewRows: z.number().int().nonnegative(),
    readyRows: z.number().int().nonnegative(),
    skippedRows: z.number().int().nonnegative(),
    terminalKind: tolerantEnum(['cancelled', 'duplicate_only', 'expired', 'failed', 'partial_success', 'success'], 'unknown').optional(),
    totalRows: z.number().int().nonnegative(),
    unsupportedAssets: z.array(z.object({ skippedRows: z.number().int().nonnegative(), symbol: z.string() })).optional(),
  }),
})
export type PortfolioImportPreviewDto = z.infer<typeof portfolioImportPreviewResponseSchema>

export const createPortfolioImportPreviewEndpoint = (importSessionId: number) => readEndpoint({
  method: 'GET' as const, path: importSessionPath(importSessionId, '?limit=25'), schema: portfolioImportPreviewResponseSchema,
})
