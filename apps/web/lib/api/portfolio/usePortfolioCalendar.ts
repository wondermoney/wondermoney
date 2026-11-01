import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { z } from "zod";

import api from "../api";

/**
 * Forward-looking earnings window. Empty for now — EODHD's Fundamentals plan
 * does not include the earnings calendar (see getPortfolioCalendar in
 * `api/src/controller/portfolio.ts`). The shape is kept here so the type system
 * is ready when the underlying plan supports earnings.
 */
export interface EarningsEvent {
  date: string;
  epsEstimated?: number;
  revenueEstimated?: number;
  symbol: string;
}

/**
 * Upcoming dividend row as returned by EODHD's /div endpoint (verified live
 * against AAPL/MSFT/JNJ/KO/PG.US on 2026-08-05). The API
 * tag-teams each row with the symbol it was queried for (`symbol: s`).
 */
export interface DividendEvent {
  /** EODHD "date" field — pay date, in YYYY-MM-DD. */
  date: string;
  /** Currency code, e.g. "USD". */
  currency?: string;
  /** Cash amount per share, as a decimal string from EODHD. */
  amount?: string | number;
  /** Date the dividend was declared, YYYY-MM-DD. */
  declarationDate?: string;
  /** Ex-dividend date, YYYY-MM-DD. */
  exDate?: string;
  /** Payment date, YYYY-MM-DD (may duplicate `date`). */
  payDate?: string;
  /** Period descriptor, e.g. "Quarterly". */
  period?: string;
  /** Record date, YYYY-MM-DD. */
  recordDate?: string;
  /** Symbol as queried, e.g. "AAPL.US". Injected by the API for grouping. */
  symbol: string;
  /** "Dividend" or "Stock Split" per EODHD's discriminator. */
  type?: string;
}

export interface PortfolioCalendarResponse {
  earnings: EarningsEvent[];
  dividends: DividendEvent[];
}

// Loose, runtime Zod schemas so a future EODHD field rename (or stale cache)
// cannot silently break the Calendar page. We do not enforce the
// optional dividend fields — EODHD has been observed to omit `payDate` and
// `declarationDate` on older rows.
const earningsEventSchema = z.object({
  date: z.string(),
  epsEstimated: z.number().optional(),
  revenueEstimated: z.number().optional(),
  symbol: z.string(),
});

const dividendEventSchema = z
  .object({
    date: z.string(),
    symbol: z.string(),
  })
  .loose();

const portfolioCalendarResponseSchema = z.object({
  earnings: z.array(earningsEventSchema),
  dividends: z.array(dividendEventSchema),
});

/**
 * Best-effort Zod parse of an API response. We don't throw on failure — the
 * Calendar page already handles empty/missing data, and we don't want a
 * transient schema drift to break the whole page. Instead, we narrow the
 * runtime shape and fall back to the raw payload for unrecognized fields so
 * downstream consumers still receive the full row.
 */
function parseCalendarResponse(raw: unknown): PortfolioCalendarResponse {
  const parsed = portfolioCalendarResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      dividends: Array.isArray((raw as { dividends?: unknown[] })?.dividends)
        ? ((raw as { dividends: unknown[] }).dividends as DividendEvent[])
        : [],
      earnings: Array.isArray((raw as { earnings?: unknown[] })?.earnings)
        ? ((raw as { earnings: unknown[] }).earnings as EarningsEvent[])
        : [],
    };
  }
  return {
    earnings: parsed.data.earnings as EarningsEvent[],
    dividends: parsed.data.dividends as DividendEvent[],
  };
}

async function getPortfolioCalendar(
  apiClient: AxiosInstance = api,
): Promise<PortfolioCalendarResponse> {
  const { data } = await apiClient.get("/v1/portfolio/calendar");
  return parseCalendarResponse(data);
}

export default function usePortfolioCalendar<R = PortfolioCalendarResponse>(
  options?: Omit<
    UseQueryOptions<PortfolioCalendarResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-calendar"],
    queryFn: () => getPortfolioCalendar(),
    ...options,
  });
}
