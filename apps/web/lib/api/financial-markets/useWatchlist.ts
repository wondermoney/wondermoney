import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import api from "../api";

interface WatchlistResponse {
  symbols: string[];
}

const WATCHLIST_QUERY_KEY = ["financial-markets", "watchlist"] as const;

// The pre-server watchlist lived only in this localStorage key (Zustand persist).
const LEGACY_WATCHLIST_STORAGE_KEY = "wondermoney.financialMarketsWatchlist.v1";

async function getWatchlist(): Promise<string[]> {
  const { data } = await api.get<WatchlistResponse>(
    "/v1/financial-markets/watchlist",
  );
  return data.symbols;
}

export default function useWatchlist() {
  useMigrateLocalWatchlist();
  return useQuery({ queryFn: getWatchlist, queryKey: WATCHLIST_QUERY_KEY });
}

export function useToggleWatchlist() {
  const queryClient = useQueryClient();

  return useMutation<
    unknown,
    Error,
    { isWatched: boolean; symbol: string },
    { previous: string[] }
  >({
    mutationFn: ({ isWatched, symbol }) =>
      isWatched
        ? api.delete(
            `/v1/financial-markets/watchlist/${encodeURIComponent(symbol)}`,
          )
        : api.put(
            `/v1/financial-markets/watchlist/${encodeURIComponent(symbol)}`,
          ),
    // Optimistically flip membership so the star toggles instantly, then roll
    // back on error and reconcile with the server on settle.
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previous);
      }
    },
    onMutate: async ({ isWatched, symbol }) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY });
      const previous =
        queryClient.getQueryData<string[]>(WATCHLIST_QUERY_KEY) ?? [];
      const next = isWatched
        ? previous.filter((existing) => existing !== symbol)
        : [...previous, symbol];
      queryClient.setQueryData(WATCHLIST_QUERY_KEY, next);
      return { previous };
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY }),
  });
}

let localWatchlistMigrationStarted = false;

// One-time import of the pre-server (localStorage-only) watchlist so existing
// users don't lose the symbols they had before the server-backed store.
function useMigrateLocalWatchlist() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (localWatchlistMigrationStarted || typeof window === "undefined") return;
    localWatchlistMigrationStarted = true;
    void migrateLocalWatchlist(queryClient);
  }, [queryClient]);
}

async function migrateLocalWatchlist(queryClient: QueryClient): Promise<void> {
  const raw = window.localStorage.getItem(LEGACY_WATCHLIST_STORAGE_KEY);
  if (!raw) return;

  let symbols: string[] = [];
  try {
    const parsed = JSON.parse(raw) as { state?: { symbols?: unknown } };
    if (Array.isArray(parsed.state?.symbols)) {
      symbols = parsed.state.symbols.filter(
        (symbol): symbol is string => typeof symbol === "string",
      );
    }
  } catch {
    // Corrupt legacy value — drop it below and move on.
  }

  // Remove the legacy key first so a partial/failed import never re-runs on reload.
  window.localStorage.removeItem(LEGACY_WATCHLIST_STORAGE_KEY);
  if (symbols.length === 0) return;

  await Promise.allSettled(
    symbols.map((symbol) =>
      api.put(`/v1/financial-markets/watchlist/${encodeURIComponent(symbol)}`),
    ),
  );
  await queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY });
}
