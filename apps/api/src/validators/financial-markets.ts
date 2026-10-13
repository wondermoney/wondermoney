import { z } from 'zod';

import { boundedLimit } from '@validators/shared';

const symbolPattern = /^[A-Z0-9][\w.:\-/]{0,19}$/i;
const searchTermPattern = /^[A-Z0-9][\w .,&'():\-/]{0,99}$/i;

export const tickerSymbolSchema = z.string().trim().min(1).max(20).regex(symbolPattern);

// A blank or absent search term is treated as "no query" — the controller returns an empty
// result set rather than a 400. The web ticker-search box fires requests before the user
// types (on focus/clear), so empty terms are expected and shouldn't surface as errors.
// Non-empty terms must still match the pattern so genuinely malformed input is rejected.
const searchTermSchema = z
  .string()
  .trim()
  .max(100)
  .refine((value) => value === '' || searchTermPattern.test(value), {
    message: 'must start with a letter or number and contain only allowed characters',
  });

export const searchTickerRequestSchema = z.object({
  query: z.object({
    searchTerm: searchTermSchema.optional().default(''),
  }),
});

export const getCompanyInfoRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

export const watchlistSymbolParamSchema = z.object({
  params: z.object({
    symbol: tickerSymbolSchema,
  }),
});

const isoDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
// FMP's own history for a single symbol rarely exceeds a few decades; this bounds an
// omitted-range request (and the O(1) dividend-merge cost) to a sane worst case.
const MAX_HISTORICAL_PRICE_RANGE_DAYS = 20 * 365;

export const getHistoricalPriceRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
  query: z
    .object({
      from: isoDateSchema.optional(),
      includeDividends: z.enum(['true', 'false']).optional().default('false').transform((v) => v === 'true'),
      to: isoDateSchema.optional(),
    })
    .refine(
      ({ from, to }) => {
        if (!from || !to) return true;
        const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
        return spanDays >= 0 && spanDays <= MAX_HISTORICAL_PRICE_RANGE_DAYS;
      },
      { message: `Date range must be between 0 and ${MAX_HISTORICAL_PRICE_RANGE_DAYS} days` },
    ),
});

export const getHistoricalDividendRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

export const getEarningsRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

export const getQuoteRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

export const getNewsRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
  query: z.object({
    // FMP's stock-news feed has no offset param, only `limit` — so real pagination
    // means fetching a bounded window and slicing it in the controller.
    limit: boundedLimit({ defaultValue: 20, max: 50 }).optional().default(20),
    page: z.coerce.number().int().min(0).default(0),
  }),
});

export const getFinancialsRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

export const getFundamentalsRequestSchema = z.object({
  params: z.object({
    ticker: tickerSymbolSchema,
  }),
});

