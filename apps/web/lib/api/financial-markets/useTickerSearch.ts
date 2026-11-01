import type { AxiosInstance } from "axios";

import api from "../api";

export interface Ticker {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
}

export type TickerSearchResponse = Array<Ticker>;

// The API's strict search DTO: a { results, source } envelope of allow-listed
// fields.
interface SearchResultDto {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  type: string | null;
}

interface SearchResponseDto {
  results: SearchResultDto[];
}

function toTicker(result: SearchResultDto): Ticker {
  return {
    symbol: result.symbol,
    name: result.name ?? "",
    currency: result.currency ?? "",
    exchange: result.exchange ?? "",
  };
}

// The provider returns matches in an order that can bury the primary listing
// below foreign ones (e.g. "Microsoft" -> 4338.HK, MSF.DE, … above MSFT).
// Re-rank so the listing a user most likely wants surfaces first.
function rankTickerResults(
  searchTerm: string,
  results: TickerSearchResponse,
): TickerSearchResponse {
  const query = searchTerm.trim().toUpperCase();
  const score = (ticker: Ticker): number => {
    const symbol = ticker.symbol.toUpperCase();
    let value = 0;
    // Exact ticker match wins outright ("AAPL" -> AAPL).
    if (symbol === query) value += 100;
    // Primary/home-exchange listings have no exchange suffix ("MSFT"), whereas
    // foreign listings are dotted ("MSF.DE", "4338.HK") — rank primary higher.
    if (!symbol.includes(".")) value += 10;
    // Prefer symbols starting with the query over incidental name matches.
    if (symbol.startsWith(query)) value += 5;
    return value;
  };
  // Array.prototype.sort is stable, so provider order is kept within ties.
  return [...results].sort((a, b) => score(b) - score(a));
}

async function fetchTickerSearch(
  ticker: string,
  apiClient: AxiosInstance,
): Promise<TickerSearchResponse> {
  const { data } = await apiClient.get<SearchResponseDto>(
    `/v1/financial-markets/ticker/search`,
    {
      params: {
        searchTerm: ticker,
      },
    },
  );
  return rankTickerResults(ticker, data.results.map(toTicker));
}

// The Explorer autocomplete calls this directly (outside React Query) and can
// ask for the same term several times per query — concurrent in-flight calls,
// re-renders, and panel re-opens — which a time-based debounce can't coalesce.
// Ticker search results are effectively static within a session (a symbol's
// name/exchange doesn't change), so cache the promise by normalized term and
// hand identical searches the same request: at most one XHR per term.
const searchCache = new Map<string, Promise<TickerSearchResponse>>();

export async function getTickerSearch(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<TickerSearchResponse> {
  // Non-default clients (e.g. tests) bypass the shared cache.
  if (apiClient !== api) {
    return fetchTickerSearch(ticker, apiClient);
  }

  const key = ticker.trim().toUpperCase();
  const cached = searchCache.get(key);
  if (cached) {
    return cached;
  }

  const request = fetchTickerSearch(ticker, apiClient).catch((error) => {
    // Don't cache failures — allow the next keystroke/re-open to retry.
    searchCache.delete(key);
    throw error;
  });
  searchCache.set(key, request);
  return request;
}
