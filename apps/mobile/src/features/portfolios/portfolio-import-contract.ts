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

// Mirrors core/api's portfolioColumnMappingRequestSchema exactly (validators/portfolio.ts) so a
// server-suggested mapping can be relayed straight back into the confirm call unmodified.
const portfolioImportColumnMappingSchema = z.object({
  assetName: z.string().min(1).optional(),
  brokerExchange: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  externalTransactionId: z.string().min(1).optional(),
  feeAmount: z.string().min(1).optional(),
  isin: z.string().min(1).optional(),
  quantity: z.string().min(1).optional(),
  ticker: z.string().min(1).optional(),
  totalAmount: z.string().min(1).optional(),
  transactionDate: z.string().min(1).optional(),
  transactionType: z.string().min(1).optional(),
  unitPrice: z.string().min(1).optional(),
}).strict()

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

const suggestColumnMappingResponseSchema = z.object({
  // Absent (not merely empty) when the server could not suggest a mapping at all
  // (see AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING) — JSON drops the undefined key entirely.
  // Relayed back to the confirm call unmodified, so a column the API learns to map later must
  // survive the round trip: passthrough, not strip.
  columnMapping: portfolioImportColumnMappingSchema.passthrough().optional(),
  importSessionId: z.number().int().positive(),
  mappingSource: z.string(),
  status: z.string(),
  warning: z.string().optional(),
})

export const createSuggestPortfolioImportColumnMappingEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'POST' as const, path: importSessionPath(importSessionId, '/column-mapping/suggest'), schema: suggestColumnMappingResponseSchema, successStatuses: [200],
})

export const portfolioImportColumnMappingWriteSchema = z.object({
  columnMapping: portfolioImportColumnMappingSchema,
}).strict()

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

const importPreviewRowSchema = z.object({
  assetGroupId: z.number().int().positive().optional(),
  failureReason: z.string().optional(),
  financialAssetId: z.number().int().positive().optional(),
  id: z.number().int().positive(),
  internalTransactionId: z.string().optional(),
  normalized: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()),
  rowNumber: z.number().int().nonnegative(),
  skipReason: z.string().optional(),
  status: tolerantEnum(['duplicate', 'failed', 'imported', 'invalid', 'needs_asset_review', 'ready', 'skipped', 'valid'], 'unknown'),
})

// Asset-matching review. Mirrors web's reconciliation UI: each ambiguous/unmatched raw
// asset in the file is grouped once (assetGroupId ties back to importPreviewRowSchema rows above),
// server-suggested candidates are ranked matches the user can accept with one tap, and any group
// can otherwise be resolved by searching for a different ticker or skipped outright.
const PORTFOLIO_IMPORT_ASSET_GROUP_STATUSES = ['ambiguous', 'matched', 'provider_error', 'unmatched'] as const

const portfolioImportAssetGroupCandidateSchema = z.object({
  confidence: z.number().min(0).max(1).nullable().optional(),
  exchange: z.string().nullable().optional(),
  financialAssetId: z.number().int().positive(),
  name: z.string().nullable().optional(),
  symbol: z.string().trim().min(1).max(20),
})

export const portfolioImportAssetGroupSchema = z.object({
  candidates: z.array(portfolioImportAssetGroupCandidateSchema),
  id: z.number().int().positive(),
  isin: z.string().nullable().optional(),
  rawAssetName: z.string().nullable().optional(),
  rawSymbol: z.string().nullable().optional(),
  rowCount: z.number().int().nonnegative(),
  // An unknown group status is anything but 'matched', so the group stays in the review list.
  status: tolerantEnum(PORTFOLIO_IMPORT_ASSET_GROUP_STATUSES, 'unknown'),
})
export type PortfolioImportAssetGroupDto = z.infer<typeof portfolioImportAssetGroupSchema>

export const portfolioImportAssetGroupResolutionSchema = z.discriminatedUnion('type', [
  z.object({ financialAssetId: z.number().int().positive(), type: z.literal('match') }).strict(),
  z.object({ symbol: z.string().trim().min(1).max(20), type: z.literal('external_symbol') }).strict(),
  z.object({ type: z.literal('skip') }).strict(),
])
export type PortfolioImportAssetGroupResolution = z.infer<typeof portfolioImportAssetGroupResolutionSchema>

export const portfolioImportAssetGroupMappingWriteSchema = z.object({
  mappings: z.array(z.object({
    assetGroupId: z.number().int().positive(),
    resolution: portfolioImportAssetGroupResolutionSchema,
  }).strict()).min(1),
}).strict()

const confirmAssetGroupMappingsResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: importSessionStatusSchema,
})

export const createConfirmPortfolioImportAssetGroupsEndpoint = (importSessionId: number) => writeEndpoint({
  method: 'PATCH' as const, path: importSessionPath(importSessionId, '/asset-groups'), schema: confirmAssetGroupMappingsResponseSchema, successStatuses: [200],
})

export const portfolioImportPreviewResponseSchema = z.object({
  assetGroups: z.array(portfolioImportAssetGroupSchema),
  broker: z.object({ id: z.number().int().positive(), name: z.string() }).optional(),
  columnMapping: z.object({ confirmed: z.unknown().optional(), suggestion: z.unknown().optional(), warning: z.string().optional() }).optional(),
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
