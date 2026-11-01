import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)
const finite = z.number().finite()
const finiteNullable = finite.nullable()
const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
const finiteDecimalWire = z.union([finite, decimalString]).transform((value) => typeof value === 'number' ? value : Number(value))
const nullableDecimal = finiteDecimalWire.nullable().optional()
const nullableText = z.string().nullable().optional()
const nullablePositiveId = z.number().int().positive().nullable().optional()
const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const portfolioSummarySchema = z.object({
  appuserCurrencyCode: currencyCodeSchema,
  balance: finite,
  currencyKey: z.object({ code: currencyCodeSchema }),
  description: z.string().nullable().optional(),
  name: z.string(),
  portfolioKey: z.number().int().positive(),
})

export const portfoliosResponseSchema = z.object({
  portfolios: z.array(portfolioSummarySchema),
})

const dashboardSummarySchema = z.object({
  assetCount: z.number().int().nonnegative(),
  currency: currencyCodeSchema,
  // Assets with a trade fee the API could not convert (counted as zero). Sent only when the
  // request asks with include=feeConversion and the list is non-empty; covers fully sold assets.
  feeConversionIncompleteAssetKeys: z.array(z.number().int().positive()).optional(),
  lastUpdated: z.iso.datetime(),
  periodLabel: z.literal('YTD'),
  periodReturn: finiteNullable,
  portfolioCount: z.number().int().nonnegative().optional(),
  realizedGains: finite,
  totalGainLoss: finite,
  totalGainLossPercent: finite,
  totalValue: finite,
  unrealizedGains: finite,
})

const portfolioBreakdownSchema = z.object({
  currency: currencyCodeSchema,
  gainPercent: finite,
  name: z.string(),
  portfolioKey: z.number().int().positive(),
  value: finite,
  weight: finite,
})

export const aggregateDashboardResponseSchema = z.object({
  portfolios: z.array(portfolioBreakdownSchema),
  summary: dashboardSummarySchema.extend({
    portfolioCount: z.number().int().nonnegative(),
  }),
})

const portfolioMetadataSchema = z.object({
  benchmarkSymbol: z.string().nullable().optional(),
  currencyKey: z.object({ code: currencyCodeSchema }),
  description: z.string().nullable().optional(),
  excluded: z.boolean().optional(),
  favored: z.boolean().optional(),
  name: z.string(),
  portfolioKey: z.number().int().positive(),
  targetAllocation: z.record(z.string(), finite).nullable().optional(),
})

export const portfolioResponseSchema = z.object({ portfolio: portfolioMetadataSchema })

const performerSchema = z.object({ change: finite, ticker: z.string() })
export const individualDashboardResponseSchema = z.object({
  quickStats: z.object({
    bestPerformer: performerSchema.nullable(),
    biggestPosition: z.object({ ticker: z.string(), weight: finite }).nullable(),
    holdingsCount: z.number().int().nonnegative(),
    worstPerformer: performerSchema.nullable(),
  }),
  summary: dashboardSummarySchema.omit({ portfolioCount: true }),
})

const holdingBase = z.object({
  allocation: finiteNullable,
  averageBuyPrice: finite,
  currency: currencyCodeSchema,
  currentPrice: finiteNullable,
  currentValue: finiteNullable,
  // Sent only when a fee of this asset had no usable exchange rate and was counted as zero;
  // optional so older APIs still parse.
  feeConversionIncomplete: z.boolean().optional(),
  financialAssetCurrencyCode: currencyCodeSchema.nullable().optional(),
  financialAssetEsgScore: z.union([finite, z.string()]).nullable().optional(),
  financialAssetKey: z.number().int().positive(),
  financialAssetLogoUrl: z.string().nullable().optional(),
  financialAssetName: z.string(),
  financialAssetSymbol: z.string(),
  financialAssetType: z.string(),
  portfolioKey: z.number().int().positive().optional(),
  portfolioName: z.string().optional(),
  quantity: finite,
  unrealizedGains: finiteNullable,
  unrealizedGainsPercentage: finiteNullable,
})

const validHoldingSchema = holdingBase.extend({
  invalidReason: z.never().optional(),
  isInvalid: z.literal(false).optional(),
  relatedTransactionKeys: z.never().optional(),
})

const invalidHoldingSchema = holdingBase.extend({
  allocation: z.null(),
  currentPrice: z.null(),
  currentValue: z.null(),
  // Only isInvalid drives the UI; a reason this build doesn't know (today: 'NEGATIVE_UNITS') must
  // not fail the whole holdings list.
  invalidReason: z.string().min(1),
  isInvalid: z.literal(true),
  relatedTransactionKeys: z.array(z.number().int().positive()),
  unrealizedGains: z.null(),
  unrealizedGainsPercentage: z.null(),
})

const portfolioHoldingSchema = z.union([invalidHoldingSchema, validHoldingSchema])
export const portfolioHoldingsResponseSchema = z.object({
  holdings: z.array(portfolioHoldingSchema),
})

export type PortfoliosResponseDto = z.infer<typeof portfoliosResponseSchema>
export type AggregateDashboardResponseDto = z.infer<typeof aggregateDashboardResponseSchema>
export type PortfolioResponseDto = z.infer<typeof portfolioResponseSchema>
export type IndividualDashboardResponseDto = z.infer<typeof individualDashboardResponseSchema>
export type PortfolioHoldingsResponseDto = z.infer<typeof portfolioHoldingsResponseSchema>

export const portfolioCurrencySchema = z.object({
  currencyKey: positiveSafeId,
  code: currencyCodeSchema,
  description: z.string().trim().min(1).max(255),
})
export const portfolioCurrenciesResponseSchema = z.object({ currencies: z.array(portfolioCurrencySchema) })
export const portfolioCreateWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  currencyId: positiveSafeId,
}).strict()
const portfolioCreateResponseSchema = z.object({
  portfolio: z.object({ portfolioKey: positiveSafeId }).passthrough(),
}).transform(({ portfolio }) => ({ portfolioId: portfolio.portfolioKey }))
// Fixed by the server's asset_class table (core/api's asset-class-rollup seed); target allocation keys
// outside this set are rejected server-side, so the write contract enumerates them explicitly.
export const PORTFOLIO_TARGET_ASSET_CLASSES = ['Equities', 'Fixed Income', 'Cash & Equivalents', 'Alternatives', 'Crypto'] as const
export type PortfolioTargetAssetClass = typeof PORTFOLIO_TARGET_ASSET_CLASSES[number]
const targetAssetClassSet: ReadonlySet<string> = new Set(PORTFOLIO_TARGET_ASSET_CLASSES)
export const PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS: Readonly<Record<PortfolioTargetAssetClass, string>> = {
  'Equities': 'equities',
  'Fixed Income': 'fixedIncome',
  'Cash & Equivalents': 'cashEquivalents',
  'Alternatives': 'alternatives',
  'Crypto': 'crypto',
}

const portfolioTargetAllocationWriteSchema = z.record(z.string(), finite.min(0))
  .refine((value) => Object.keys(value).every((key) => targetAssetClassSet.has(key)), 'Unknown asset class.')
  .refine((value) => Object.keys(value).length > 0, 'At least one asset class is required.')
  .nullable()

// Matches web's preset table (lib/portfolio/allocation-presets.ts): a preset replaces the full
// target allocation with exactly these three classes, leaving Alternatives/Crypto unset.
export const PORTFOLIO_ALLOCATION_PRESETS = {
  conservative: { 'Equities': 30, 'Fixed Income': 60, 'Cash & Equivalents': 10 },
  balanced: { 'Equities': 60, 'Fixed Income': 30, 'Cash & Equivalents': 10 },
  growth: { 'Equities': 80, 'Fixed Income': 15, 'Cash & Equivalents': 5 },
} as const satisfies Record<string, Readonly<Partial<Record<PortfolioTargetAssetClass, number>>>>

export function portfolioTargetAllocationsEqual(
  a: Readonly<Record<string, number>> | null | undefined,
  b: Readonly<Record<string, number>> | null | undefined,
): boolean {
  const left = a ?? null
  const right = b ?? null
  if (left === null || right === null) return left === right
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => right[key] === left[key])
}

export const portfolioSettingsWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(500).nullable().optional(),
  benchmarkSymbol: z.string().trim().max(20).nullable().optional(),
  excluded: z.boolean().optional(),
  favored: z.boolean().optional(),
  targetAllocation: portfolioTargetAllocationWriteSchema.optional(),
}).strict().refine((value) => (
  value.name !== undefined
  || value.description !== undefined
  || value.benchmarkSymbol !== undefined
  || value.excluded !== undefined
  || value.favored !== undefined
  || value.targetAllocation !== undefined
), 'At least one changed field is required.')
export const portfolioSettingsResponseSchema = z.object({ portfolio: portfolioMetadataSchema })

export type PortfolioCurrencyDto = z.infer<typeof portfolioCurrencySchema>
export type PortfolioCreateWrite = z.infer<typeof portfolioCreateWriteSchema>
export type PortfolioSettingsWrite = z.infer<typeof portfolioSettingsWriteSchema>

const transactionCurrencySchema = z.object({
  code: currencyCodeSchema.nullable().optional(),
  currencyKey: nullablePositiveId,
}).nullable().optional()

const transactionAssetSchema = z.object({
  esgScore: z.union([finite, decimalString]).nullable().optional(),
  financialAssetKey: nullablePositiveId,
  logoUrl: nullableText,
  name: nullableText,
  symbol: nullableText,
}).nullable().optional()

const transactionPortfolioSchema = z.object({
  name: nullableText,
  portfolioKey: nullablePositiveId,
}).nullable().optional()

const transactionTypeSchema = z.object({
  financialTransactionTypeKey: nullablePositiveId,
  name: nullableText,
}).nullable().optional()

const normalPortfolioTransactionWireSchema = z.object({
  appuserCurrencyExchangeRate: nullableDecimal,
  appuserSettlementAmount: nullableDecimal,
  appuserUnitAmount: nullableDecimal,
  feeAmount: nullableDecimal,
  feeCurrencyKey: transactionCurrencySchema,
  financialAssetExchangeKey: z.unknown().nullable().optional(),
  financialAssetKey: transactionAssetSchema,
  financialBrokerKey: z.object({ financialBrokerKey: nullablePositiveId, name: nullableText }).nullable().optional(),
  financialTransactionTypeKey: transactionTypeSchema,
  // Any item type other than a stock split, including one this build doesn't know, renders as a
  // transaction row (every field here is optional). A malformed stock split must still fail
  // rather than slip through as a transaction.
  itemType: z.string().refine((value) => value !== 'STOCK_SPLIT').optional(),
  notes: nullableText,
  originalAmount: nullableDecimal,
  originalCurrencyKey: transactionCurrencySchema,
  originalUnitAmount: nullableDecimal,
  portfolioKey: transactionPortfolioSchema,
  quantity: nullableDecimal,
  settlementAmount: nullableDecimal,
  settlementCurrencyKey: transactionCurrencySchema,
  settlementExchangeRate: nullableDecimal,
  settlementUnitAmount: nullableDecimal,
  transactionDate: z.iso.datetime().nullable().optional(),
  transactionKey: nullablePositiveId,
}).transform((row) => ({ ...row, itemType: 'TRANSACTION' as const }))

const stockSplitWireSchema = z.object({
  denominator: finite.positive().nullish(),
  editable: z.literal(false),
  financialAssetKey: z.object({
    esgScore: finite.nullable().optional(),
    financialAssetKey: z.number().int().positive(),
    logoUrl: nullableText,
    name: nullableText,
    symbol: nullableText,
  }),
  id: z.string().min(1),
  itemType: z.literal('STOCK_SPLIT'),
  numerator: finite.positive().nullish(),
  portfolioKey: z.object({ name: nullableText, portfolioKey: z.number().int().positive() }),
  splitRatio: finite.positive().nullish(),
  transactionDate: z.iso.datetime(),
})

export const portfolioActivityResponseSchema = z.object({
  transactions: z.array(z.union([stockSplitWireSchema, normalPortfolioTransactionWireSchema])),
})

const allocationItemSchema = z.object({ percentage: finite, type: z.string(), value: finite })
const assetClassDriftSchema = z.object({
  assetClass: z.string(),
  currentPct: finite,
  targetPct: finite,
  driftPts: finite,
})
const unclassifiedHoldingSchema = z.object({ name: z.string(), value: finite })
export const portfolioAllocationResponseSchema = z.object({
  byAsset: z.array(allocationItemSchema).optional(),
  byAssetClass: z.array(allocationItemSchema),
  bySector: z.array(allocationItemSchema).optional(),
  byType: z.array(allocationItemSchema),
  driftRows: z.array(assetClassDriftSchema).optional(),
  guidanceText: z.string().nullable().optional(),
  unclassifiedHoldings: z.array(unclassifiedHoldingSchema),
})
export const portfolioDividendIncomeResponseSchema = z.object({
  byAsset: z.array(z.object({ financialAssetKey: z.number().int().positive(), symbol: z.string(), totalDividends: finite })),
  totalDividends: finite,
})
// Values this build doesn't know read as "not ready yet", which the screens already handle.
const historyStatusSchema = tolerantEnum(['empty', 'insufficient_history', 'ready'], 'insufficient_history')
export const portfolioMetricsResponseSchema = z.object({
  metrics: z.object({
    annualYield: finiteNullable,
    assetAllocation: z.record(z.string(), finite),
    currentValue: finite,
    maxDrawdown: finiteNullable,
    readiness: z.object({
      allocation: z.object({ status: tolerantEnum(['ready'], 'unknown') }),
      holdings: z.object({ status: tolerantEnum(['ready'], 'unknown') }),
      performance: z.object({ status: historyStatusSchema }),
      riskMetrics: z.object({ status: tolerantEnum(['insufficient_history', 'ready'], 'insufficient_history') }),
    }),
    // A risk level this build doesn't know reads as null ("unavailable").
    riskLevel: tolerantEnum(['High', 'Low', 'Medium'], null).nullable(),
    sharpeRatio: finiteNullable,
    totalReturn: finite,
    volatility: finiteNullable,
  }),
})

export type PortfolioActivityDto = z.infer<typeof portfolioActivityResponseSchema>
export type PortfolioActivityItemDto = PortfolioActivityDto['transactions'][number]
export type PortfolioAllocationDto = z.infer<typeof portfolioAllocationResponseSchema>
export type PortfolioDividendIncomeDto = z.infer<typeof portfolioDividendIncomeResponseSchema>
export type PortfolioMetricsDto = z.infer<typeof portfolioMetricsResponseSchema>

export const portfoliosEndpoint = readEndpoint({
  method: 'GET', path: '/v1/portfolio', schema: portfoliosResponseSchema,
})
export const portfolioCurrenciesEndpoint = readEndpoint({
  method: 'GET', path: '/v1/account/currencies', schema: portfolioCurrenciesResponseSchema,
})
export const createPortfolioWriteEndpoint = writeEndpoint({
  method: 'POST', path: '/v1/portfolio', schema: portfolioCreateResponseSchema, successStatuses: [201],
})
// The API sends opt-in dashboard fields only when asked. Older builds shipped strict schemas
// that rejected unknown fields, so this keeps them parsing the summary.
const DASHBOARD_INCLUDE = 'include=feeConversion'
export const aggregatePortfolioDashboardEndpoint = readEndpoint({
  method: 'GET', path: `/v1/portfolio/dashboard?period=YTD&${DASHBOARD_INCLUDE}`, schema: aggregateDashboardResponseSchema,
})
export const portfolioAllocationEndpoint = readEndpoint({ method: 'GET', path: '/v1/portfolio/allocation', schema: portfolioAllocationResponseSchema })
export const portfolioDividendIncomeEndpoint = readEndpoint({ method: 'GET', path: '/v1/portfolio/dividend-income', schema: portfolioDividendIncomeResponseSchema })
export const portfolioMetricsEndpoint = readEndpoint({ method: 'GET', path: '/v1/portfolio/metrics', schema: portfolioMetricsResponseSchema })

export const isValidPortfolioId = (id: number): boolean => Number.isSafeInteger(id) && id > 0

export function parsePortfolioId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidPortfolioId(parsed) ? parsed : null
}

function portfolioPath(id: number, suffix = ''): string {
  if (!isValidPortfolioId(id)) throw new Error('A positive safe portfolio id is required.')
  return `/v1/portfolio/${id}${suffix}`
}

export type PortfolioActivityFilters = Readonly<{ fromDate?: string; toDate?: string }>
const explicitDateSchema = z.iso.datetime()

export function parsePortfolioActivityFilters(fromDate: unknown, toDate: unknown): PortfolioActivityFilters | null {
  if (Array.isArray(fromDate) || Array.isArray(toDate)) return null
  const result = z.object({ fromDate: explicitDateSchema.optional(), toDate: explicitDateSchema.optional() }).safeParse({ fromDate, toDate })
  if (!result.success || (result.data.fromDate && result.data.toDate && result.data.fromDate > result.data.toDate)) return null
  return result.data
}

function portfolioActivityPath(portfolioId: number | null, filters: PortfolioActivityFilters = {}): string {
  if (portfolioId !== null && !isValidPortfolioId(portfolioId)) throw new Error('A positive safe portfolio id is required.')
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) throw new Error('The from date must not be after the to date.')
  const params = new URLSearchParams({ limit: '50' })
  if (filters.fromDate !== undefined) params.set('fromDate', explicitDateSchema.parse(filters.fromDate))
  if (filters.toDate !== undefined) params.set('toDate', explicitDateSchema.parse(filters.toDate))
  const base = portfolioId === null ? '/v1/portfolio/transactions' : portfolioPath(portfolioId, '/transactions')
  return `${base}?${params.toString()}`
}

export const createPortfolioActivityEndpoint = (portfolioId: number | null, filters: PortfolioActivityFilters = {}) => readEndpoint({
  method: 'GET' as const,
  path: portfolioActivityPath(portfolioId, filters),
  schema: portfolioActivityResponseSchema,
})

export const createPortfolioEndpoint = (id: number) => readEndpoint({
  method: 'GET' as const, path: portfolioPath(id), schema: portfolioResponseSchema,
})
export const createPortfolioSettingsEndpoint = (id: number) => writeEndpoint({
  method: 'PUT' as const, path: portfolioPath(id), schema: portfolioSettingsResponseSchema, successStatuses: [200],
})
export const createPortfolioDashboardEndpoint = (id: number) => readEndpoint({
  method: 'GET' as const,
  path: `${portfolioPath(id, '/dashboard')}?period=YTD&${DASHBOARD_INCLUDE}`,
  schema: individualDashboardResponseSchema,
})
export const createPortfolioHoldingsEndpoint = (id: number) => readEndpoint({
  method: 'GET' as const, path: portfolioPath(id, '/holdings'), schema: portfolioHoldingsResponseSchema,
})
// Same response shape as the aggregate portfolioDividendIncomeEndpoint above, scoped to
// one portfolio via the same /v1/portfolio/{id}/... path family as holdings/dashboard/activity.
export const createPortfolioDividendIncomeEndpoint = (id: number) => readEndpoint({
  method: 'GET' as const, path: portfolioPath(id, '/dividend-income'), schema: portfolioDividendIncomeResponseSchema,
})
export const createDeletePortfolioTransactionEndpoint = (portfolioId: number, transactionId: number) => {
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) throw new Error('A positive safe transaction id is required.')
  return writeEndpoint({
    method: 'DELETE' as const, path: portfolioPath(portfolioId, `/transaction/${transactionId}`), schema: z.undefined(), successStatuses: [204],
  })
}

// Only the fields a mobile-sized edit form covers. financialTransactionTypeId, settlementCurrencyId,
// brokerId, fee, and original-currency all stay editable on web only for now — each needs its own
// picker and this is deliberately a smaller, safer first slice.
const unsignedNumericString = z.string().trim().regex(/^(?:\d+(?:\.\d*)?|\.\d+)$/).refine((value) => Number(value) > 0)
export const portfolioTransactionEditWriteSchema = z.object({
  quantity: unsignedNumericString.optional(),
  unitPrice: unsignedNumericString.optional(),
  transactionDate: z.iso.datetime().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict().refine((value) => (
  value.quantity !== undefined || value.unitPrice !== undefined || value.transactionDate !== undefined || value.notes !== undefined
), 'At least one changed field is required.')
export type PortfolioTransactionEditWrite = z.infer<typeof portfolioTransactionEditWriteSchema>

export type PortfolioTransactionEditDraft = Readonly<{
  quantity?: string
  unitPrice?: string
  transactionDate?: string
  notes?: string | null
}>

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Matches web's edit form: no future transaction dates. Resolves a YYYY-MM-DD draft into a real,
 * non-future instant rather than trusting client clock skew to reject it later. */
function freezeNonFutureDate(value: string, now: Date): string {
  const parsed = dateOnly.parse(value)
  const instant = new Date(`${parsed}T12:00:00.000Z`)
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== parsed || instant.getTime() > now.getTime()) {
    throw new Error('Transaction date must be a real, non-future date.')
  }
  return instant.toISOString()
}

/** Resolves a draft with only the fields that actually changed into the exact write payload. Blank
 * strings are treated as "field not touched" for quantity/unitPrice/transactionDate; notes may be
 * explicitly cleared with an empty string, which becomes null. */
export function freezePortfolioTransactionEdit(draft: PortfolioTransactionEditDraft, now = new Date()): PortfolioTransactionEditWrite {
  const quantity = draft.quantity?.trim()
  const unitPrice = draft.unitPrice?.trim()
  const transactionDate = draft.transactionDate?.trim()
  const candidate = {
    ...(quantity ? { quantity: unsignedNumericString.parse(quantity) } : {}),
    ...(unitPrice ? { unitPrice: unsignedNumericString.parse(unitPrice) } : {}),
    ...(transactionDate ? { transactionDate: freezeNonFutureDate(transactionDate, now) } : {}),
    ...(draft.notes !== undefined ? { notes: draft.notes === null || draft.notes.trim().length === 0 ? null : draft.notes.trim() } : {}),
  }
  return portfolioTransactionEditWriteSchema.parse(candidate)
}

export const createEditPortfolioTransactionEndpoint = (portfolioId: number, transactionId: number) => {
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) throw new Error('A positive safe transaction id is required.')
  return writeEndpoint({
    method: 'PUT' as const, path: portfolioPath(portfolioId, `/transaction/${transactionId}`), schema: z.undefined(), successStatuses: [200],
  })
}

// Manual transaction creation. Web's PortfolioTransactionAddModal also collects a
// broker, an optional fee, and an optional original currency/amount; mobile scopes those out the
// same way the edit form already does (see the comment above), since unlike an edit, a create
// still needs an asset, a type, and a settlement currency to exist at all. Web explicitly excludes
// DIVIDEND from the selectable type list (dividends are recorded by the system, not added by
// hand) — mobile matches that by filtering PortfolioTransactionTypeDto[] in the UI layer.
export const portfolioTransactionCreateWriteSchema = z.object({
  assetSymbol: z.string().trim().min(1).max(20),
  financialTransactionTypeId: positiveSafeId,
  notes: z.string().trim().max(1000).optional(),
  quantity: unsignedNumericString,
  settlementCurrencyId: positiveSafeId,
  transactionDate: z.iso.datetime(),
  unitPrice: unsignedNumericString,
}).strict()
export type PortfolioTransactionCreateWrite = z.infer<typeof portfolioTransactionCreateWriteSchema>

export type PortfolioTransactionCreateDraft = Readonly<{
  assetSymbol: string
  financialTransactionTypeId: number | null
  settlementCurrencyId: number | null
  quantity: string
  unitPrice: string
  transactionDate: string
  notes: string
}>

/** Resolves a fully-filled create draft into the exact write payload, reusing the same non-future
 * date and unsigned-numeric-string rules as the edit flow. Throws (rather than returning a result)
 * for any missing/invalid field, matching freezePortfolioTransactionEdit's contract. */
export function freezePortfolioTransactionCreate(draft: PortfolioTransactionCreateDraft, now = new Date()): PortfolioTransactionCreateWrite {
  if (draft.financialTransactionTypeId === null) throw new Error('A transaction type is required.')
  if (draft.settlementCurrencyId === null) throw new Error('A settlement currency is required.')
  const assetSymbol = draft.assetSymbol.trim()
  const notes = draft.notes.trim()
  return portfolioTransactionCreateWriteSchema.parse({
    assetSymbol,
    financialTransactionTypeId: draft.financialTransactionTypeId,
    notes: notes.length > 0 ? notes : undefined,
    quantity: unsignedNumericString.parse(draft.quantity.trim()),
    settlementCurrencyId: draft.settlementCurrencyId,
    transactionDate: freezeNonFutureDate(draft.transactionDate.trim(), now),
    unitPrice: unsignedNumericString.parse(draft.unitPrice.trim()),
  })
}

export const createPortfolioTransactionResponseSchema = z.object({
  transaction: z.object({ transactionKey: positiveSafeId }).passthrough(),
}).transform(({ transaction }) => ({ transactionId: transaction.transactionKey }))

export const createCreatePortfolioTransactionEndpoint = (portfolioId: number) => writeEndpoint({
  method: 'POST' as const, path: portfolioPath(portfolioId, '/transaction'), schema: createPortfolioTransactionResponseSchema, successStatuses: [201],
})

export const portfolioTransactionTypeSchema = z.object({
  financialTransactionTypeKey: positiveSafeId,
  name: z.string().trim().min(1).max(50),
})
export type PortfolioTransactionTypeDto = z.infer<typeof portfolioTransactionTypeSchema>
export const portfolioTransactionTypesResponseSchema = z.object({
  transactionTypes: z.array(portfolioTransactionTypeSchema),
})
export const portfolioTransactionTypesEndpoint = readEndpoint({
  method: 'GET', path: '/v1/portfolio/transaction-types', schema: portfolioTransactionTypesResponseSchema,
})

// Web excludes DIVIDEND from PortfolioTransactionAddModal's selectable type list — dividends are
// system-recorded income events, not something a user hand-enters. Mobile matches that exclusion.
export function isManuallyCreatableTransactionType(name: string): boolean {
  return name.trim().toUpperCase() !== 'DIVIDEND'
}

export const PORTFOLIO_PERFORMANCE_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const
export type PortfolioPerformancePeriod = typeof PORTFOLIO_PERFORMANCE_PERIODS[number]

const performancePointSchema = z.object({ date: dateOnly, value: finite })
const performanceReadinessSchema = z.object({ status: z.string(), note: z.string().nullable().optional() })

export const portfolioPerformanceResponseSchema = z.object({
  dataPoints: z.array(performancePointSchema),
  normalizedDataPoints: z.array(performancePointSchema).optional(),
  benchmarkDataPoints: z.array(performancePointSchema).optional(),
  normalizedBenchmarkDataPoints: z.array(performancePointSchema).optional(),
  benchmarkSymbol: z.string().optional(),
  benchmarkStatus: tolerantEnum(['waiting_for_portfolio_history', 'missing_benchmark_data', 'ready'], 'unknown').optional(),
  // A status this build doesn't know reads as null, which the view model treats like an absent one.
  portfolioHistoryStatus: tolerantEnum(['empty', 'insufficient_history', 'ready'], null).optional(),
  minDataPointsForComparison: z.number().int().nonnegative(),
  period: z.string(),
  readiness: z.object({
    performance: performanceReadinessSchema.optional(),
    benchmark: performanceReadinessSchema.optional(),
  }).optional(),
})
export type PortfolioPerformanceResponseDto = z.infer<typeof portfolioPerformanceResponseSchema>
export type PortfolioPerformancePoint = z.infer<typeof performancePointSchema>

export const createPortfolioPerformanceEndpoint = (portfolioId: number, period: PortfolioPerformancePeriod = 'YTD') => readEndpoint({
  method: 'GET' as const,
  path: `${portfolioPath(portfolioId, '/performance')}?period=${period}`,
  schema: portfolioPerformanceResponseSchema,
})
