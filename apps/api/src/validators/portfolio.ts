import { z } from 'zod';

import { parseMemberFilter } from '@service/household/member-attribution';
import { portfolioCsvLayoutSchema, portfolioImportDerivedValuesSchema, portfolioImportFixedValuesSchema } from '@service/portfolio/portfolio-csv-column-mapping.schema';
import { tickerSymbolSchema } from '@validators/financial-markets';
import { memberKeysFilter } from '@validators/reports';
import { boundedLimit, finiteAmount, positiveIntId, validDate } from '@validators/shared';

/** A calendar day, `YYYY-MM-DD` (a real date: no 30 February). */
const isoCalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Date is not a calendar day');

/**
 * The day a manual price is for: no later than tomorrow in UTC, so a member ahead of UTC can
 * still set today's price (the same bound as an exchange-rate override).
 */
const priceOverrideDay = isoCalendarDate.refine((value) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return value <= tomorrow;
}, 'Date cannot be in the future');

export const getAssetPriceOverrideRequestSchema = z.object({
  params: z.object({ date: isoCalendarDate, financialAssetKey: positiveIntId }),
});

export const getAssetPriceHistoryRequestSchema = z.object({
  params: z.object({ financialAssetKey: positiveIntId }),
  query: z.object({ from: isoCalendarDate.optional(), to: isoCalendarDate.optional() }).strict(),
});

export const putAssetPriceOverrideRequestSchema = z.object({
  body: z.object({
    /** Must be the security's own currency; checked against the catalogue. */
    currency: z.string().trim().regex(/^[a-z]{3}$/i, 'Currency must be a three-letter code').transform((value) => value.toUpperCase()),
    note: z.string().trim().max(500).nullable().optional(),
    price: z.number().positive('Price must be greater than zero').max(1_000_000_000_000),
  }).strict(),
  params: z.object({ date: priceOverrideDay, financialAssetKey: positiveIntId }),
});

const portfolioColumnMappingRequestSchema = z.object({
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
}).strict();

const portfolioColumnMappingTransformationsRequestSchema = z.object({
  dateFormat: z.string().min(1).max(40).optional(),
  decimalSeparator: z.enum(['.', ',']).optional(),
  negativeAmountMeansBuy: z.boolean().optional(),
  quantitySignIndicatesDirection: z.boolean().optional(),
  thousandsSeparator: z.enum(['.', ',', ' ', 'none']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decimalSeparator && value.thousandsSeparator && value.thousandsSeparator !== 'none' && value.decimalSeparator === value.thousandsSeparator) {
    ctx.addIssue({ code: 'custom', message: 'decimalSeparator and thousandsSeparator must differ unless thousandsSeparator is none' });
  }
});

const assetMappingDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('use_candidate'),
    candidateId: positiveIntId,
    groupId: positiveIntId,
  }).strict(),
  z.object({
    action: z.literal('use_external_symbol'),
    groupId: positiveIntId,
    symbol: tickerSymbolSchema,
  }).strict(),
  z.object({
    action: z.literal('use_existing_asset'),
    financialAssetId: positiveIntId,
    groupId: positiveIntId,
  }).strict(),
  z.object({
    action: z.literal('skip_group'),
    groupId: positiveIntId,
    skipReason: z.string().trim().min(1).max(255).optional(),
  }).strict(),
]);


/** The as-of day of a positions file: a day that has happened (tomorrow in UTC is still today east of it). */
const positionsAsOfDay = priceOverrideDay;

export const createPortfolioImportSessionRequestSchema = z.object({
  body: z.object({
    brokerId: positiveIntId.optional(),
    /** `trades` (the default) is a trade history; `positions` is what is held today, one opening buy per row. */
    importType: z.enum(['positions', 'trades']).default('trades'),
    mode: z.literal('review'),
  }).strict(),
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const parsePortfolioImportSessionRequestSchema = z.object({
  params: z.object({
    importSessionId: positiveIntId,
  }),
});

export const getPortfolioImportSessionPreviewRequestSchema = z.object({
  params: z.object({ importSessionId: positiveIntId }),
  query: z.object({
    limit: z.preprocess((value) => {
      if (value === undefined) return 25;
      if (Array.isArray(value)) return value;
      if (typeof value === 'string' || typeof value === 'number') return Number(value);
      return value;
    }, z.number().int().min(1).max(100).default(25)),
  }).strict(),
});

export const suggestPortfolioImportColumnMappingRequestSchema = z.object({
  body: z.object({}).default({}),
  params: z.object({
    importSessionId: positiveIntId,
  }),
});

export const confirmPortfolioImportColumnMappingRequestSchema = z.object({
  body: z.object({
    /** Positions files only: the day a row without an acquisition date is bought on. */
    asOfDate: positionsAsOfDay.optional(),
    columnMapping: portfolioColumnMappingRequestSchema,
    derivedValues: portfolioImportDerivedValuesSchema.default({}),
    fixedValues: portfolioImportFixedValuesSchema.default({}),
    layout: portfolioCsvLayoutSchema.default({ dataStartRowIndex: 1, headerRowIndex: 0 }),
    transformations: portfolioColumnMappingTransformationsRequestSchema.default({}),
  }),
  params: z.object({
    importSessionId: positiveIntId,
  }),
});

export const confirmPortfolioImportSessionRequestSchema = z.object({
  params: z.object({ importSessionId: positiveIntId }),
});

/** Positions files: include or skip rows whose asset already has trades in the portfolio. */
export const updatePortfolioImportRowInclusionRequestSchema = z.object({
  body: z.object({
    rows: z.array(z.object({ include: z.boolean(), rowId: positiveIntId }).strict()).min(1).max(500),
  }).strict(),
  params: z.object({ importSessionId: positiveIntId }),
});

export const confirmPortfolioImportAssetMappingsRequestSchema = z.object({
  body: z.object({
    decisions: z.array(assetMappingDecisionSchema).min(1).max(100),
  }).strict(),
  params: z.object({ importSessionId: positiveIntId }),
});


/**
 * The account that holds a portfolio and whether that account's balance includes the holdings.
 * Linking always answers the question; null removes the link.
 */
export const portfolioAccountLinkSchema = z.object({
  accountId: positiveIntId,
  mode: z.enum(['cash_only', 'includes_holdings']),
}).nullable();

export const createPortfolioRequestSchema = z.object({
  body: z.object({
    accountLink: portfolioAccountLinkSchema.optional(),
    currencyId: positiveIntId,
    name: z.string(),
  }),
});

export const updatePortfolioRequestSchema = z.object({
  body: z.object({
    accountLink: portfolioAccountLinkSchema.optional(),
    benchmarkSymbol: z.string().max(20).optional(),
    costBasisMethod: z.enum(['FIFO', 'AVERAGE']).optional(),
    currencyId: positiveIntId.optional(),
    description: z.string().max(500).nullable().optional(),
    excluded: z.boolean().optional(),
    favored: z.boolean().optional(),
    name: z.string().optional(),
    targetAllocation: z.record(z.string(), z.number()).nullable().optional(),
  }),
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const deletePortfolioRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const getPortfolioRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const getPortfoliosTransactionRequestSchema = z.object({
  query: z.object({
    fromDate: z.string().optional().transform((v) => (v ? validDate.parse(v) : undefined)),
    limit: boundedLimit({ defaultValue: 100, max: 1000 }).optional(),
    ticker: tickerSymbolSchema.optional(),
    toDate: z.string().optional().transform((v) => (v ? validDate.parse(v) : undefined)),
  }),
});

export const getPortfolioTransactionRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
  query: z.object({
    fromDate: z.string().optional().transform((v) => (v ? validDate.parse(v) : undefined)),
    limit: boundedLimit({ defaultValue: 100, max: 1000 }).optional(),
    toDate: z.string().optional().transform((v) => (v ? validDate.parse(v) : undefined)),
  }),
});

export const getPortfolioHoldingsRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

/**
 * `memberKeys` on the portfolios overview's aggregate reads (`GET /v1/portfolio/dashboard`,
 * `/performance`, `/allocation`, ...): keeps the portfolios those members own, or Shared for a
 * former member's (`member-attribution.ts`). Absent, every household portfolio.
 */
const portfolioMemberKeys = memberKeysFilter.transform((keys) => parseMemberFilter(keys));

/** `GET /v1/portfolio/holdings`, `/calendar` and `/dividend-income`: every household portfolio, or the member filter's. */
export const getAggregatePortfolioReadRequestSchema = z.object({
  query: z.object({
    memberKeys: portfolioMemberKeys,
  }),
});

/**
 * Realized gains: one portfolio or all of the household's, one UTC calendar year or every year.
 * `memberKeys` narrows either to the portfolios those members own.
 */
export const getRealizedGainsRequestSchema = z.object({
  query: z.object({
    memberKeys: portfolioMemberKeys,
    portfolioId: positiveIntId.optional(),
    year: z.string().regex(/^\d{4}$/, 'Year must be YYYY').transform(Number).optional(),
  }),
});

export const getPortfolioHoldingLotsRequestSchema = z.object({
  params: z.object({
    financialAssetKey: positiveIntId,
    portfolioId: positiveIntId,
  }),
});

export const getPortfolioHistoryStatusRequestSchema = z.object({
  params: z.object({
    portfolioId: z.coerce.number().int().positive(),
  }),
});

export const createPortfolioTransactionRequestSchema = z.object({
  body: z.object({
    assetSymbol: tickerSymbolSchema,
    brokerId: z.number().optional(),
    feeAmount: finiteAmount.optional(),
    feeCurrencyId: positiveIntId.optional(),
    financialTransactionTypeId: positiveIntId,
    notes: z.string().optional(),
    originalCurrencyId: positiveIntId.optional(),
    originalUnitPrice: finiteAmount.optional(),
    quantity: finiteAmount,
    settlementCurrencyId: positiveIntId,
    taxExempt: z.boolean().optional().default(false),
    transactionDate: validDate,
    unitPrice: finiteAmount,
  }),
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const updatePortfolioTransactionRequestSchema = z.object({
  body: z.object({
    brokerId: z.number().nullable().optional(),
    feeAmount: finiteAmount.nullable().optional(),
    feeCurrencyId: positiveIntId.nullable().optional(),
    financialTransactionTypeId: positiveIntId.optional(),
    notes: z.string().nullable().optional(),
    originalCurrencyId: positiveIntId.nullable().optional(),
    originalUnitPrice: finiteAmount.nullable().optional(),
    quantity: finiteAmount.optional(),
    settlementCurrencyId: positiveIntId.optional(),
    transactionDate: validDate.optional(),
    unitPrice: finiteAmount.optional(),
  }),
  params: z.object({
    portfolioId: positiveIntId,
    transactionId: positiveIntId,
  }),
});

export const deletePortfolioTransactionRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
    transactionId: positiveIntId,
  }),
});

export const getPortfoliosMetricsRequestSchema = z.object({
  query: z.object({
    fromDate: z.coerce.date().optional(),
    memberKeys: portfolioMemberKeys,
  }),
});

const periodSchema = z.enum(['1M', '3M', '6M', 'YTD', '1Y', 'ALL']).default('YTD');
// Opt-in summary additions; see DashboardOptions in portfolio-dashboard.service.ts. One or more,
// comma-separated: `include=feeConversion,periodReturns`.
const DASHBOARD_INCLUDES = ['feeConversion', 'periodReturns'] as const;
const dashboardIncludeSchema = z
  .string()
  .regex(new RegExp(`^(${DASHBOARD_INCLUDES.join('|')})(,(${DASHBOARD_INCLUDES.join('|')}))*$`))
  .optional()
  .describe('Opt-in summary fields, comma-separated: `feeConversion`, `periodReturns`.');

/** The dashboard options an `include` query value asks for. */
export function dashboardOptionsFrom(include: string | undefined): { includeFeeConversion: boolean; includePeriodReturns: boolean } {
  const parts = new Set(include?.split(',') ?? []);
  return { includeFeeConversion: parts.has('feeConversion'), includePeriodReturns: parts.has('periodReturns') };
}

export const getAggregateDashboardRequestSchema = z.object({
  query: z.object({
    include: dashboardIncludeSchema,
    memberKeys: portfolioMemberKeys,
    period: periodSchema.optional(),
  }),
});

export const getPortfolioDashboardRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
  query: z.object({
    include: dashboardIncludeSchema,
    period: periodSchema.optional(),
  }),
});

/**
 * `GET /v1/portfolio/performance`: the household's portfolios over the period. `memberKeys` keeps
 * the portfolios those members own, or Shared for a former member's (`member-attribution.ts`).
 */
export const getAggregatePerformanceRequestSchema = z.object({
  query: z.object({
    memberKeys: portfolioMemberKeys,
    period: periodSchema.optional(),
  }),
});

export const getAggregateAllocationRequestSchema = z.object({
  query: z.object({
    memberKeys: portfolioMemberKeys,
  }),
});

export const getAggregateTopMoversRequestSchema = z.object({
  query: z.object({
    limit: z.string().optional().transform((v) => (v ? boundedLimit({ defaultValue: 5, max: 100 }).parse(v) : 5)),
    memberKeys: portfolioMemberKeys,
    period: periodSchema.optional(),
  }),
});

export const getPortfolioPerformanceRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
  query: z.object({
    period: periodSchema.optional(),
  }),
});

export const getPortfolioAllocationRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
});

export const getPortfolioTopMoversRequestSchema = z.object({
  params: z.object({
    portfolioId: positiveIntId,
  }),
  query: z.object({
    limit: z.string().optional().transform((v) => (v ? boundedLimit({ defaultValue: 5, max: 100 }).parse(v) : 5)),
    period: periodSchema.optional(),
  }),
});

export const getHoldingMarketDataRequestSchema = z.object({
  params: z.object({
    symbol: tickerSymbolSchema,
  }),
});
