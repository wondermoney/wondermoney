import { z } from 'zod';

export const portfolioColumnMappingFields = ['transactionDate', 'transactionType', 'assetName', 'isin', 'ticker', 'brokerExchange', 'quantity', 'unitPrice', 'totalAmount', 'currency', 'feeAmount', 'externalTransactionId'] as const;

const optionalString = z.preprocess((value) => value === null ? undefined : value, z.string().min(1).optional());
const optionalInt = z.preprocess((value) => value === null ? undefined : value, z.number().int().min(0).optional());
const optionalBoolean = z.preprocess((value) => value === null ? undefined : value, z.boolean().optional());
export const portfolioImportCurrencyCodeSchema = z.enum(['EUR', 'USD', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'BRL', 'DKK']);
export const portfolioImportFixedValuesSchema = z.object({
  currency: portfolioImportCurrencyCodeSchema.optional(),
  transactionType: z.enum(['BUY', 'SELL']).optional(),
}).strict();
export const portfolioImportDerivedValuesSchema = z.object({
  transactionType: z.enum(['quantitySign', 'totalAmountSign']).optional(),
}).strict();

export const portfolioColumnMappingSchema = z.object({
  assetName: optionalString,
  brokerExchange: optionalString,
  currency: optionalString,
  externalTransactionId: optionalString,
  feeAmount: optionalString,
  isin: optionalString,
  quantity: optionalString,
  ticker: optionalString,
  totalAmount: optionalString,
  transactionDate: optionalString,
  transactionType: optionalString,
  unitPrice: optionalString,
}).strict();

export const portfolioColumnMappingTransformationsSchema = z.object({
  dateFormat: optionalString,
  decimalSeparator: z.preprocess((value) => value === null ? undefined : value, z.enum(['.', ',']).optional()),
  negativeAmountMeansBuy: optionalBoolean,
  quantitySignIndicatesDirection: optionalBoolean,
  thousandsSeparator: z.preprocess((value) => value === null ? undefined : value, z.enum(['.', ',', ' ', 'none']).optional()),
}).strict().superRefine((value, ctx) => {
  if (value.decimalSeparator && value.thousandsSeparator && value.thousandsSeparator !== 'none' && value.decimalSeparator === value.thousandsSeparator) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'decimalSeparator and thousandsSeparator must differ unless thousandsSeparator is none' });
  }
});

export const portfolioCsvLayoutSchema = z.object({
  dataStartRowIndex: optionalInt,
  footerMatchers: z.preprocess((value) => value === null ? undefined : value, z.array(z.string().min(1).max(120)).max(10).optional()),
  footerRowCount: z.preprocess((value) => value === null ? undefined : value, z.number().int().min(0).max(100).optional()),
  headerRowIndex: optionalInt,
}).strict().superRefine((value, ctx) => {
  if (value.dataStartRowIndex === undefined || value.headerRowIndex === undefined) return;
  if (value.dataStartRowIndex <= value.headerRowIndex) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dataStartRowIndex must be after headerRowIndex' });
});

export const portfolioColumnMappingSuggestionSchema = z.object({
  columnMapping: portfolioColumnMappingSchema,
  confidence: z.number().min(0).max(1),
  derivedValues: portfolioImportDerivedValuesSchema.default({}),
  detectedBroker: z.union([z.string().min(1).max(120), z.null()]),
  fixedValues: portfolioImportFixedValuesSchema.default({}),
  layout: portfolioCsvLayoutSchema.default({ dataStartRowIndex: 1, footerMatchers: undefined, footerRowCount: undefined, headerRowIndex: 0 }),
  transformations: portfolioColumnMappingTransformationsSchema,
  warnings: z.array(z.string().max(240)).default([]),
}).strict();

export const portfolioColumnMappingJsonSchema = {
  additionalProperties: false,
  properties: {
    columnMapping: {
      additionalProperties: false,
      properties: Object.fromEntries(portfolioColumnMappingFields.map((field) => [field, { minLength: 1, type: ['string', 'null'] }])),
      required: [...portfolioColumnMappingFields],
      type: 'object',
    },
    confidence: { maximum: 1, minimum: 0, type: 'number' },
    detectedBroker: { maxLength: 120, type: ['string', 'null'] },
    layout: {
      additionalProperties: false,
      properties: {
        dataStartRowIndex: { minimum: 0, type: 'integer' },
        footerMatchers: { items: { maxLength: 120, minLength: 1, type: 'string' }, maxItems: 10, type: ['array', 'null'] },
        footerRowCount: { maximum: 100, minimum: 0, type: ['integer', 'null'] },
        headerRowIndex: { minimum: 0, type: 'integer' },
      },
      required: ['dataStartRowIndex', 'footerMatchers', 'footerRowCount', 'headerRowIndex'],
      type: 'object',
    },
    transformations: {
      additionalProperties: false,
      properties: {
        dateFormat: { maxLength: 40, type: ['string', 'null'] },
        decimalSeparator: { enum: ['.', ','], type: ['string', 'null'] },
        negativeAmountMeansBuy: { type: ['boolean', 'null'] },
        quantitySignIndicatesDirection: { type: ['boolean', 'null'] },
        thousandsSeparator: { enum: ['.', ',', ' ', 'none'], type: ['string', 'null'] },
      },
      required: ['dateFormat', 'decimalSeparator', 'negativeAmountMeansBuy', 'quantitySignIndicatesDirection', 'thousandsSeparator'],
      type: 'object',
    },
    warnings: { items: { maxLength: 240, type: 'string' }, type: 'array' },
  },
  required: ['confidence', 'columnMapping', 'detectedBroker', 'layout', 'transformations', 'warnings'],
  type: 'object',
} as const;

export type PortfolioColumnMapping = z.infer<typeof portfolioColumnMappingSchema>;
export type PortfolioColumnMappingSuggestion = z.infer<typeof portfolioColumnMappingSuggestionSchema>;
export type PortfolioColumnMappingTransformations = z.infer<typeof portfolioColumnMappingTransformationsSchema>;
export type PortfolioCsvLayout = z.infer<typeof portfolioCsvLayoutSchema>;
export type PortfolioImportDerivedValues = z.infer<typeof portfolioImportDerivedValuesSchema>;
export type PortfolioImportFixedValues = z.infer<typeof portfolioImportFixedValuesSchema>;

export function parsePortfolioColumnMappingSuggestionJson(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('portfolio column mapping malformed json'); }
  return portfolioColumnMappingSuggestionSchema.parse(parsed);
}

export function validateConfirmedPortfolioColumnMapping(input: { columnMapping: PortfolioColumnMapping; derivedValues?: PortfolioImportDerivedValues; fixedValues?: PortfolioImportFixedValues; transformations: PortfolioColumnMappingTransformations }) {
  const mapping = portfolioColumnMappingSchema.parse(input.columnMapping); const transformations = portfolioColumnMappingTransformationsSchema.parse(input.transformations); const fixedValues = portfolioImportFixedValuesSchema.parse(input.fixedValues ?? {}); const derivedValues = portfolioImportDerivedValuesSchema.parse(input.derivedValues ?? {}); const missing: string[] = [];
  if (!mapping.transactionDate) missing.push('transactionDate'); if (!mapping.quantity) missing.push('quantity'); if (!mapping.currency && !fixedValues.currency) missing.push('currency'); if (!mapping.unitPrice && !mapping.totalAmount) missing.push('unitPriceOrTotalAmount'); if (!mapping.transactionType && !fixedValues.transactionType && !derivedValues.transactionType && !transformations.negativeAmountMeansBuy && !transformations.quantitySignIndicatesDirection) missing.push('transactionTypeOrDirectionRule'); if (!mapping.isin && !mapping.ticker && !mapping.assetName) missing.push('assetIdentity'); if (missing.length) throw new Error(`Missing required mapping fields: ${missing.join(', ')}`); return { columnMapping: mapping, derivedValues, fixedValues, transformations };
}
