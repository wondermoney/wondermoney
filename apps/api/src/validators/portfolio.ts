import { z } from 'zod';

import { portfolioCsvLayoutSchema, portfolioImportDerivedValuesSchema, portfolioImportFixedValuesSchema } from '@service/portfolio/portfolio-csv-column-mapping.schema';
import { tickerSymbolSchema } from '@validators/financial-markets';
import { boundedLimit, finiteAmount, positiveIntId, validDate } from '@validators/shared';

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


export const createPortfolioImportSessionRequestSchema = z.object({
  body: z.object({
    brokerId: positiveIntId.optional(),
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

export const confirmPortfolioImportAssetMappingsRequestSchema = z.object({
  body: z.object({
    decisions: z.array(assetMappingDecisionSchema).min(1).max(100),
  }).strict(),
  params: z.object({ importSessionId: positiveIntId }),
});


export const createPortfolioRequestSchema = z.object({
  body: z.object({
    currencyId: positiveIntId,
    name: z.string(),
  }),
});

export const updatePortfolioRequestSchema = z.object({
  body: z.object({
    benchmarkSymbol: z.string().max(20).optional(),
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
  }),
});

const periodSchema = z.enum(['1M', '3M', '6M', 'YTD', '1Y', 'ALL']).default('YTD');
// Opt-in summary additions; see DashboardOptions in portfolio-dashboard.service.ts.
const dashboardIncludeSchema = z.enum(['feeConversion']).optional();

export const getAggregateDashboardRequestSchema = z.object({
  query: z.object({
    include: dashboardIncludeSchema,
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

export const getAggregatePerformanceRequestSchema = z.object({
  query: z.object({
    period: periodSchema.optional(),
  }),
});

export const getAggregateAllocationRequestSchema = z.object({});

export const getAggregateTopMoversRequestSchema = z.object({
  query: z.object({
    limit: z.string().optional().transform((v) => (v ? boundedLimit({ defaultValue: 5, max: 100 }).parse(v) : 5)),
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
